
-- FASE 1: PetWalker - Adicionar permissão petwalker ao enum (Se não existir)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'app_role' AND e.enumlabel = 'petwalker') THEN
    ALTER TYPE public.app_role ADD VALUE 'petwalker';
  END IF;
END $$;

-- FASE 2: Criar petwalker_applications
CREATE TABLE IF NOT EXISTS public.petwalker_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'suspended')),
    legal_name TEXT NOT NULL,
    birth_date DATE NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    experience_description TEXT NOT NULL,
    emergency_contact_name TEXT NOT NULL,
    emergency_contact_phone TEXT NOT NULL,
    document_status TEXT DEFAULT 'pending',
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.petwalker_applications TO authenticated;
GRANT ALL ON public.petwalker_applications TO service_role;
ALTER TABLE public.petwalker_applications ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Usuário acessa somente a própria inscrição') THEN
    CREATE POLICY "Usuário acessa somente a própria inscrição" ON public.petwalker_applications
        FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- FASE 3: Criar petwalker_profiles
CREATE TABLE IF NOT EXISTS public.petwalker_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended')),
    availability_status TEXT DEFAULT 'offline' CHECK (availability_status IN ('offline', 'available', 'busy')),
    is_accepting_requests BOOLEAN DEFAULT FALSE,
    profile_completed BOOLEAN DEFAULT FALSE,
    public_bio TEXT,
    experience_years INTEGER,
    service_radius_km INTEGER,
    price_30_minutes NUMERIC,
    rating_average NUMERIC DEFAULT 0,
    completed_walks INTEGER DEFAULT 0,
    cancellation_rate NUMERIC DEFAULT 0,
    last_online_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT ON public.petwalker_profiles TO authenticated;
GRANT ALL ON public.petwalker_profiles TO service_role;
ALTER TABLE public.petwalker_profiles ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'PetWalker lê e atualiza próprio perfil') THEN
    CREATE POLICY "PetWalker lê e atualiza próprio perfil" ON public.petwalker_profiles
        FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- FASE 4: Criar petwalker_earnings
CREATE TABLE IF NOT EXISTS public.petwalker_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    petwalker_id UUID NOT NULL REFERENCES auth.users(id),
    walk_session_id UUID,
    gross_amount NUMERIC NOT NULL,
    platform_fee NUMERIC NOT NULL,
    net_amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'paid', 'reversed')),
    available_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT ON public.petwalker_earnings TO authenticated;
GRANT ALL ON public.petwalker_earnings TO service_role;
ALTER TABLE public.petwalker_earnings ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'PetWalker visualiza próprios ganhos') THEN
    CREATE POLICY "PetWalker visualiza próprios ganhos" ON public.petwalker_earnings
        FOR SELECT TO authenticated USING (auth.uid() = petwalker_id);
  END IF;
END $$;

-- FASE 5: Adicionar walker_id a walk_sessions
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS walker_id UUID REFERENCES auth.users(id);

-- FASE 6: Garantir 'user' para existentes e atualizar trigger
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::public.app_role FROM auth.users
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', 'client');
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'user');
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
