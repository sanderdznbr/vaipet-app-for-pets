-- Baseline Schema
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'petshop', 'petwalker');
CREATE TYPE public.application_status AS ENUM ('pending', 'approved', 'rejected');

-- Functions
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tables

CREATE TABLE public.profiles (
    age integer DEFAULT 0,
    avatar_url timestamp with time zone,
    bio text,
    birthday date,
    created_at timestamp with time zone DEFAULT now(),
    email text,
    full_name text,
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    onboarding_completed boolean DEFAULT false,
    phone text,
    role text,
    updated_at timestamp with time zone
);

CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role text NOT NULL,
    user_id text NOT NULL,
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    UNIQUE (user_id, role)
);

CREATE TABLE public.pets (
    age integer DEFAULT 0,
    avatar_url timestamp with time zone,
    behavioral_notes text,
    breed text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    emergency_contact text,
    gender text,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active boolean DEFAULT false,
    medical_info text,
    name text NOT NULL,
    owner_id text NOT NULL,
    updated_at timestamp with time zone,
    weight numeric(10,2) DEFAULT 0.00,
    FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.petwalker_applications (
    birth_date timestamp with time zone NOT NULL,
    city text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    document_status timestamp with time zone,
    emergency_contact_name text NOT NULL,
    emergency_contact_phone text NOT NULL,
    experience_description text NOT NULL,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name text NOT NULL,
    phone text NOT NULL,
    rejection_reason text,
    reviewed_at timestamp with time zone,
    reviewed_by text,
    status timestamp with time zone NOT NULL,
    submitted_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    user_id text NOT NULL,
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    UNIQUE (user_id)
);

CREATE TABLE public.petwalker_profiles (
    approval_status timestamp with time zone,
    availability_status timestamp with time zone,
    cancellation_rate numeric(10,2) DEFAULT 0.00,
    completed_walks numeric(10,2) DEFAULT 0.00,
    created_at timestamp with time zone DEFAULT now(),
    experience_years integer DEFAULT 0,
    is_accepting_requests boolean DEFAULT false,
    last_online_at timestamp with time zone,
    price_30_minutes integer DEFAULT 0,
    profile_completed boolean DEFAULT false,
    public_bio text,
    rating_average integer DEFAULT 0,
    service_radius_km numeric(10,2) DEFAULT 0.00,
    updated_at timestamp with time zone,
    user_id text NOT NULL,
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    UNIQUE (user_id)
);

CREATE TABLE public.walk_sessions (
    actual_duration_minutes integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id text NOT NULL,
    distance_km numeric(10,2) DEFAULT 0.00,
    end_time timestamp with time zone,
    feedback text,
    home_location jsonb,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    local_stops jsonb,
    pet_id text NOT NULL,
    planned_duration_minutes integer DEFAULT 0 NOT NULL,
    rating numeric(10,2) DEFAULT 0.00,
    route_coordinates jsonb,
    start_time timestamp with time zone NOT NULL,
    status timestamp with time zone NOT NULL,
    walk_type text NOT NULL,
    walker_id text,
    walker_name text,
    FOREIGN KEY (customer_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE,
    FOREIGN KEY (walker_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.petwalker_earnings (
    available_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    gross_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    net_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    paid_at timestamp with time zone,
    petwalker_id text NOT NULL,
    platform_fee numeric(10,2) DEFAULT 0.00 NOT NULL,
    status timestamp with time zone,
    walk_session_id text,
    FOREIGN KEY (petwalker_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (walk_session_id) REFERENCES public.walk_sessions(id) ON DELETE SET NULL
);

CREATE TABLE public.products (
    category timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    description text,
    dimensions text,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active boolean DEFAULT false,
    name text NOT NULL,
    origin_city text,
    petshop_id text NOT NULL,
    price numeric(10,2) DEFAULT 0.00 NOT NULL,
    updated_at timestamp with time zone,
    weight numeric(10,2) DEFAULT 0.00
);

CREATE TABLE public.product_images (
    created_at timestamp with time zone DEFAULT now(),
    display_order numeric(10,2) DEFAULT 0.00,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url text NOT NULL,
    product_id text NOT NULL,
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE
);

CREATE TABLE public.inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id text NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone,
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
    UNIQUE (product_id)
);

CREATE TABLE public.posts (
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url text,
    likes_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone,
    user_id text NOT NULL,
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.post_likes (
    created_at timestamp with time zone DEFAULT now(),
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id text NOT NULL,
    user_id text NOT NULL,
    FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.post_comments (
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id text NOT NULL,
    user_id text NOT NULL,
    FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.notifications (
    created_at timestamp with time zone DEFAULT now(),
    data jsonb,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    is_read boolean DEFAULT false NOT NULL,
    message text NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    user_id text NOT NULL,
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.locations (
    address text,
    city text,
    created_at timestamp with time zone DEFAULT now(),
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    is_default boolean DEFAULT false,
    latitude numeric(10,2) DEFAULT 0.00,
    longitude numeric(10,2) DEFAULT 0.00,
    name text NOT NULL,
    postal_code text,
    state timestamp with time zone,
    user_id text NOT NULL,
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.pet_documents (
    document_type text NOT NULL,
    file_name text NOT NULL,
    file_path timestamp with time zone NOT NULL,
    file_size numeric(10,2) DEFAULT 0.00 NOT NULL,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mime_type text NOT NULL,
    notes text,
    pet_id text NOT NULL,
    uploaded_at timestamp with time zone,
    uploaded_by text,
    FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE
);

CREATE TABLE public.breed_photos (
    breed text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_url text NOT NULL
);

CREATE TABLE public.pet_models_3d (
    breed text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    glb_url text NOT NULL,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Security Functions
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (id uuid, full_name text, avatar_url text, bio text) AS $$
BEGIN
    RETURN QUERY 
    SELECT p.id, p.full_name, p.avatar_url, p.bio 
    FROM public.profiles p
    WHERE p.id = ANY(_user_ids);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, email)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url', NEW.email);
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    RETURN NEW;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.reject_petwalker_application(application_id uuid, reason text)
RETURNS void AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'rejected', rejection_reason = reason, reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = application_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.set_petwalker_availability(status text)
RETURNS void AS $$
BEGIN
    UPDATE public.petwalker_profiles
    SET availability_status = status, updated_at = now()
    WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(bio text, experience integer, radius integer, price numeric)
RETURNS void AS $$
BEGIN
    UPDATE public.petwalker_profiles
    SET public_bio = bio, experience_years = experience, service_radius_km = radius, price_30_minutes = price, updated_at = now()
    WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Triggers
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS & GRANTS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pets TO authenticated;
GRANT ALL ON public.pets TO service_role;
ALTER TABLE public.petwalker_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.petwalker_applications TO authenticated;
GRANT ALL ON public.petwalker_applications TO service_role;
ALTER TABLE public.petwalker_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.petwalker_profiles TO authenticated;
GRANT ALL ON public.petwalker_profiles TO service_role;
ALTER TABLE public.walk_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.walk_sessions TO authenticated;
GRANT ALL ON public.walk_sessions TO service_role;
ALTER TABLE public.petwalker_earnings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.petwalker_earnings TO authenticated;
GRANT ALL ON public.petwalker_earnings TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.product_images TO authenticated;
GRANT ALL ON public.product_images TO service_role;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.inventory TO authenticated;
GRANT ALL ON public.inventory TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.post_likes TO authenticated;
GRANT ALL ON public.post_likes TO service_role;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.post_comments TO authenticated;
GRANT ALL ON public.post_comments TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.pet_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pet_documents TO authenticated;
GRANT ALL ON public.pet_documents TO service_role;
ALTER TABLE public.breed_photos ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.breed_photos TO authenticated;
GRANT ALL ON public.breed_photos TO service_role;
ALTER TABLE public.pet_models_3d ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pet_models_3d TO authenticated;
GRANT ALL ON public.pet_models_3d TO service_role;

-- Specific Policies
-- Profiles: Private data protected
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
-- No direct public SELECT on profiles. Use get_public_profiles RPC.

-- Petwalker Profiles
CREATE POLICY "Anyone can view petwalker profiles" ON public.petwalker_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Petwalkers can update their operational fields" ON public.petwalker_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- User Roles
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE UPDATE ON public.user_roles FROM authenticated;
CREATE POLICY "Users can see their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Storage Buckets & Policies
-- Storage setup
INSERT INTO storage.buckets (id, name, public) VALUES ('pet-photos', 'pet-photos', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pet-documents', 'pet-documents', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true) ON CONFLICT DO NOTHING;

-- Storage RLS (in storage.objects)
CREATE POLICY "Public Access" ON storage.objects FOR SELECT TO public USING (bucket_id IN ('pet-photos', 'product-images'));
CREATE POLICY "Authenticated Upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id IN ('pet-photos', 'product-images', 'pet-documents'));

