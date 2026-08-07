-- DROPS with CASCADE to ensure clean slate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS public.approve_petwalker_application(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.reject_petwalker_application(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_public_profiles() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- Enums
DO $$ BEGIN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'petshop', 'petwalker');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.application_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    phone text,
    avatar_url text,
    updated_at timestamp with time zone DEFAULT now()
);

-- 2. user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role public.app_role NOT NULL,
    UNIQUE (user_id, role)
);

-- 3. pets
CREATE TABLE IF NOT EXISTS public.pets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    species text NOT NULL,
    breed text,
    birth_date date,
    photo_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 4. petwalker_applications
CREATE TABLE IF NOT EXISTS public.petwalker_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    full_name text NOT NULL,
    age integer NOT NULL CHECK (age >= 18),
    experience_years integer DEFAULT 0,
    about_me text,
    location_radius integer NOT NULL DEFAULT 5,
    base_price decimal(10,2) NOT NULL DEFAULT 30.00,
    status public.application_status DEFAULT 'pending',
    submitted_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by uuid REFERENCES auth.users(id)
);

-- 5. petwalker_profiles
CREATE TABLE IF NOT EXISTS public.petwalker_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    is_active boolean DEFAULT true,
    rating decimal(3,2) DEFAULT 5.00,
    total_walks integer DEFAULT 0,
    bio text,
    service_radius integer NOT NULL DEFAULT 5,
    price_per_walk decimal(10,2) NOT NULL DEFAULT 30.00,
    available_hours jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 6. walk_sessions
CREATE TABLE IF NOT EXISTS public.walk_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id uuid REFERENCES public.pets(id) ON DELETE CASCADE NOT NULL,
    walker_id uuid REFERENCES public.petwalker_profiles(user_id) ON DELETE CASCADE NOT NULL,
    status text NOT NULL DEFAULT 'scheduled',
    scheduled_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    price decimal(10,2) NOT NULL,
    rating integer CHECK (rating >= 1 AND rating <= 5),
    feedback text,
    created_at timestamp with time zone DEFAULT now()
);

-- 7. petwalker_earnings
CREATE TABLE IF NOT EXISTS public.petwalker_earnings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    walker_id uuid REFERENCES public.petwalker_profiles(user_id) ON DELETE CASCADE NOT NULL,
    walk_session_id uuid REFERENCES public.walk_sessions(id),
    amount decimal(10,2) NOT NULL,
    status text DEFAULT 'pending',
    created_at timestamp with time zone DEFAULT now()
);

-- 8. products
CREATE TABLE IF NOT EXISTS public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    price decimal(10,2) NOT NULL,
    category text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 9. product_images
CREATE TABLE IF NOT EXISTS public.product_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    image_url text NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- 10. inventory
CREATE TABLE IF NOT EXISTS public.inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL UNIQUE,
    quantity integer NOT NULL DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);

-- 11. posts
CREATE TABLE IF NOT EXISTS public.posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    content text NOT NULL,
    media_url text,
    media_type text,
    created_at timestamp with time zone DEFAULT now()
);

-- 12. post_likes
CREATE TABLE IF NOT EXISTS public.post_likes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE (post_id, user_id)
);

-- 13. post_comments
CREATE TABLE IF NOT EXISTS public.post_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- 14. notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    type text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

-- 15. locations
CREATE TABLE IF NOT EXISTS public.locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    latitude decimal(9,6),
    longitude decimal(9,6),
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- 16. pet_documents
CREATE TABLE IF NOT EXISTS public.pet_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id uuid REFERENCES public.pets(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    file_url text NOT NULL,
    type text,
    created_at timestamp with time zone DEFAULT now()
);

-- 17. breed_photos
CREATE TABLE IF NOT EXISTS public.breed_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    breed_name text NOT NULL,
    image_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- 18. pet_models_3d
CREATE TABLE IF NOT EXISTS public.pet_models_3d (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id uuid REFERENCES public.pets(id) ON DELETE CASCADE NOT NULL,
    model_url text NOT NULL,
    task_id text,
    status text DEFAULT 'pending',
    created_at timestamp with time zone DEFAULT now()
);

-- FUNCTIONS
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url');
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_profiles()
RETURNS TABLE (id uuid, full_name text, avatar_url text) AS $$
BEGIN
    RETURN QUERY SELECT p.id, p.full_name, p.avatar_url FROM public.profiles p;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.approve_petwalker_application(application_id uuid)
RETURNS void AS $$
DECLARE
    v_user_id uuid;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = application_id AND status = 'pending'
    RETURNING user_id INTO v_user_id;

    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (v_user_id, 'petwalker')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.petwalker_profiles (user_id)
        VALUES (v_user_id)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_petwalker_application(application_id uuid)
RETURNS void AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = application_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- TRIGGERS
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pets_updated_at
    BEFORE UPDATE ON public.pets
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS & GRANTS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petwalker_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petwalker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petwalker_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pet_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.breed_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pet_models_3d ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.petwalker_profiles TO anon;
GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.product_images TO anon;
GRANT SELECT ON public.posts TO anon;
GRANT SELECT ON public.post_comments TO anon;
GRANT SELECT ON public.breed_photos TO anon;

-- Revoke role update from users
REVOKE UPDATE (role) ON public.user_roles FROM authenticated;

-- Policies
DO $$ BEGIN
    CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Public profiles are readable" ON public.profiles FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can see their roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Owners can manage their pets" ON public.pets FOR ALL TO authenticated USING (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can apply to be petwalkers" ON public.petwalker_applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can see their own application" ON public.petwalker_applications FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Petwalkers can see their profile" ON public.petwalker_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id OR true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Petwalkers can update their profile" ON public.petwalker_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;
