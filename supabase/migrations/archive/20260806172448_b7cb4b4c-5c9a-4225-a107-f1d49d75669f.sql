-- 1. Remover policy insegura profiles_select_public
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;

-- 2. Garantir que profiles_select_own permita acesso apenas ao próprio perfil
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
FOR SELECT TO authenticated
USING (auth.uid() = id);

-- 3. Criar função RPC segura para perfis públicos
CREATE OR REPLACE FUNCTION public.get_public_profiles(user_ids uuid[])
RETURNS TABLE (
    id uuid,
    full_name text,
    avatar_url text,
    bio text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT id, full_name, avatar_url, bio
    FROM public.profiles
    WHERE id = ANY(user_ids);
$$;

-- Revogar execução de PUBLIC e conceder a authenticated
REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

-- 5. Simplificar e reforçar profiles_update_own
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 6. Manter profiles_insert_own restrita
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
    auth.uid() = id AND 
    (role IS NULL OR role = 'client')
);

-- Reforçar privilégios de coluna
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, bio, birthday, age, phone, onboarding_completed, updated_at) ON public.profiles TO authenticated;
