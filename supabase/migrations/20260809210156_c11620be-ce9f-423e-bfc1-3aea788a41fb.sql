-- 1. DROP OBSOLETE/INCOMPATIBLE FUNCTIONS
DROP FUNCTION IF EXISTS public.accept_walk_request(uuid);
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.update_walker_location(double precision, double precision);
DROP FUNCTION IF EXISTS public.get_active_walker_location(uuid);
DROP FUNCTION IF EXISTS public.process_walk_matching();
DROP FUNCTION IF EXISTS public.get_session_walker_profile(_session_id uuid);
DROP FUNCTION IF EXISTS public.get_session_walker_profile(uuid);

-- 2. ENUMS (Idempotent)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'walk_offer_status') THEN
        CREATE TYPE public.walk_offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
    END IF;
END $$;

-- 3. ATOMIC ACCEPT WALK REQUEST
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
    IF NOT public.has_role(v_walker_id, 'petwalker') THEN
        RAISE EXCEPTION 'Acesso negado: Somente PetWalkers podem aceitar passeios.';
    END IF;

    SELECT customer_id INTO v_customer_id
    FROM public.walk_sessions
    WHERE id = _session_id
      AND current_status = 'searching'
      AND (matching_expires_at IS NULL OR matching_expires_at > now())
    FOR UPDATE;

    IF v_customer_id IS NULL THEN
        RETURN false;
    END IF;

    IF v_customer_id = v_walker_id THEN
        RAISE EXCEPTION 'Você não pode aceitar seu próprio passeio.';
    END IF;

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

    SELECT id INTO v_offer_id
    FROM public.walk_offers
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending'
    FOR UPDATE;

    IF v_offer_id IS NULL THEN
        RAISE EXCEPTION 'Oferta não encontrada ou já expirada para você.';
    END IF;

    UPDATE public.walk_sessions
    SET walker_id = v_walker_id,
        current_status = 'accepted',
        status = 'accepted',
        petwalker_notified_at = now()
    WHERE id = _session_id;

    UPDATE public.walk_offers
    SET offer_status = 'accepted'
    WHERE id = v_offer_id;

    UPDATE public.walk_offers
    SET offer_status = 'expired'
    WHERE session_id = _session_id
      AND id <> v_offer_id
      AND offer_status = 'pending';

    UPDATE public.petwalker_profiles
    SET current_walk_id = _session_id,
        availability_status = 'busy'
    WHERE user_id = v_walker_id;

    RETURN true;
END;
$$;

-- 4. UPDATE WALKER LOCATION (Canonical)
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
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN RAISE EXCEPTION 'Coordenadas inválidas'; END IF;
    IF _accuracy < 0 THEN _accuracy := 0; END IF;

    UPDATE public.petwalker_profiles
    SET last_known_location = ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography,
        last_location_at = now()
    WHERE user_id = v_user_id
    RETURNING current_walk_id INTO v_walk_id;

    IF NOT FOUND THEN RETURN false; END IF;

    IF v_walk_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.walk_sessions
            WHERE id = v_walk_id 
              AND walker_id = v_user_id
              AND current_status IN ('heading_to_pickup', 'arrived', 'in_progress', 'returning')
        ) THEN
            INSERT INTO public.walker_tracking (walk_session_id, walker_id, location, accuracy)
            VALUES (v_walk_id, v_user_id, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography, _accuracy);
        END IF;
    END IF;

    RETURN true;
END;
$$;

-- 5. GET ACTIVE WALKER LOCATION
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
    IF NOT EXISTS (
        SELECT 1 FROM public.walk_sessions
        WHERE id = _session_id
          AND (customer_id = auth.uid() OR walker_id = auth.uid())
    ) THEN
        RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
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

-- 6. MATCHING
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
    v_elapsed_minutes float;
BEGIN
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

    IF NOT FOUND THEN RETURN; END IF;

    FOR r_session IN 
        SELECT id, meeting_point_geom, customer_id, search_started_at
        FROM public.walk_sessions 
        WHERE current_status = 'searching'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
          AND (matching_expires_at IS NULL OR matching_expires_at > now())
    LOOP
        IF r_session.search_started_at IS NULL THEN
            UPDATE public.walk_sessions 
            SET search_started_at = now(),
                matching_expires_at = now() + (v_session_expiry_minutes * interval '1 minute')
            WHERE id = r_session.id;
            r_session.search_started_at := now();
        END IF;

        v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - r_session.search_started_at)) / 60;
        v_radius := v_initial_radius + (FLOOR(v_elapsed_minutes / NULLIF(v_expansion_interval_minutes, 0)) * v_increment);
        IF v_radius > v_max_radius THEN v_radius := v_max_radius; END IF;

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
            INSERT INTO public.walk_offers (session_id, walker_id, offer_status)
            VALUES (r_session.id, r_walker.user_id, 'pending')
            ON CONFLICT (session_id, walker_id) DO NOTHING;
        END LOOP;
    END LOOP;

    UPDATE public.walk_sessions
    SET current_status = 'expired',
        status = 'expired'
    WHERE current_status = 'searching'
      AND matching_expires_at <= now();
END;
$$;

-- 7. PROFILE RPC
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

-- 8. GRANTS
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_walker_location(double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_active_walker_location(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_walk_matching() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_session_walker_profile(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_walker_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;

-- 9. CRON
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('walk-matching-job');
SELECT cron.schedule('walk-matching-job', '* * * * *', 'SELECT public.process_walk_matching()');
