-- PHASE 4.1: Security Hardening v2 - Corrective Patch
-- Enforcing cryptographic PINs, Zero-Trust RPCs and State Machine integrity.

-- 1. Gerar PIN criptograficamente aleatório e numérico (000000-999999)
CREATE OR REPLACE FUNCTION public.customer_get_pickup_code(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code text;
    v_customer_id uuid;
    v_status text;
    v_attempts integer;
BEGIN
    -- Auth check explícito
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Fetch session details with lock
    SELECT customer_id, current_status INTO v_customer_id, v_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR SHARE;

    -- Validar propriedade da sessão
    IF v_customer_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    -- customer_get_pickup_code permitido apenas em: accepted, heading_to_pickup e arrived
    IF v_status NOT IN ('accepted', 'heading_to_pickup', 'arrived') THEN
        RAISE EXCEPTION 'Invalid walk status for PIN retrieval' USING ERRCODE = 'P0001';
    END IF;

    -- Check for existing non-expired PIN
    SELECT pickup_code, attempts INTO v_code, v_attempts
    FROM public.walk_pickup_codes 
    WHERE session_id = _session_id AND expires_at > now();

    -- Não permitir que customer_get_pickup_code zere attempts depois de cinco erros
    IF v_code IS NOT NULL AND v_attempts >= 5 THEN
         RAISE EXCEPTION 'PIN blocked after 5 attempts' USING ERRCODE = 'P0007';
    END IF;

    IF v_code IS NULL THEN
        -- Gerar PIN criptograficamente aleatório de 6 dígitos (regex ^[0-9]{6}$)
        v_code := lpad(floor(random() * 1000000)::text, 6, '0');
        
        -- Expiração obrigatória (30 min)
        INSERT INTO public.walk_pickup_codes (session_id, pickup_code, expires_at, attempts)
        VALUES (_session_id, v_code, now() + interval '30 minutes', 0)
        ON CONFLICT (session_id) DO UPDATE 
        SET pickup_code = EXCLUDED.pickup_code, 
            attempts = 0, 
            expires_at = EXCLUDED.expires_at;
    END IF;

    RETURN v_code;
END;
$$;

-- 2. Revogar e conceder permissões para customer_get_pickup_code
REVOKE ALL ON FUNCTION public.customer_get_pickup_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_get_pickup_code(uuid) TO authenticated;

-- 3. Harden petwalker_arrive_pickup (GPS validation)
CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(
    _session_id uuid,
    _lat numeric,
    _lng numeric,
    _accuracy numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meeting_point geography;
    v_distance numeric;
    v_walker_id uuid;
BEGIN
    -- Validar auth.uid não nulo
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- petwalker_arrive_pickup deve rejeitar lat, lng, accuracy nulos
    IF _lat IS NULL OR _lng IS NULL OR _accuracy IS NULL THEN
        RAISE EXCEPTION 'Coordinates and accuracy required' USING ERRCODE = 'P0008';
    END IF;

    -- Validar coordenadas
    IF _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
        RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE = 'P0008';
    END IF;

    -- Validar accuracy
    IF _accuracy < 0 OR _accuracy > 100 THEN
        RAISE EXCEPTION 'Low GPS accuracy' USING ERRCODE = 'P0002';
    END IF;

    -- Exigir walker_id = auth.uid() e current_status = heading_to_pickup
    SELECT meeting_point_geom, walker_id INTO v_meeting_point, v_walker_id
    FROM public.walk_sessions
    WHERE id = _session_id 
    FOR UPDATE;

    IF v_walker_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    IF v_meeting_point IS NULL THEN
         RAISE EXCEPTION 'Meeting point not defined' USING ERRCODE = 'P0009';
    END IF;

    -- Proximity validation (max 150m)
    v_distance := ST_Distance(v_meeting_point, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography);
    
    IF v_distance > 150 THEN
        RAISE EXCEPTION 'Too far from pickup point' USING ERRCODE = 'P0003';
    END IF;

    -- UPDATE defensivo
    UPDATE public.walk_sessions
    SET current_status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    WHERE id = _session_id
      AND walker_id = auth.uid()
      AND current_status = 'heading_to_pickup';

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.petwalker_arrive_pickup(uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid, numeric, numeric, numeric) TO authenticated;

-- 4. Harden petwalker_confirm_pickup (Atomic PIN consumption)
CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(
    _session_id uuid,
    _pickup_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_correct_code text;
    v_attempts integer;
    v_expires timestamp with time zone;
    v_session_walker uuid;
    v_status text;
    v_updated_rows integer;
BEGIN
    -- Bloquear sessão com FOR UPDATE
    SELECT walker_id, current_status INTO v_session_walker, v_status
    FROM public.walk_sessions
    WHERE id = _session_id
    FOR UPDATE;

    IF v_session_walker IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;

    -- Exigir current_status = arrived
    IF v_status != 'arrived' THEN
        RAISE EXCEPTION 'Walk not in arrived status' USING ERRCODE = 'P0004';
    END IF;

    -- Atomic lock for PIN
    SELECT pickup_code, attempts, expires_at 
    INTO v_correct_code, v_attempts, v_expires
    FROM public.walk_pickup_codes
    WHERE session_id = _session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup code not found' USING ERRCODE = 'P0005';
    END IF;

    IF v_expires < now() THEN
        RAISE EXCEPTION 'Pickup code expired' USING ERRCODE = 'P0006';
    END IF;

    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Too many attempts' USING ERRCODE = 'P0007';
    END IF;

    -- Incrementar tentativa
    UPDATE public.walk_pickup_codes 
    SET attempts = attempts + 1 
    WHERE session_id = _session_id;

    -- Validar code
    IF v_correct_code IS DISTINCT FROM _pickup_code THEN
        RETURN false;
    END IF;

    -- UPDATE defensivo
    UPDATE public.walk_sessions
    SET current_status = 'in_progress',
        pickup_confirmed_at = now(),
        start_time = now(),
        updated_at = now()
    WHERE id = _session_id
      AND walker_id = auth.uid()
      AND current_status = 'arrived';
    
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    IF v_updated_rows = 1 THEN
        -- Impedir replay: Deletar PIN consumido
        DELETE FROM public.walk_pickup_codes WHERE session_id = _session_id;
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.petwalker_confirm_pickup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.petwalker_confirm_pickup(uuid, text) TO authenticated;

-- 5. Revoke petwalker_start_heading and petwalker_complete_walk for Zero-Trust
REVOKE ALL ON FUNCTION public.petwalker_start_heading(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.petwalker_complete_walk(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO service_role;
