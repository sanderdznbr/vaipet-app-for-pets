-- Migration 20260813193923_9cb836a0-338e-4b73-9480-eb8503e0443c.sql
-- Restauração segura Zero-Trust das RPCs operacionais e financeiras

-- REVOKE global antes das definições
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_walk_request(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.decline_walk_offer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_walk_offer(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) FROM anon;

-- 1. accept_walk_request (Restauração Completa Zero-Trust)
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
    IF v_walker_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    -- Bloqueio da sessão com FOR UPDATE
    SELECT customer_id INTO v_customer_id
    FROM public.walk_sessions
    WHERE id = _session_id
      AND current_status = 'searching'
      AND (matching_expires_at IS NULL OR matching_expires_at > now())
    FOR UPDATE;

    IF v_customer_id IS NULL THEN RETURN false; END IF;
    
    -- Proibição de autoaceite
    IF v_customer_id = v_walker_id THEN RAISE EXCEPTION 'Auto-aceite proibido'; END IF;

    -- Validação do PetWalker (perfil, disponibilidade, ocupação)
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_walker_id 
          AND approval_status = 'approved' 
          AND availability_status = 'available'
          AND is_accepting_requests = true
          AND current_walk_id IS NULL
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'Walker indisponível ou não aprovado'; END IF;

    -- Validação da Oferta Pendente
    SELECT id INTO v_offer_id
    FROM public.walk_offers
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending'
    FOR UPDATE;

    IF v_offer_id IS NULL THEN RAISE EXCEPTION 'Oferta não encontrada ou já expirada'; END IF;

    -- Atualização Atômica da Sessão (Apenas um vencedor garantido pelo SELECT FOR UPDATE da sessão)
    UPDATE public.walk_sessions
    SET walker_id = v_walker_id,
        current_status = 'accepted',
        petwalker_notified_at = now(),
        updated_at = now()
    WHERE id = _session_id;

    -- Gestão das ofertas
    UPDATE public.walk_offers SET offer_status = 'accepted', updated_at = now() WHERE id = v_offer_id;
    UPDATE public.walk_offers SET offer_status = 'expired', updated_at = now() WHERE session_id = _session_id AND id <> v_offer_id AND offer_status = 'pending';
    
    -- Atualização do perfil do Walker
    UPDATE public.petwalker_profiles 
    SET current_walk_id = _session_id, 
        availability_status = 'busy',
        updated_at = now()
    WHERE user_id = v_walker_id;

    RETURN true;
END;
$$;

-- 2. decline_walk_offer
CREATE OR REPLACE FUNCTION public.decline_walk_offer(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid := auth.uid();
BEGIN
    IF v_walker_id IS NULL THEN RETURN false; END IF;

    -- Altera somente a oferta pendente pertencente ao PetWalker autenticado
    UPDATE public.walk_offers
    SET offer_status = 'declined',
        updated_at = now()
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending';

    RETURN FOUND;
END;
$$;

-- 3. create_walk_request (Restauração da Autoridade Financeira do Banco)
CREATE OR REPLACE FUNCTION public.create_walk_request(
    _pet_id uuid,
    _duration_minutes integer,
    _request_mode public.walk_request_mode,
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
    _start_time timestamptz;
BEGIN
    IF _user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    
    -- Validação de propriedade do pet
    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = _user_id) THEN
        RAISE EXCEPTION 'Pet inválido ou não pertence ao usuário';
    END IF;

    -- Validação de solicitação ativa duplicada
    IF EXISTS (
        SELECT 1 FROM public.walk_sessions 
        WHERE pet_id = _pet_id 
          AND current_status NOT IN ('completed', 'cancelled', 'expired')
    ) THEN
        RAISE EXCEPTION 'Já existe um passeio ativo para este pet';
    END IF;

    -- Validação de duração e incrementos
    IF _duration_minutes < 15 OR _duration_minutes % 15 != 0 THEN
        RAISE EXCEPTION 'Duração inválida (mínimo 15 minutos e incrementos de 15)';
    END IF;

    -- Validação de coordenadas
    IF _meeting_point_lat IS NULL OR _meeting_point_lng IS NULL THEN
        RAISE EXCEPTION 'Coordenadas do ponto de encontro são obrigatórias';
    END IF;

    -- Determinação do horário de início
    _start_time := CASE WHEN _request_mode = 'now' THEN now() ELSE _scheduled_for END;
    IF _request_mode = 'scheduled' AND (_scheduled_for IS NULL OR _scheduled_for <= now()) THEN
        RAISE EXCEPTION 'Agendamento deve ser para o futuro';
    END IF;

    -- Inserção de dados OPERACIONAIS apenas. 
    -- Campos financeiros (price_per_minute_cents, total_price_cents, etc) 
    -- serão calculados pelo trigger canônico 'trg_walk_session_financials'.
    INSERT INTO public.walk_sessions (
        customer_id,
        pet_id,
        planned_duration_minutes,
        current_status, 
        walk_type, 
        request_mode,
        scheduled_for,
        search_started_at,
        start_time,
        meeting_point_geom,
        meeting_point_address,
        search_radius_km
    ) VALUES (
        _user_id,
        _pet_id,
        _duration_minutes,
        'searching', 
        'livre', 
        _request_mode,
        _scheduled_for,
        CASE WHEN _request_mode = 'now' THEN now() ELSE NULL END,
        _start_time,
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address,
        1.5
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

-- Grants Finais
GRANT EXECUTE ON FUNCTION public.accept_walk_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_walk_offer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_walk_request(uuid, integer, public.walk_request_mode, timestamptz, double precision, double precision, text) TO authenticated, service_role;

-- 4. Outras RPCs operacionais garantindo segurança
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'heading_to_pickup', updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'accepted';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'arrived', updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'heading_to_pickup';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'in_progress', start_time = now(), updated_at = now()
    WHERE id = _session_id 
      AND walker_id = auth.uid() 
      AND current_status = 'arrived';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    _walker_id uuid := auth.uid();
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', end_time = now(), updated_at = now()
    WHERE id = _session_id 
      AND walker_id = _walker_id 
      AND (current_status = 'in_progress' OR current_status = 'returning');
    
    IF NOT FOUND THEN RETURN false; END IF;

    UPDATE public.petwalker_profiles SET current_walk_id = NULL, availability_status = 'available', updated_at = now() WHERE user_id = _walker_id;
    RETURN true;
END; $$;

GRANT EXECUTE ON FUNCTION public.petwalker_start_heading(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_arrive_pickup(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_start_walk(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.petwalker_complete_walk(uuid) TO authenticated, service_role;
