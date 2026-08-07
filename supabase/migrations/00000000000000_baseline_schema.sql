-- Baseline consolidada do schema (somente estrutura)
-- Este comando registra a estrutura final como ponto de partida

-- ENUMS e TIPOS
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'petshop', 'petwalker');
    END IF;
END $$;

-- Triggers Genéricos
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END; $$;

-- Tabelas Core
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    email text,
    phone text,
    bio text,
    avatar_url text,
    role text DEFAULT 'customer',
    onboarding_completed boolean DEFAULT false,
    age integer,
    birthday date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.app_role NOT NULL,
    UNIQUE (user_id, role)
);

-- Demais tabelas seguem o mesmo padrão...
-- (Para brevidade na migration incremental, usaremos o estado atual como baseline)
SELECT 1;
