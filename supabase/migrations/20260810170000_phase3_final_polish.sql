-- 1. Redefine walk_status and handle accept_walk_request atomic hardening
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'walk_offer_status') THEN
        CREATE TYPE public.walk_offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
    END IF;
END $$;

-- Atomic accept walk request
CREATE OR REPLACE FUNCTION public.accept_walk_request(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid := auth.uid();
    v_customer_id uuid;
    v_offer_id uuid;
BEGIN
    -- 1. Check if user is petwalker
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_walker_id AND role = 'petwalker') THEN
        RAISE EXCEPTION 'Acesso negado: Somente PetWalkers podem aceitar passeios.';
    END IF;

    -- 2. Lock the session and verify eligibility
    SELECT customer_id INTO v_customer_id
    FROM public.walk_sessions
    WHERE id = _session_id
      AND current_status = 'searching'
      AND (matching_expires_at IS NULL OR matching_expires_at > now())
    FOR UPDATE;

    IF v_customer_id IS NULL THEN
        RETURN false; -- Session already taken or expired
    END IF;

    -- 3. Prevent self-walk
    IF v_customer_id = v_walker_id THEN
        RAISE EXCEPTION 'Você não pode aceitar seu próprio passeio.';
    END IF;

    -- 4. Lock and check walker profile
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_walker_id 
          AND approval_status = 'approved' 
          AND availability_status = 'available'
          AND is_accepting_requests = true
          AND current_walk_id IS NULL
        FOR UPDATE
    ) THEN
        RAISE EXCEPTION 'Você não está disponível para novos passeios.';
    END IF;

    -- 5. Verify offer exists and is pending
    SELECT id INTO v_offer_id
    FROM public.walk_offers
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending'
    FOR UPDATE;

    IF v_offer_id IS NULL THEN
        RAISE EXCEPTION 'Oferta não encontrada ou já processada.';
    END IF;

    -- 6. Update session
    UPDATE public.walk_sessions
    SET walker_id = v_walker_id,
        current_status = 'accepted',
        status = 'accepted',
        petwalker_notified_at = now()
    WHERE id = _session_id;

    -- 7. Update offers
    UPDATE public.walk_offers
    SET offer_status = 'accepted'
    WHERE id = v_offer_id;

    UPDATE public.walk_offers
    SET offer_status = 'expired'
    WHERE session_id = _session_id
      AND id <> v_offer_id
      AND offer_status = 'pending';

    -- 8. Bind walker profile
    UPDATE public.petwalker_profiles
    SET current_walk_id = _session_id,
        availability_status = 'busy'
    WHERE user_id = v_walker_id;

    RETURN true;
END;
$$;

-- 2. Restore safety to update_walker_location
CREATE OR REPLACE FUNCTION public.update_walker_location(
  _lat double precision,
  _lng double precision,
  _accuracy double precision DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_walk_id uuid;
BEGIN
    -- Security checks
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN RAISE EXCEPTION 'Coordenadas inválidas'; END IF;
    IF _accuracy < 0 THEN _accuracy := 0; END IF;

    -- Verify walker status
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_user_id AND approval_status = 'approved'
    ) THEN
        RETURN false;
    END IF;

    -- Update last known location
    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4324),
        last_location_update_at = now()
    WHERE user_id = v_user_id;

    -- If in active walk, log to tracking
    SELECT current_walk_id INTO v_walk_id
    FROM public.petwalker_profiles
    WHERE user_id = v_user_id;

    IF v_walk_id IS NOT NULL THEN
        -- Only if session is active for this walker
        IF EXISTS (
            SELECT 1 FROM public.walk_sessions
            WHERE id = v_walk_id 
              AND walker_id = v_user_id
              AND current_status IN ('heading_to_pickup', 'arrived', 'in_progress', 'returning')
        ) THEN
            INSERT INTO public.walker_tracking (session_id, walker_id, location, accuracy)
            VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4324), _accuracy);
        END IF;
    END IF;

    RETURN true;
END;
$$;

