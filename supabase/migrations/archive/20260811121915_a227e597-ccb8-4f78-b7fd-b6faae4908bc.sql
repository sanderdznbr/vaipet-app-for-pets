
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get user ID
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'petwalker@gmail.com';

    IF v_user_id IS NOT NULL THEN
        -- Ensure profile exists (idempotent)
        INSERT INTO public.profiles (id, email, full_name)
        VALUES (v_user_id, 'petwalker@gmail.com', 'Pet Walker Test')
        ON CONFLICT (id) DO NOTHING;

        -- Promote to petwalker role if roles table exists and uses 'petwalker'
        -- Checking if user_roles table exists and inserting
        IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_roles' AND table_schema = 'public') THEN
            INSERT INTO public.user_roles (user_id, role)
            VALUES (v_user_id, 'petwalker')
            ON CONFLICT (user_id, role) DO NOTHING;
        END IF;

        -- Ensure walker_profiles entry exists if the table exists
        IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'walker_profiles' AND table_schema = 'public') THEN
            INSERT INTO public.walker_profiles (id, status, is_operational)
            VALUES (v_user_id, 'approved', true)
            ON CONFLICT (id) DO NOTHING;
        END IF;
    END IF;
END $$;
