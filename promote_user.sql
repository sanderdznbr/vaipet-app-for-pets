CREATE OR REPLACE FUNCTION public.confirm_and_promote_user_by_email(target_email text, target_role text)
RETURNS json AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- This function MUST be run by a superuser/admin to modify auth.users, 
    -- but on Supabase we can use it to update auth.users if we are the owner.
    -- However, we don't have superuser here.
    
    -- Let's try to find the user ID from the profiles table (if it exists)
    SELECT id INTO v_user_id FROM public.profiles WHERE email = target_email;
    
    IF v_user_id IS NULL THEN
        -- If not in profiles, we can't do much without auth.users access
        RETURN json_build_object('success', false, 'message', 'User profile not found for email: ' || target_email);
    END IF;

    -- Update profile role
    UPDATE public.profiles SET role = target_role WHERE id = v_user_id;
    
    -- Update user_roles
    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, target_role::public.app_role);
    
    -- If petwalker, ensure petwalker_profile exists
    IF target_role = 'petwalker' THEN
        INSERT INTO public.petwalker_profiles (user_id, approval_status, profile_completed)
        VALUES (v_user_id, 'approved', true)
        ON CONFLICT (user_id) DO UPDATE SET approval_status = 'approved', profile_completed = true;
    END IF;

    RETURN json_build_object('success', true, 'user_id', v_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
