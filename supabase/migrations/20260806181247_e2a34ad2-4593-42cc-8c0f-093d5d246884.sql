-- DROP functions before recreating with different signatures or structures
DROP FUNCTION IF EXISTS public.approve_petwalker_application(uuid);
DROP FUNCTION IF EXISTS public.reject_petwalker_application(uuid, text);
DROP FUNCTION IF EXISTS public.update_petwalker_operational_profile(text, integer, integer, numeric);
DROP FUNCTION IF EXISTS public.set_petwalker_availability(text);

-- 1. CORREÇÃO DA TABELA petwalker_applications
ALTER TABLE public.petwalker_applications 
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN submitted_at SET DEFAULT now();

UPDATE public.petwalker_applications 
SET status = 'pending' 
WHERE status = 'draft';

DROP POLICY IF EXISTS "petwalker_app_insert_own" ON public.petwalker_applications;
DROP POLICY IF EXISTS "petwalker_app_update_own" ON public.petwalker_applications;
REVOKE UPDATE ON public.petwalker_applications FROM authenticated;

CREATE POLICY "petwalker_app_insert_own"
ON public.petwalker_applications
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id AND 
  status = 'pending' AND
  legal_name IS NOT NULL AND
  birth_date IS NOT NULL AND
  phone IS NOT NULL
);

CREATE POLICY "petwalker_app_select_own"
ON public.petwalker_applications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 2. REFORÇO DE user_roles
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
DROP POLICY IF EXISTS "user_roles_insert_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_update_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_delete_own" ON public.user_roles;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- 3. FUNÇÕES ADMINISTRATIVAS SEGURAS
CREATE OR REPLACE FUNCTION public.approve_petwalker_application(_application_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _user_id uuid;
    _profile_exists boolean;
    _result json;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Acesso negado: Requer permissão de administrador.';
    END IF;

    SELECT user_id INTO _user_id
    FROM public.petwalker_applications
    WHERE id = _application_id AND status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Candidatura não encontrada ou não está em estado pendente.';
    END IF;

    IF _user_id = auth.uid() THEN
        RAISE EXCEPTION 'Um administrador não pode aprovar a própria candidatura.';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'approved',
        reviewed_at = now(),
        reviewed_by = auth.uid()
    WHERE id = _application_id;

    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'user') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'petwalker') ON CONFLICT DO NOTHING;

    SELECT EXISTS (SELECT 1 FROM public.petwalker_profiles WHERE user_id = _user_id) INTO _profile_exists;

    IF NOT _profile_exists THEN
        INSERT INTO public.petwalker_profiles (
            user_id, 
            approval_status, 
            availability_status, 
            is_accepting_requests,
            profile_completed
        ) VALUES (
            _user_id, 
            'approved', 
            'offline', 
            false,
            false
        );
    ELSE
        UPDATE public.petwalker_profiles
        SET approval_status = 'approved',
            updated_at = now()
        WHERE user_id = _user_id;
    END IF;

    _result := json_build_object(
        'user_id', _user_id,
        'application_status', 'approved',
        'profile_status', 'ready'
    );

    RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_petwalker_application(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_petwalker_application(_application_id uuid, _reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'rejected',
        rejection_reason = _reason,
        reviewed_at = now(),
        reviewed_by = auth.uid()
    WHERE id = _application_id AND status = 'pending';

    IF NOT FOUND THEN RETURN false; END IF;
    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_petwalker_application(uuid, text) TO authenticated;

-- 4. VALIDAÇÃO NAS RPCs OPERACIONAIS
CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(
    _public_bio text,
    _experience_years integer,
    _service_radius_km integer,
    _price_30_minutes numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF _experience_years < 0 OR _experience_years > 60 THEN
        RAISE EXCEPTION 'Experiência deve estar entre 0 e 60 anos.';
    END IF;
    IF _service_radius_km < 1 OR _service_radius_km > 50 THEN
        RAISE EXCEPTION 'Raio de serviço deve estar entre 1 e 50 km.';
    END IF;
    IF _price_30_minutes < 10.0 OR _price_30_minutes > 500.0 THEN
        RAISE EXCEPTION 'Preço deve estar entre R$ 10 e R$ 500.';
    END IF;
    IF char_length(_public_bio) > 1000 THEN
        RAISE EXCEPTION 'Bio muito longa (máximo 1000 caracteres).';
    END IF;

    UPDATE public.petwalker_profiles
    SET public_bio = _public_bio,
        experience_years = _experience_years,
        service_radius_km = _service_radius_km,
        price_30_minutes = _price_30_minutes,
        profile_completed = true,
        updated_at = now()
    WHERE user_id = auth.uid() AND approval_status = 'approved';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Perfil não encontrado ou não aprovado.';
    END IF;
    
    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF _status NOT IN ('available', 'offline') THEN
        RAISE EXCEPTION 'Status inválido. Use "available" ou "offline".';
    END IF;

    IF NOT public.has_role(auth.uid(), 'petwalker') THEN
        RAISE EXCEPTION 'Requer permissão de PetWalker.';
    END IF;

    UPDATE public.petwalker_profiles
    SET availability_status = _status::petwalker_availability,
        is_accepting_requests = (_status = 'available'),
        last_online_at = CASE WHEN _status = 'available' THEN now() ELSE last_online_at END,
        updated_at = now()
    WHERE user_id = auth.uid() 
      AND approval_status = 'approved'
      AND profile_completed = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Não foi possível alterar disponibilidade. Verifique se seu perfil está aprovado e completo.';
    END IF;
    
    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_petwalker_availability(text) TO authenticated;
