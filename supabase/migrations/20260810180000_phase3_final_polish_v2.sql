-- 1. Correct Function signature for update_walker_location
-- PostgreSQL does not allow CREATE OR REPLACE if the return type changes.
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision, double precision);

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

    -- Verify walker status - using canonical table petwalker_profiles
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_user_id AND approval_status = 'approved'
    ) THEN
        RETURN false;
    END IF;

    -- Update last known location (using SRID 4326 geography as requested)
    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        last_location_at = now()
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
            -- Using canonical table walker_tracking and column walk_session_id
            INSERT INTO public.walker_tracking (walk_session_id, walker_id, location, accuracy)
            VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography, _accuracy);
        END IF;
    END IF;

    RETURN true;
END;
$$;

-- 2. Correct get_active_walker_location to use walk_session_id and created_at
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
        created_at as updated_at
    FROM public.walker_tracking
    WHERE walk_session_id = _session_id
    ORDER BY created_at DESC
    LIMIT 1;
END;
$$;

-- 3. Correct process_walk_matching to use canonical column names
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
    v_session_expiry_minutes float;
    v_expansion_interval_minutes float;
    v_elapsed_matching_minutes float;
BEGIN
    -- Load settings using canonical names
    SELECT 
        initial_radius_meters, 
        max_radius_meters, 
        radius_expansion_step_meters,
        session_expiry_minutes,
        expansion_interval_minutes
    INTO v_initial_radius, v_max_radius, v_increment, v_session_expiry_minutes, v_expansion_interval_minutes
    FROM public.walk_matching_settings
    WHERE active = true
    LIMIT 1;

    IF v_initial_radius IS NULL THEN RETURN; END IF;

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
                matching_expires_at = now() + (v_session_expiry_minutes * interval '1 minute')
            WHERE id = r_session.id;
            r_session.search_started_at := now();
        END IF;

        -- Calculate current radius based on expansion_interval_minutes
        v_elapsed_matching_minutes := EXTRACT(EPOCH FROM (now() - r_session.search_started_at)) / 60;
        v_radius := v_initial_radius + (FLOOR(v_elapsed_matching_minutes / NULLIF(v_expansion_interval_minutes, 0)) * v_increment);
        IF v_radius > v_max_radius THEN v_radius := v_max_radius; END IF;

        -- Find available walkers within radius using meeting_point_geom
        FOR r_walker IN
            SELECT user_id
            FROM public.petwalker_profiles
            WHERE approval_status = 'approved'
              AND availability_status = 'available'
              AND is_accepting_requests = true
              AND current_walk_id IS NULL
              AND last_known_location IS NOT NULL
              AND ST_DWithin(last_known_location, r_session.meeting_point_geom, v_radius)
              AND user_id <> r_session.customer_id
        LOOP
            -- Create offer if not exists
            INSERT INTO public.walk_offers (session_id, walker_id, offer_status)
            VALUES (r_session.id, r_walker.user_id, 'pending')
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- Cleanup expired sessions
    UPDATE public.walk_sessions
    SET current_status = 'expired',
        status = 'expired'
    WHERE current_status = 'searching'
      AND matching_expires_at <= now();
END;
$$;

-- 4. Re-grant permissions
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;
