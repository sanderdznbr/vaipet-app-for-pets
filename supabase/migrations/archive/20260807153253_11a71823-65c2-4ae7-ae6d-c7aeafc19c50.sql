-- CLEANUP OLD OBJECTS
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS update_pets_updated_at ON public.pets;
DROP TRIGGER IF EXISTS update_petwalker_profiles_updated_at ON public.petwalker_profiles;
DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.get_public_profiles(uuid[]) CASCADE;
DROP FUNCTION IF EXISTS public.approve_petwalker_application(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.reject_petwalker_application(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.set_petwalker_availability(text) CASCADE;
DROP FUNCTION IF EXISTS public.update_petwalker_operational_profile(text, integer, numeric, integer) CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
