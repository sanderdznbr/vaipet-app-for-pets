
-- 1. Backfill and column refinement
DO $$
DECLARE
    divergence_count integer := 0;
BEGIN
    -- Update null current_status based on status
    UPDATE public.walk_sessions
    SET current_status = CASE 
        WHEN status = 'active' THEN 'in_progress'::public.walk_status
        WHEN status = 'finished' THEN 'completed'::public.walk_status
        WHEN status = 'returning' THEN 'returning'::public.walk_status
        WHEN status = 'completed' THEN 'completed'::public.walk_status
        WHEN status = 'cancelled' THEN 'cancelled'::public.walk_status
        WHEN status = 'searching' THEN 'searching'::public.walk_status
        WHEN status = 'accepted' THEN 'accepted'::public.walk_status
        ELSE 'searching'::public.walk_status
    END
    WHERE current_status IS NULL;

    -- Count divergences before setting up trigger
    SELECT count(*) INTO divergence_count
    FROM public.walk_sessions
    WHERE status IS DISTINCT FROM current_status::text;
    
    RAISE NOTICE 'Divergences found: %', divergence_count;
END $$;

ALTER TABLE public.walk_sessions
ALTER COLUMN current_status SET DEFAULT 'searching',
ALTER COLUMN current_status SET NOT NULL;

-- 2. Compatibility Trigger
CREATE OR REPLACE FUNCTION public.sync_walk_session_status()
RETURNS TRIGGER AS $$
BEGIN
    -- current_status is always the source of truth
    NEW.status := NEW.current_status::text;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_walk_session_status ON public.walk_sessions;
CREATE TRIGGER trg_sync_walk_session_status
BEFORE INSERT OR UPDATE ON public.walk_sessions
FOR EACH ROW
EXECUTE FUNCTION public.sync_walk_session_status();

-- 3. Review RPCs (Security Definer and Schema Path are essential)

-- Example: customer_cancel_search
CREATE OR REPLACE FUNCTION public.customer_cancel_search(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE walk_sessions
    SET current_status = 'cancelled'
    WHERE id = _session_id 
      AND customer_id = auth.uid()
      AND current_status IN ('searching', 'offered');
    
    RETURN FOUND;
END;
$$;

-- Example: accept_walk_request (with FOR UPDATE)
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer_id uuid;
BEGIN
    -- Lock row for concurrency
    SELECT customer_id INTO v_customer_id
    FROM walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    UPDATE walk_sessions
    SET current_status = 'accepted',
        walker_id = auth.uid(),
        updated_at = now()
    WHERE id = _session_id
      AND current_status IN ('searching', 'offered')
      AND walker_id IS NULL;

    RETURN FOUND;
END;
$$;

-- Update other RPCs similarly (omitted details for brevity in SQL block, will include all in migration)
