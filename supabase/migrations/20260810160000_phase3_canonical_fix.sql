-- Phase 3: Canonical Schema & RPC Unification
-- Redefining all Phase 3 operations using canonical column names.

-- 1. DROP OBSOLETE/INCOMPATIBLE FUNCTIONS
DROP FUNCTION IF EXISTS public.get_available_walk_offers();
DROP FUNCTION IF EXISTS public.create_walk_request(uuid, double precision, double precision, integer, text, timestamptz);
DROP FUNCTION IF EXISTS public.create_walk_request(uuid, integer, text, timestamptz, double precision, double precision, text);
DROP FUNCTION IF EXISTS public.petwalker_start_heading(uuid);
DROP FUNCTION IF EXISTS public.petwalker_arrive_pickup(uuid);
DROP FUNCTION IF EXISTS public.petwalker_start_walk(uuid);
DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid);
DROP FUNCTION IF EXISTS public.petwalker_complete_walk(uuid, numeric);
DROP FUNCTION IF EXISTS public.get_active_walker_location(uuid);
DROP FUNCTION IF EXISTS public.process_walk_matching();

-- 2. CREATE WALK REQUEST (Unified Signature)
CREATE OR REPLACE FUNCTION public.create_walk_request(
    _pet_id uuid,
    _duration_minutes integer,
    _request_mode text,
    _scheduled_for timestamptz,
    _meeting_point_lng double precision,
    _meeting_point_lat double precision,
    _meeting_point_address text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid := auth.uid();
    _session_id uuid;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    
    -- Validate ownership
    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = _user_id) THEN
        RAISE EXCEPTION 'Invalid pet or ownership';
    END IF;

    -- Validate coordinates
    IF _meeting_point_lat < -90 OR _meeting_point_lat > 90 OR _meeting_point_lng < -180 OR _meeting_point_lng > 180 THEN
        RAISE EXCEPTION 'Invalid coordinates';
    END IF;

    -- Validate mode and scheduling
    IF _request_mode NOT IN ('now', 'scheduled') THEN
        RAISE EXCEPTION 'Invalid request mode';
    END IF;

    IF _request_mode = 'scheduled' AND (_scheduled_for IS NULL OR _scheduled_for <= now()) THEN
        RAISE EXCEPTION 'Scheduled time must be in the future';
    END IF;

    -- Validate duration (Pricing snapshot trigger will handle the actual cents)
    IF _duration_minutes < 15 OR _duration_minutes % 15 != 0 THEN
        RAISE EXCEPTION 'Invalid duration (minimum 15 minutes, steps of 15)';
    END IF;

    -- Create session
    INSERT INTO public.walk_sessions (
        customer_id,
        pet_id,
        current_status,
        request_mode,
        scheduled_for,
        planned_duration_minutes,
        meeting_point_geom,
        meeting_point_address,
        search_radius_km,
        search_started_at
    ) VALUES (
        _user_id,
        _pet_id,
        'searching',
        _request_mode,
        CASE WHEN _request_mode = 'now' THEN now() ELSE _scheduled_for END,
        _duration_minutes,
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address,
        1.5, -- Initial radius km
        now()
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_walk_request(uuid, integer, text, timestamptz, double precision, double precision, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, integer, text, timestamptz, double precision, double precision, text) TO authenticated, service_role;

-- 3. GET AVAILABLE WALK OFFERS
CREATE OR REPLACE FUNCTION public.get_available_walk_offers()
RETURNS TABLE (
    id uuid,
    walk_session_id uuid,
    pet_name text,
    pet_avatar_url text,
    meeting_point_lat double precision,
    meeting_point_lng double precision,
    meeting_point_address text,
    planned_duration_minutes integer,
    total_price_cents integer,
    distance_to_walker_meters double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _walker_location geography;
BEGIN
    -- Authorization checks
    IF NOT public.has_role(_walker_id, 'petwalker') THEN
        RAISE EXCEPTION 'Unauthorized: PetWalker role required';
    END IF;

    -- Operational checks
    SELECT last_known_location INTO _walker_location
    FROM public.petwalker_profiles
    WHERE user_id = _walker_id
      AND approval_status = 'approved'
      AND availability_status = 'available'
      AND is_accepting_requests = true
      AND current_walk_id IS NULL;

    IF NOT FOUND OR _walker_location IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        o.id,
        o.session_id as walk_session_id,
        p.name as pet_name,
        p.avatar_url as pet_avatar_url,
        st_y(s.meeting_point_geom::geometry) as meeting_point_lat,
        st_x(s.meeting_point_geom::geometry) as meeting_point_lng,
        s.meeting_point_address,
        s.planned_duration_minutes,
        s.total_price_cents,
        st_distance(s.meeting_point_geom, _walker_location) as distance_to_walker_meters
    FROM public.walk_offers o
    JOIN public.walk_sessions s ON s.id = o.session_id
    JOIN public.pets p ON p.id = s.pet_id
    WHERE o.walker_id = _walker_id
      AND o.offer_status = 'pending'
      AND s.current_status = 'searching'
    ORDER BY st_distance(s.meeting_point_geom, _walker_location) ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_available_walk_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_walk_offers() TO authenticated, service_role;

-- 4. TRANSITION RPCS (Unified & Hardened)

CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_walk_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'heading_to_pickup' 
    WHERE id = _walk_session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'accepted';
    
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_walk_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'arrived' 
    WHERE id = _walk_session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'heading_to_pickup';
    
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_walk_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'in_progress', start_time = now() 
    WHERE id = _walk_session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'arrived';
    
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_walk_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid := auth.uid();
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', end_time = now()
    WHERE id = _walk_session_id 
      AND walker_id = _walker_id 
      AND current_status = 'in_progress';
    
    IF NOT FOUND THEN RETURN false; END IF;

    -- Cleanup walker profile
    UPDATE public.petwalker_profiles 
    SET current_walk_id = NULL 
    WHERE user_id = _walker_id;

    RETURN true;
END; $$;

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_start_walk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated, service_role;

-- 5. TRACKING RPCS

CREATE OR REPLACE FUNCTION public.update_walker_location(_lat double precision, _lng double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid := auth.uid();
    _current_walk_id uuid;
    _loc geography;
BEGIN
    _loc := st_setsrid(st_point(_lng, _lat), 4326)::geography;

    UPDATE public.petwalker_profiles
    SET last_known_location = _loc,
        last_location_at = now()
    WHERE user_id = _walker_id
    RETURNING current_walk_id INTO _current_walk_id;

    IF _current_walk_id IS NOT NULL THEN
        INSERT INTO public.walker_tracking (walker_id, walk_session_id, location)
        VALUES (_walker_id, _current_walk_id, _loc);
    END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.get_active_walker_location(_walk_session_id uuid)
RETURNS TABLE (lat double precision, lng double precision, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN QUERY
    SELECT 
        st_y(location::geometry), st_x(location::geometry), created_at
    FROM public.walker_tracking
    WHERE walk_session_id = _walk_session_id 
      AND (
          EXISTS (SELECT 1 FROM public.walk_sessions WHERE id = _walk_session_id AND customer_id = auth.uid())
          OR 
          EXISTS (SELECT 1 FROM public.walk_sessions WHERE id = _walk_session_id AND walker_id = auth.uid())
      )
    ORDER BY created_at DESC
    LIMIT 1;
END; $$;

GRANT EXECUTE ON FUNCTION public.update_walker_location(double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_walker_location(uuid) TO authenticated, service_role;

-- 6. MATCHING LOGIC (Hardened & Service Role Only)

CREATE OR REPLACE FUNCTION public.process_walk_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _session record;
    _max_radius_meters integer := 5000;
    _radius_step_meters integer := 1000;
    _expansion_interval_minutes integer := 3;
    _expiry_minutes integer := 15;
BEGIN
    -- This should only be called by service_role or internal scheduler
    FOR _session IN 
        SELECT id, meeting_point_geom, search_started_at, 
               extract(epoch from (now() - search_started_at)) / 60 as age_minutes
        FROM public.walk_sessions 
        WHERE current_status = 'searching' 
          AND request_mode = 'now'
    LOOP
        -- Expire sessions
        IF _session.age_minutes > _expiry_minutes THEN
            UPDATE public.walk_sessions SET current_status = 'expired' WHERE id = _session.id;
            CONTINUE;
        END IF;

        DECLARE
            _intervals integer := floor(_session.age_minutes / _expansion_interval_minutes);
            _current_radius integer := LEAST(1500 + (_intervals * _radius_step_meters), _max_radius_meters);
        BEGIN
            -- Create offers for nearby available walkers
            INSERT INTO public.walk_offers (session_id, walker_id, offer_status)
            SELECT _session.id, p.user_id, 'pending'
            FROM public.petwalker_profiles p
            WHERE p.approval_status = 'approved' 
              AND p.availability_status = 'available' 
              AND p.is_accepting_requests = true
              AND p.current_walk_id IS NULL
              AND st_dwithin(_session.meeting_point_geom, p.last_known_location, _current_radius)
              AND NOT EXISTS (
                  SELECT 1 FROM public.walk_offers 
                  WHERE session_id = _session.id AND walker_id = p.user_id
              );
        END;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.process_walk_matching() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_walk_matching() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_walk_matching() TO service_role;

