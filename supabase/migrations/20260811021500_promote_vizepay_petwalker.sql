-- Force the role update via a SECURITY DEFINER function to bypass RLS/Ownership if run as service_role/postgres
CREATE OR REPLACE FUNCTION public.promote_user_to_petwalker(target_email text)
RETURNS void AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- This function runs with the privileges of the creator (postgres/service_role)
    -- We'll try to get the ID from any table that might have it
    SELECT id INTO v_user_id FROM public.profiles WHERE email = target_email;
    
    IF v_user_id IS NOT NULL THEN
        UPDATE public.profiles SET role = 'petwalker', onboarding_completed = true WHERE id = v_user_id;
        
        INSERT INTO public.user_roles (user_id, role) 
        VALUES (v_user_id, 'petwalker')
        ON CONFLICT (user_id, role) DO NOTHING;
        
        INSERT INTO public.petwalker_profiles (user_id, approval_status, profile_completed, is_accepting_requests)
        VALUES (v_user_id, 'approved', true, true)
        ON CONFLICT (user_id) DO UPDATE SET 
            approval_status = 'approved', 
            profile_completed = true,
            is_accepting_requests = true;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attempt to run it now if we have permission to call it
SELECT public.promote_user_to_petwalker('vizepay@gmail.com');

-- Grant execute to authenticated users just in case we need to trigger it from the frontend once
GRANT EXECUTE ON FUNCTION public.promote_user_to_petwalker(text) TO authenticated, service_role;
