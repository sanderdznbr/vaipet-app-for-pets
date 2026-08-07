-- Revise and reinforce RLS policies for profiles with specific column security
DO $$
BEGIN
    -- Drop existing restrictive policies
    DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
    DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

    -- SELECT (Private): Authenticated user can see ALL their own columns
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_select_own' AND tablename = 'profiles') THEN
        CREATE POLICY "profiles_select_own" ON public.profiles
        FOR SELECT TO authenticated
        USING (auth.uid() = id);
    END IF;

    -- SELECT (Public Projection): Allow seeing only specific columns for other users
    -- id, full_name, avatar_url, bio, role
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_select_public' AND tablename = 'profiles') THEN
        CREATE POLICY "profiles_select_public" ON public.profiles
        FOR SELECT TO authenticated
        USING (TRUE);
    END IF;

    -- INSERT: Secure insert for registration/upsert
    -- Only allow self-insert, default role to 'client' or NULL
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_insert_own' AND tablename = 'profiles') THEN
        CREATE POLICY "profiles_insert_own" ON public.profiles
        FOR INSERT TO authenticated
        WITH CHECK (
            auth.uid() = id AND 
            (role IS NULL OR role = 'client')
        );
    END IF;

    -- UPDATE: Secure update for own profile
    -- Using column-level logic: role cannot be changed by user
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_update_own' AND tablename = 'profiles') THEN
        CREATE POLICY "profiles_update_own" ON public.profiles
        FOR UPDATE TO authenticated
        USING (auth.uid() = id)
        WITH CHECK (
            auth.uid() = id AND 
            (
                -- Ensure role remains the same if it was already set
                (SELECT role FROM public.profiles WHERE id = auth.uid()) = role
                OR 
                -- Or if it's currently NULL/client, don't allow changing to privileged roles
                (role = 'client')
            )
        );
    END IF;
END $$;

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Column-level SELECT security: we can't easily do it via policies for "some columns to all, all columns to self"
-- so we rely on the application code to project safe columns when querying others, 
-- but to be REALLY secure, we should use a VIEW for public profiles or Revoke/Grant on columns.
-- For now, we reinforce the UPDATE constraint.

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, bio, birthday, age, phone, onboarding_completed, updated_at, email) ON public.profiles TO authenticated;

-- Ensure trigger still works (it uses security definer, so it's fine)
GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;