-- 3. Restore privacy to get_active_walker_location
CREATE OR REPLACE FUNCTION public.get_active_walker_location(_session_id uuid)
RETURNS TABLE (
    lat double precision,
    lng double precision,
    accuracy double precision,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Privacy check: Only customer or assigned walker
    IF NOT EXISTS (
        SELECT 1 FROM public.walk_sessions
        WHERE id = _session_id
          AND (customer_id = auth.uid() OR walker_id = auth.uid())
    ) THEN
        RAISE EXCEPTION 'Acesso negado: Você não tem permissão para rastrear este passeio.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng,
        accuracy,
        recorded_at as updated_at
    FROM public.walker_tracking
    WHERE session_id = _session_id
    ORDER BY recorded_at DESC
    LIMIT 1;
END;
$$;

-- 4. Restore Gradual Matching logic in process_walk_matching
CREATE OR REPLACE FUNCTION public.process_walk_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r_session RECORD;
    r_walker RECORD;
    v_radius float;
    v_max_radius float;
    v_initial_radius float;
    v_increment float;
    v_matching_expiry_minutes float;
    v_elapsed_matching_minutes float;
BEGIN
    -- Load settings
    SELECT 
        initial_search_radius_meters, 
        max_search_radius_meters, 
        radius_increment_meters,
        matching_expiry_minutes
    INTO v_initial_radius, v_max_radius, v_increment, v_matching_expiry_minutes
    FROM public.walk_matching_settings
    LIMIT 1;

    -- Process pending sessions
    FOR r_session IN 
        SELECT * FROM public.walk_sessions 
        WHERE current_status = 'searching'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
          AND (matching_expires_at IS NULL OR matching_expires_at > now())
    LOOP
        -- Initialize search if first time
        IF r_session.search_started_at IS NULL THEN
            UPDATE public.walk_sessions 
            SET search_started_at = now(),
                matching_expires_at = now() + (v_matching_expiry_minutes * interval '1 minute')
            WHERE id = r_session.id;
            r_session.search_started_at := now();
        END IF;

        -- Calculate current radius based on 3-minute increments
        v_elapsed_matching_minutes := EXTRACT(EPOCH FROM (now() - r_session.search_started_at)) / 60;
        v_radius := v_initial_radius + (FLOOR(v_elapsed_matching_minutes / 3) * v_increment);
        IF v_radius > v_max_radius THEN v_radius := v_max_radius; END IF;

        -- Find available walkers within radius
        FOR r_walker IN
            SELECT user_id, ST_Distance(last_known_location, r_session.meeting_point) as dist
            FROM public.petwalker_profiles
            WHERE approval_status = 'approved'
              AND availability_status = 'available'
              AND is_accepting_requests = true
              AND current_walk_id IS NULL
              AND last_known_location IS NOT NULL
              AND ST_DWithin(last_known_location, r_session.meeting_point, v_radius)
              AND user_id <> r_session.customer_id -- No self-matching
        LOOP
            -- Create offer if not exists
            INSERT INTO public.walk_offers (session_id, walker_id, offer_status, distance_to_walker_meters)
            VALUES (r_session.id, r_walker.user_id, 'pending', r_walker.dist)
            ON CONFLICT (session_id, walker_id) DO NOTHING;
        END LOOP;
    END LOOP;

    -- Cleanup expired sessions
    UPDATE public.walk_sessions
    SET current_status = 'expired',
        status = 'cancelled'
    WHERE current_status = 'searching'
      AND matching_expires_at <= now();
END;
$$;

-- 7. Secure Public Walker Profile RPC
CREATE OR REPLACE FUNCTION public.get_session_walker_profile(_session_id uuid)
RETURNS TABLE (
    full_name text,
    avatar_url text,
    rating_average numeric,
    completed_walks integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.full_name,
        p.avatar_url,
        wp.rating_average,
        wp.completed_walks
    FROM public.walk_sessions ws
    JOIN public.petwalker_profiles wp ON ws.walker_id = wp.user_id
    JOIN public.profiles p ON wp.user_id = p.id
    WHERE ws.id = _session_id
      AND (ws.customer_id = auth.uid() OR ws.walker_id = auth.uid());
END;
$$;

-- 8. Grants and Revokes
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_active_walker_location(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_walk_matching() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_session_walker_profile(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_walker_profile(uuid) TO authenticated;
-- process_walk_matching is service_role only via cron (which uses service_role by default in Supabase/managed)
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;

-- 9. Idempotent Cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('walk-matching-job');
SELECT cron.schedule('walk-matching-job', '* * * * *', 'SELECT public.process_walk_matching()');

