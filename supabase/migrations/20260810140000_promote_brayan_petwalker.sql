-- Promoting brayanwilliansas@gmail.com to Petwalker and Admin for testing
DO $$
DECLARE
    target_user_id uuid;
BEGIN
    SELECT id INTO target_user_id FROM auth.users WHERE lower(email) = 'brayanwilliansas@gmail.com';

    IF target_user_id IS NOT NULL THEN
        -- Assign Petwalker role
        INSERT INTO public.user_roles (user_id, role)
        VALUES (target_user_id, 'petwalker')
        ON CONFLICT (user_id, role) DO NOTHING;

        -- Also assign Admin role so he can test the admin panel he just asked to fix
        INSERT INTO public.user_roles (user_id, role)
        VALUES (target_user_id, 'admin')
        ON CONFLICT (user_id, role) DO NOTHING;

        -- Create/Update petwalker profile
        INSERT INTO public.petwalker_profiles (id, status, profile_completed)
        VALUES (target_user_id, 'approved', true)
        ON CONFLICT (id) DO UPDATE
        SET status = 'approved',
            profile_completed = true;
            
        -- Ensure application is marked as approved if it exists
        UPDATE public.petwalker_applications
        SET status = 'approved',
            reviewed_at = now()
        WHERE user_id = target_user_id;
    END IF;
END $$;
