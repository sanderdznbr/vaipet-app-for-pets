-- Drop de funções que mudam o tipo de retorno
DROP FUNCTION IF EXISTS public.approve_petwalker_application(uuid);
DROP FUNCTION IF EXISTS public.reject_petwalker_application(uuid, text);
DROP FUNCTION IF EXISTS public.set_petwalker_availability(text);
DROP FUNCTION IF EXISTS public.update_petwalker_operational_profile(text, integer, integer, numeric);

-- 1. Ajustar petwalker_applications
ALTER TABLE public.petwalker_applications ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.petwalker_applications ALTER COLUMN submitted_at SET DEFAULT now();

-- Migrar candidaturas draft (seguro)
UPDATE public.petwalker_applications SET status = 'pending' WHERE status = 'draft';

-- Bloquear atualização direta da candidatura
REVOKE UPDATE ON public.petwalker_applications FROM authenticated;
DROP POLICY IF EXISTS "Users can update own application" ON public.petwalker_applications;

-- Garantir inserção apenas de campos permitidos via RLS
DROP POLICY IF EXISTS "Users can insert own application" ON public.petwalker_applications;
CREATE POLICY "Users can insert own application"
ON public.petwalker_applications
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id AND
  status = 'pending'
);

-- 2. Reforçar user_roles
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
DROP POLICY IF EXISTS "Admins can manage user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;

CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 3. Função administrativa de aprovação transacional
CREATE OR REPLACE FUNCTION public.approve_petwalker_application(_application_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _target_user_id uuid;
    _current_status text;
BEGIN
    -- Verificar se é admin
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores.';
    END IF;

    -- Bloquear linha e verificar status
    SELECT user_id, status INTO _target_user_id, _current_status
    FROM public.petwalker_applications
    WHERE id = _application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Candidatura não encontrada.';
    END IF;

    IF _current_status != 'pending' THEN
        RAISE EXCEPTION 'Apenas candidaturas pendentes podem ser aprovadas. Status atual: %', _current_status;
    END IF;

    -- 1. Aprovar candidatura
    UPDATE public.petwalker_applications
    SET 
        status = 'approved',
        reviewed_at = now(),
        reviewed_by = auth.uid()
    WHERE id = _application_id;

    -- 2. Garantir roles
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, 'petwalker')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- 3. Criar ou atualizar perfil
    INSERT INTO public.petwalker_profiles (user_id, approval_status, last_online_at)
    VALUES (_target_user_id, 'approved', now())
    ON CONFLICT (user_id) DO UPDATE
    SET approval_status = 'approved';

    RETURN json_build_object(
        'user_id', _target_user_id,
        'application_status', 'approved',
        'profile_status', 'approved'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_petwalker_application(uuid) TO authenticated;

-- 4. Função administrativa de rejeição
CREATE OR REPLACE FUNCTION public.reject_petwalker_application(_application_id uuid, _reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Acesso negado: apenas administradores.';
    END IF;

    UPDATE public.petwalker_applications
    SET 
        status = 'rejected',
        rejection_reason = _reason,
        reviewed_at = now(),
        reviewed_by = auth.uid()
    WHERE id = _application_id AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Candidatura não encontrada ou não está pendente.';
    END IF;

    RETURN json_build_object('status', 'rejected');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_petwalker_application(uuid, text) TO authenticated;

-- 5. RPC de disponibilidade com validações rígidas
CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF _status NOT IN ('available', 'offline') THEN
        RAISE EXCEPTION 'Status inválido. Apenas available ou offline.';
    END IF;

    IF NOT public.has_role(auth.uid(), 'petwalker') THEN
        RAISE EXCEPTION 'Acesso negado: apenas passeadores.';
    END IF;

    UPDATE public.petwalker_profiles
    SET 
        availability_status = _status,
        is_accepting_requests = (_status = 'available'),
        last_online_at = now(),
        updated_at = now()
    WHERE user_id = auth.uid()
      AND approval_status = 'approved'
      AND profile_completed = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Perfil não encontrado, não aprovado ou incompleto.';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_petwalker_availability(text) TO authenticated;

-- 6. RPC de atualização de perfil com validações
CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(
    _public_bio text,
    _experience_years integer,
    _service_radius_km integer,
    _price_30_minutes numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Validações
    IF length(_public_bio) > 1000 THEN RAISE EXCEPTION 'Bio muito longa (máx 1000).'; END IF;
    IF _experience_years < 0 OR _experience_years > 60 THEN RAISE EXCEPTION 'Anos de experiência inválidos.'; END IF;
    IF _service_radius_km < 1 OR _service_radius_km > 50 THEN RAISE EXCEPTION 'Raio deve ser entre 1 e 50 km.'; END IF;
    IF _price_30_minutes < 10 OR _price_30_minutes > 500 THEN RAISE EXCEPTION 'Preço deve ser entre R$ 10 e R$ 500.'; END IF;

    UPDATE public.petwalker_profiles
    SET 
        public_bio = _public_bio,
        experience_years = _experience_years,
        service_radius_km = _service_radius_km,
        price_30_minutes = _price_30_minutes,
        profile_completed = true,
        updated_at = now()
    WHERE user_id = auth.uid()
      AND approval_status = 'approved';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Perfil não encontrado ou não aprovado.';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, numeric) TO authenticated;
