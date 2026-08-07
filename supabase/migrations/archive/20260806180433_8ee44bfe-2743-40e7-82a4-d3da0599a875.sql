
-- 1. Seguranca petwalker_applications
DROP POLICY IF EXISTS "Usuário acessa somente a própria inscrição" ON public.petwalker_applications;

CREATE POLICY "Candidatos podem ver sua propria inscricao"
ON public.petwalker_applications FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Candidatos podem criar uma inscricao"
ON public.petwalker_applications FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id AND 
    (status = 'draft' OR status IS NULL) AND
    (SELECT count(*) FROM public.petwalker_applications WHERE user_id = auth.uid()) = 0 AND
    (birth_date <= (CURRENT_DATE - INTERVAL '18 years'))
);

CREATE POLICY "Candidatos podem atualizar campos permitidos"
ON public.petwalker_applications FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
    auth.uid() = user_id AND
    status = 'draft' -- Só pode editar rascunho
);

-- Constraint para garantir apenas uma inscrição
ALTER TABLE public.petwalker_applications DROP CONSTRAINT IF EXISTS petwalker_applications_user_id_key;
ALTER TABLE public.petwalker_applications ADD CONSTRAINT petwalker_applications_user_id_key UNIQUE (user_id);

-- 2. Proteger user_roles
DROP POLICY IF EXISTS "Usuários podem ver suas próprias roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can select all rows" ON public.user_roles;

CREATE POLICY "Ver proprias roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 3. Restaurar handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, email, onboarding_completed, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    new.email,
    false,
    'client'
  )
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Função Administrativa de Aprovação
CREATE OR REPLACE FUNCTION public.approve_petwalker_application(application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT user_id INTO target_user_id FROM public.petwalker_applications WHERE id = application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inscrição não encontrada'; END IF;

  UPDATE public.petwalker_applications 
  SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid() 
  WHERE id = application_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, 'petwalker') ON CONFLICT DO NOTHING;

  INSERT INTO public.petwalker_profiles (user_id, approval_status) 
  VALUES (target_user_id, 'approved') 
  ON CONFLICT (user_id) DO UPDATE SET approval_status = 'approved';
END;
$$;

REVOKE ALL ON FUNCTION public.approve_petwalker_application(uuid) FROM public, anon, authenticated;

-- 5. RPC Disponibilidade
CREATE OR REPLACE FUNCTION public.set_petwalker_availability(new_availability text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'petwalker') THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM public.petwalker_profiles 
    WHERE user_id = auth.uid() 
    AND approval_status = 'approved' 
    AND profile_completed = true
  ) THEN
    RAISE EXCEPTION 'Perfil não elegível para disponibilidade (deve ser aprovado e completo)';
  END IF;

  UPDATE public.petwalker_profiles 
  SET availability_status = new_availability, 
      is_accepting_requests = (new_availability = 'available'),
      last_online_at = now(),
      updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.set_petwalker_availability(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_petwalker_availability(text) TO authenticated;

-- 6. RPC Onboarding/Update Perfil
CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(
    p_bio text,
    p_experience_years integer,
    p_radius integer,
    p_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'petwalker') THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE public.petwalker_profiles
  SET public_bio = p_bio,
      experience_years = p_experience_years,
      service_radius_km = p_radius,
      price_30_minutes = p_price,
      profile_completed = true,
      updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer, integer, numeric) TO authenticated;

-- 7. FK e Ganhos
ALTER TABLE public.petwalker_earnings DROP CONSTRAINT IF EXISTS petwalker_earnings_walk_session_id_fkey;
ALTER TABLE public.petwalker_earnings 
ADD CONSTRAINT petwalker_earnings_walk_session_id_fkey 
FOREIGN KEY (walk_session_id) REFERENCES public.walk_sessions(id);
