
-- 00000000000000_baseline_schema.sql
-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ENUMS
DO $$ BEGIN
    CREATE TYPE public.app_role AS ENUM ('admin', 'petwalker', 'user');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- TABLES
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    bio TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'client',
    onboarding_completed BOOLEAN DEFAULT false,
    age INTEGER,
    birthday DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.app_role NOT NULL,
    UNIQUE(user_id, role)
);

CREATE TABLE IF NOT EXISTS public.pets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    breed TEXT NOT NULL,
    age NUMERIC,
    gender TEXT,
    weight NUMERIC,
    behavioral_notes TEXT,
    medical_info TEXT,
    emergency_contact TEXT,
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.petwalker_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    legal_name TEXT NOT NULL,
    birth_date DATE NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    experience_description TEXT NOT NULL,
    emergency_contact_name TEXT NOT NULL,
    emergency_contact_phone TEXT NOT NULL,
    document_status TEXT DEFAULT 'pending',
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES auth.users(id),
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.petwalker_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    approval_status TEXT DEFAULT 'pending',
    availability_status TEXT DEFAULT 'offline',
    is_accepting_requests BOOLEAN DEFAULT false,
    profile_completed BOOLEAN DEFAULT false,
    public_bio TEXT,
    experience_years INTEGER,
    service_radius_km INTEGER,
    price_30_minutes NUMERIC,
    rating_average NUMERIC DEFAULT 0,
    completed_walks INTEGER DEFAULT 0,
    cancellation_rate NUMERIC DEFAULT 0,
    last_online_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.walk_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
    walker_id UUID REFERENCES auth.users(id),
    walker_name TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    planned_duration_minutes INTEGER NOT NULL DEFAULT 30,
    actual_duration_minutes INTEGER,
    distance_km NUMERIC DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    route_coordinates JSONB,
    rating INTEGER,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    walk_type TEXT NOT NULL DEFAULT 'livre',
    local_stops JSONB DEFAULT '[]'::jsonb,
    home_location JSONB
);

CREATE TABLE IF NOT EXISTS public.petwalker_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    petwalker_id UUID NOT NULL REFERENCES auth.users(id),
    walk_session_id UUID REFERENCES public.walk_sessions(id),
    gross_amount NUMERIC NOT NULL,
    platform_fee NUMERIC NOT NULL,
    net_amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'pending',
    available_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    petshop_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC NOT NULL DEFAULT 0,
    weight NUMERIC,
    dimensions TEXT,
    origin_city TEXT,
    category TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE UNIQUE,
    quantity INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    image_url TEXT,
    likes_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.post_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    data JSONB
);

CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pet_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    notes TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.breed_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    breed TEXT NOT NULL UNIQUE,
    photo_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pet_models_3d (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    breed TEXT NOT NULL UNIQUE,
    glb_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
    'client'
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

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
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
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_pets_updated_at ON public.pets;
CREATE TRIGGER update_pets_updated_at BEFORE UPDATE ON public.pets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_posts_updated_at ON public.posts;
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_inventory_updated_at ON public.inventory;
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS on_post_like ON public.post_likes;
CREATE TRIGGER on_post_like AFTER INSERT OR DELETE ON public.post_likes FOR EACH ROW EXECUTE FUNCTION handle_post_like();

-- RLS & GRANTS
DO $$
DECLARE row record;
BEGIN
    FOR row IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'ALTER TABLE public.' || quote_ident(row.tablename) || ' ENABLE ROW LEVEL SECURITY';
        EXECUTE 'GRANT ALL ON public.' || quote_ident(row.tablename) || ' TO postgres, service_role';
    END LOOP;
END $$;

GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT UPDATE(full_name, phone, bio, avatar_url, onboarding_completed, updated_at, age, birthday) ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.pets TO anon, authenticated;
GRANT ALL ON public.pets TO authenticated;
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT ON public.post_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_likes TO authenticated;
GRANT SELECT ON public.post_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_comments TO authenticated;
GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO authenticated;
GRANT SELECT ON public.product_images TO anon, authenticated;
GRANT ALL ON public.product_images TO authenticated;
GRANT SELECT ON public.inventory TO anon, authenticated;
GRANT ALL ON public.inventory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pet_documents TO authenticated;
GRANT SELECT ON public.breed_photos TO anon, authenticated;
GRANT SELECT ON public.pet_models_3d TO authenticated;
GRANT SELECT ON public.petwalker_applications TO authenticated;
GRANT INSERT(user_id, legal_name, birth_date, phone, city, experience_description, emergency_contact_name, emergency_contact_phone) ON public.petwalker_applications TO authenticated;
GRANT SELECT, UPDATE ON public.petwalker_profiles TO authenticated;
GRANT SELECT ON public.petwalker_earnings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walk_sessions TO authenticated;

-- POLICIES
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id AND (role IS NULL OR role = 'client'));

DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone view active products" ON public.products;
CREATE POLICY "Anyone view active products" ON public.products FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Petshop owners manage products" ON public.products;
CREATE POLICY "Petshop owners manage products" ON public.products FOR ALL USING (auth.uid() = petshop_id);

DROP POLICY IF EXISTS "Users manage own pets" ON public.pets;
CREATE POLICY "Users manage own pets" ON public.pets FOR ALL USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "PetWalker read/update profile" ON public.petwalker_profiles;
CREATE POLICY "PetWalker read/update profile" ON public.petwalker_profiles FOR ALL TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Applicants view own" ON public.petwalker_applications;
CREATE POLICY "Applicants view own" ON public.petwalker_applications FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone view posts" ON public.posts;
CREATE POLICY "Anyone view posts" ON public.posts FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users manage own posts" ON public.posts;
CREATE POLICY "Users manage own posts" ON public.posts FOR ALL USING (auth.uid() = user_id);

-- STORAGE POLICIES
DO $$ BEGIN
    DROP POLICY IF EXISTS "Public access to pet photos" ON storage.objects;
    CREATE POLICY "Public access to pet photos" ON storage.objects FOR SELECT USING (bucket_id = 'pet-photos');
EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN
    DROP POLICY IF EXISTS "Users manage own pet photos" ON storage.objects;
    CREATE POLICY "Users manage own pet photos" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'pet-photos' AND auth.uid()::text = split_part(name, '/', 1));
EXCEPTION WHEN others THEN null; END $$;
