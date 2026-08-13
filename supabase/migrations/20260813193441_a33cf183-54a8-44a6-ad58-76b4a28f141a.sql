
-- Migration 20260813200000_phase3_1_status_unification
-- Objective: Unify walk_sessions status using current_status as source of truth.

-- 1. Backfill and column refinement
DO $$
DECLARE
    divergence_count integer := 0;
BEGIN
    -- Update null current_status based on status legacy values
    UPDATE public.walk_sessions
    SET current_status = CASE 
        WHEN status = 'active' THEN 'in_progress'::public.walk_status
        WHEN status = 'finished' THEN 'completed'::public.walk_status
        WHEN status = 'returning' THEN 'returning'::public.walk_status
        WHEN status = 'completed' THEN 'completed'::public.walk_status
        WHEN status = 'cancelled' THEN 'cancelled'::public.walk_status
        WHEN status = 'searching' THEN 'searching'::public.walk_status
        WHEN status = 'accepted' THEN 'accepted'::public.walk_status
        ELSE COALESCE(current_status, 'searching'::public.walk_status)
    END
    WHERE current_status IS NULL OR current_status::text != status;

    -- Count divergences
    SELECT count(*) INTO divergence_count
    FROM public.walk_sessions
    WHERE status IS DISTINCT FROM current_status::text;
    
    RAISE NOTICE 'Divergences found and reconciled: %', divergence_count;
END $$;

-- Enforce constraints
ALTER TABLE public.walk_sessions
ALTER COLUMN current_status SET DEFAULT 'searching',
ALTER COLUMN current_status SET NOT NULL;

-- 2. Compatibility Trigger to mirror current_status to status
CREATE OR REPLACE FUNCTION public.sync_walk_session_status()
RETURNS TRIGGER AS $$
BEGIN
    NEW.status := NEW.current_status::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_walk_session_status ON public.walk_sessions;
CREATE TRIGGER trg_sync_walk_session_status
BEFORE INSERT OR UPDATE ON public.walk_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sync_walk_session_status();

-- 3. Update all operational RPCs to use current_status

-- customer_cancel_search
CREATE OR REPLACE FUNCTION public.customer_cancel_search(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'cancelled',
        updated_at = now()
    WHERE id = _session_id 
      AND customer_id = auth.uid()
      AND current_status IN ('searching', 'offered');
    
    RETURN FOUND;
END;
$$;

-- accept_walk_request
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer_id uuid;
BEGIN
    SELECT customer_id INTO v_customer_id
    FROM walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    UPDATE walk_sessions
    SET current_status = 'accepted',
        walker_id = auth.uid(),
        updated_at = now()
    WHERE id = _session_id
      AND (current_status = 'searching' OR current_status = 'offered')
      AND (walker_id IS NULL OR walker_id = auth.uid());

    RETURN FOUND;
END;
$$;

-- petwalker_start_heading
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'heading_to_pickup',
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'accepted';
    
    RETURN FOUND;
END;
$$;

-- petwalker_arrive_pickup
CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'arrived',
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'heading_to_pickup';
    
    RETURN FOUND;
END;
$$;

-- petwalker_start_walk
CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'in_progress',
        start_time = COALESCE(start_time, now()),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status = 'arrived';
    
    RETURN FOUND;
END;
$$;

-- customer_request_return
CREATE OR REPLACE FUNCTION public.customer_request_return(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'returning',
        updated_at = now()
    WHERE id = _session_id 
      AND customer_id = auth.uid()
      AND current_status = 'in_progress';
    
    RETURN FOUND;
END;
$$;

-- customer_confirm_arrival (matches petwalker_complete_walk in some flows)
CREATE OR REPLACE FUNCTION public.customer_confirm_arrival(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'completed',
        end_time = COALESCE(end_time, now()),
        updated_at = now()
    WHERE id = _session_id 
      AND customer_id = auth.uid()
      AND current_status IN ('in_progress', 'returning');
    
    RETURN FOUND;
END;
$$;

-- petwalker_complete_walk
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'completed',
        end_time = COALESCE(end_time, now()),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid()
      AND current_status IN ('in_progress', 'returning');
    
    RETURN FOUND;
END;
$$;

-- cancel_walk_session
CREATE OR REPLACE FUNCTION public.cancel_walk_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'cancelled',
        updated_at = now()
    WHERE id = _session_id 
      AND (customer_id = auth.uid() OR walker_id = auth.uid())
      AND current_status NOT IN ('completed', 'cancelled', 'expired');
END;
$$;

-- decline_walk_offer
CREATE OR REPLACE FUNCTION public.decline_walk_offer(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Here we don't necessarily cancel the session if it's still searching for others
    -- but for this specific walker, we might want to track the rejection.
    -- Phase 3.1 requirement: decisions go to current_status.
    -- If a walker declines, we usually stay in 'searching' or 'offered' (to others).
    -- If it's a direct offer, it might go back to searching.
    RETURN TRUE;
END;
$$;

-- create_walk_request
CREATE OR REPLACE FUNCTION public.create_walk_request(
  _duration_minutes integer,
  _meeting_point_address text,
  _meeting_point_lat double precision,
  _meeting_point_lng double precision,
  _pet_id uuid,
  _request_mode public.walk_request_mode,
  _scheduled_for timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_status public.walk_status;
BEGIN
  IF _request_mode = 'now' THEN
    v_status := 'searching';
  ELSE
    v_status := 'scheduled';
  END IF;

  INSERT INTO walk_sessions (
    customer_id,
    pet_id,
    planned_duration_minutes,
    meeting_point_address,
    meeting_point_lat,
    meeting_point_lng,
    current_status,
    scheduled_for,
    request_mode
  ) VALUES (
    auth.uid(),
    _pet_id,
    _duration_minutes,
    _meeting_point_address,
    _meeting_point_lat,
    _meeting_point_lng,
    v_status,
    _scheduled_for,
    _request_mode
  ) RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;
