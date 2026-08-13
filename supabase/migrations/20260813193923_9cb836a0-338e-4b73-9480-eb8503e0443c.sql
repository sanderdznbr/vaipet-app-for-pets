
-- Migration: Restaurar RPCs Zero-Trust (Consolidado Phase 3.1 Corrective)
-- Data: 2026-08-13

-- 1. accept_walk_request (Restauração Completa)
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
    
    -- Bloquear sessão para escrita e validar estado
    SELECT customer_id INTO v_customer_id
    FROM public.walk_sessions
    WHERE id = _session_id
      AND current_status IN ('searching', 'offered')
      AND (matching_expires_at IS NULL OR matching_expires_at > now())
    FOR UPDATE;

    IF v_customer_id IS NULL THEN RETURN false; END IF;
    IF v_customer_id = v_walker_id THEN RAISE EXCEPTION 'Auto-aceite proibido'; END IF;

    -- Validar elegibilidade do PetWalker
    IF NOT EXISTS (
        SELECT 1 FROM public.petwalker_profiles 
        WHERE user_id = v_walker_id 
          AND approval_status = 'approved' 
          AND availability_status = 'available'
          AND is_accepting_requests = true
          AND current_walk_id IS NULL
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'Walker indisponível'; END IF;

    -- Validar existência da oferta pendente
    SELECT id INTO v_offer_id
    FROM public.walk_offers
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending'
    FOR UPDATE;

    IF v_offer_id IS NULL THEN RAISE EXCEPTION 'Oferta indisponível ou expirada'; END IF;

    -- Transação Atômica de Aceite
    UPDATE public.walk_sessions
    SET walker_id = v_walker_id,
        current_status = 'accepted',
        petwalker_notified_at = now(),
        updated_at = now()
    WHERE id = _session_id;

    UPDATE public.walk_offers SET offer_status = 'accepted', updated_at = now() WHERE id = v_offer_id;
    UPDATE public.walk_offers SET offer_status = 'expired', updated_at = now() WHERE session_id = _session_id AND id <> v_offer_id AND offer_status = 'pending';
    UPDATE public.petwalker_profiles SET current_walk_id = _session_id, availability_status = 'busy', updated_at = now() WHERE user_id = v_walker_id;

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

    UPDATE public.walk_offers
    SET offer_status = 'declined',
        updated_at = now()
    WHERE session_id = _session_id
      AND walker_id = v_walker_id
      AND offer_status = 'pending';

    RETURN FOUND;
END;
$$;

-- 3. create_walk_request (Preservando lógica financeira e geolocalização)
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
    
    -- Validar propriedade do pet
    IF NOT EXISTS (SELECT 1 FROM public.pets WHERE id = _pet_id AND owner_id = _user_id) THEN
        RAISE EXCEPTION 'Pet inválido ou não pertence ao usuário';
    END IF;

    -- Validar se já existe pedido ativo para este pet
    IF EXISTS (
        SELECT 1 FROM public.walk_sessions 
        WHERE pet_id = _pet_id 
        AND current_status NOT IN ('completed', 'cancelled', 'expired')
    ) THEN
        RAISE EXCEPTION 'Este pet já possui um pedido em andamento';
    END IF;

    -- Regras de agendamento
    _start_time := CASE WHEN _request_mode = 'now' THEN now() ELSE _scheduled_for END;
    IF _request_mode = 'scheduled' AND (_scheduled_for IS NULL OR _scheduled_for <= now()) THEN
        RAISE EXCEPTION 'Agendamento deve ser para o futuro';
    END IF;

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
        search_radius_km,
        total_price_cents -- Garantindo que snapshot financeiro seja preservado se calculado aqui (ou via trigger)
    ) VALUES (
        _user_id,
        _pet_id,
        _duration_minutes,
        CASE WHEN _request_mode = 'now' THEN 'searching'::public.walk_status ELSE 'scheduled'::public.walk_status END, 
        'livre', 
        _request_mode,
        _scheduled_for,
        CASE WHEN _request_mode = 'now' THEN now() ELSE NULL END,
        _start_time,
        st_setsrid(st_point(_meeting_point_lng, _meeting_point_lat), 4326)::geography,
        _meeting_point_address,
        1.5,
        (_duration_minutes * 150) -- R$ 1,50/min canônico
    ) RETURNING id INTO _session_id;

    RETURN _session_id;
