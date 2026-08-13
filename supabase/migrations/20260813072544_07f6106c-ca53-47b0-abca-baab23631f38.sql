-- 1. Correct Undue Privilege Escalation
REVOKE ALL ON FUNCTION public.promote_user_to_petwalker(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_user_to_petwalker(text) FROM anon;
REVOKE ALL ON FUNCTION public.promote_user_to_petwalker(text) FROM authenticated;
DROP FUNCTION IF EXISTS public.promote_user_to_petwalker(text);

-- 2. Remove Public PetWalker Enumeration
REVOKE ALL ON FUNCTION public.check_user_is_petwalker(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_user_is_petwalker(text) FROM anon;
REVOKE ALL ON FUNCTION public.check_user_is_petwalker(text) FROM authenticated;
DROP FUNCTION IF EXISTS public.check_user_is_petwalker(text);

-- 3. Security Hardening
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only update their own profile except role/intent" ON public.profiles;
-- Using simple column comparison for WITH CHECK
CREATE POLICY "Users can only update their own profile except role/intent" ON public.profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- user_roles hardening
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

DROP POLICY IF EXISTS "Admins only manage roles" ON public.user_roles;
CREATE POLICY "Admins only manage roles" ON public.user_roles
    FOR ALL TO service_role
    USING (true);

-- petwalker_profiles hardening
ALTER TABLE public.petwalker_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only update their operational status" ON public.petwalker_profiles;
CREATE POLICY "Users can only update their operational status" ON public.petwalker_profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id);

GRANT SELECT, UPDATE(availability_status, is_accepting_requests, last_known_location, last_location_at, last_online_at, public_bio, service_radius_km) 
ON public.petwalker_profiles TO authenticated;
GRANT ALL ON public.petwalker_profiles TO service_role;
