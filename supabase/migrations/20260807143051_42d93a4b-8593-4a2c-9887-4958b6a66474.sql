-- BASELINE EM BLOCOS: 2. FUNÇÕES E TRIGGERS
-- FUNCTIONS
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, email, onboarding_completed, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    new.email,
    false,
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_post_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET likes_count = likes_count - 1 WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.get_public_profiles(user_ids uuid[])
 RETURNS TABLE(id uuid, full_name text, avatar_url text, bio text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT id, full_name, avatar_url, bio
    FROM public.profiles
    WHERE id = ANY(user_ids);
$$;

CREATE OR REPLACE FUNCTION public.set_petwalker_availability(_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    IF _status NOT IN ('available', 'offline') THEN RAISE EXCEPTION 'Status inválido.'; END IF;
    IF NOT public.has_role(auth.uid(), 'petwalker') THEN RAISE EXCEPTION 'Acesso negado.'; END IF;
    UPDATE public.petwalker_profiles SET availability_status = _status, is_accepting_requests = (_status = 'available'), last_online_at = now(), updated_at = now()
    WHERE user_id = auth.uid() AND approval_status = 'approved' AND profile_completed = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(_public_bio text, _experience_years integer, _service_radius_km integer, _price_30_minutes numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    UPDATE public.petwalker_profiles SET public_bio = _public_bio, experience_years = _experience_years, service_radius_km = _service_radius_km, price_30_minutes = _price_30_minutes, profile_completed = true, updated_at = now()
    WHERE user_id = auth.uid() AND approval_status = 'approved';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_petwalker_application(_application_id uuid, _reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.approve_petwalker_application(_application_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE _target_user_id uuid;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Acesso negado.'; END IF;
    SELECT user_id INTO _target_user_id FROM public.petwalker_applications WHERE id = _application_id FOR UPDATE;
    UPDATE public.petwalker_applications SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid() WHERE id = _application_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (_target_user_id, 'user'), (_target_user_id, 'petwalker') ON CONFLICT DO NOTHING;
    INSERT INTO public.petwalker_profiles (user_id, approval_status, last_online_at) VALUES (_target_user_id, 'approved', now()) ON CONFLICT (user_id) DO UPDATE SET approval_status = 'approved';
    RETURN json_build_object('user_id', _target_user_id);
END;
$$;

-- TRIGGERS
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pets_updated_at BEFORE UPDATE ON public.pets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER on_post_like AFTER INSERT OR DELETE ON public.post_likes FOR EACH ROW EXECUTE FUNCTION handle_post_like();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
