-- Revise and reinforce RLS policies for profiles
DO $$
BEGIN
    -- Remove redundant or broad policies if they exist to avoid confusion
    DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
    DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

    -- SELECT: Authenticated user can only see their own profile
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_select_own' AND tablename = 'profiles') THEN
        CREATE POLICY "profiles_select_own" ON public.profiles
        FOR SELECT TO authenticated
        USING (auth.uid() = id);
    END IF;

    -- UPDATE: Authenticated user can only update their own profile
    -- Added check to prevent users from changing their own role to 'petshop'
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_update_own' AND tablename = 'profiles') THEN
        CREATE POLICY "profiles_update_own" ON public.profiles
        FOR UPDATE TO authenticated
        USING (auth.uid() = id)
        WITH CHECK (
            auth.uid() = id AND 
            (CASE WHEN role = 'petshop' THEN (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'petshop' ELSE TRUE END)
        );
    END IF;
END $$;

-- Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Re-verify GRANTS
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
-- INSERT should be handled by trigger (security definer), but keeping for wizard if needed, 
-- though the trigger is the preferred way.
GRANT INSERT ON public.profiles TO authenticated;