END;
$$;

-- 4. petwalker_complete_walk (Cleanup do Profile)
CREATE OR REPLACE FUNCTION public.petwalker_complete_walk(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_walker_id uuid := auth.uid();
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', 
        end_time = now(),
        updated_at = now()
    WHERE id = _session_id 
      AND walker_id = v_walker_id 
      AND current_status IN ('in_progress', 'returning');
    
    IF NOT FOUND THEN RETURN false; END IF;

    -- Cleanup do walker
    UPDATE public.petwalker_profiles 
    SET current_walk_id = NULL, 
        availability_status = 'available',
        completed_walks = completed_walks + 1,
        updated_at = now()
    WHERE user_id = v_walker_id;

    -- Expirar ofertas residuais desta sessão (se houver)
    UPDATE public.walk_offers SET offer_status = 'expired' WHERE session_id = _session_id AND offer_status = 'pending';

    RETURN true;
END;
$$;

-- 5. cancel_walk_session (Cleanup e Transição)
CREATE OR REPLACE FUNCTION public.cancel_walk_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_walker_id uuid;
BEGIN
    UPDATE public.walk_sessions
    SET current_status = 'cancelled',
        updated_at = now()
    WHERE id = _session_id 
      AND (customer_id = v_user_id OR walker_id = v_user_id)
      AND current_status NOT IN ('completed', 'cancelled', 'expired')
    RETURNING walker_id INTO v_walker_id;

    IF v_walker_id IS NOT NULL THEN
        UPDATE public.petwalker_profiles 
        SET current_walk_id = NULL, 
            availability_status = 'available',
            updated_at = now()
        WHERE user_id = v_walker_id;
    END IF;

    UPDATE public.walk_offers SET offer_status = 'expired' WHERE session_id = _session_id AND offer_status = 'pending';
END;
$$;

-- Outras RPCs ajustadas para current_status mantendo lógica original
CREATE OR REPLACE FUNCTION public.petwalker_start_heading(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions SET current_status = 'heading_to_pickup', updated_at = now() 
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status = 'accepted';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_arrive_pickup(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions SET current_status = 'arrived', updated_at = now() 
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status = 'heading_to_pickup';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.petwalker_start_walk(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions SET current_status = 'in_progress', start_time = now(), updated_at = now() 
    WHERE id = _session_id AND walker_id = auth.uid() AND current_status = 'arrived';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.customer_cancel_search(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions SET current_status = 'cancelled', updated_at = now()
    WHERE id = _session_id AND customer_id = auth.uid() AND current_status IN ('searching', 'offered', 'scheduled');
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.customer_request_return(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.walk_sessions SET current_status = 'returning', updated_at = now()
    WHERE id = _session_id AND customer_id = auth.uid() AND current_status = 'in_progress';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.customer_confirm_arrival(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_walker_id uuid;
BEGIN
    UPDATE public.walk_sessions 
    SET current_status = 'completed', end_time = now(), updated_at = now()
    WHERE id = _session_id AND customer_id = auth.uid() AND current_status IN ('returning', 'in_progress')
    RETURNING walker_id INTO v_walker_id;
    
    IF NOT FOUND THEN RETURN false; END IF;

    IF v_walker_id IS NOT NULL THEN
        UPDATE public.petwalker_profiles SET current_walk_id = NULL, availability_status = 'available' WHERE user_id = v_walker_id;
    END IF;
    RETURN true;
END; $$;
