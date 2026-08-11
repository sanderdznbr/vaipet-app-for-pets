
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'petwalker@gmail.com';

    IF v_user_id IS NULL THEN
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password, 
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, 
            confirmation_token, recovery_token, is_super_admin
        )
        VALUES (
            '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 
            'petwalker@gmail.com', crypt('admin123', gen_salt('bf')), 
            now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), 
            '', '', false
        )
        RETURNING id INTO v_user_id;
    END IF;

    UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = v_user_id;

    INSERT INTO public.profiles (id, email, full_name, signup_intent)
    VALUES (v_user_id, 'petwalker@gmail.com', 'Pet Walker Test', 'petwalker')
    ON CONFLICT (id) DO UPDATE SET signup_intent = 'petwalker';

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_roles' AND table_schema = 'public') THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (v_user_id, 'petwalker')
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    -- Tentar apenas o básico e parar de chutar nomes de tabelas operacionais se não temos certeza
END $$;
