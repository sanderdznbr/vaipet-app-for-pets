-- Phase 2: Transactional Correction
-- Normalizes the email_change field from literal NULL to empty string for the problematic user.
-- This fixes the Supabase Auth API pagination 500 error.

DO $$
DECLARE
    affected_rows int;
    user_id_val uuid := '8258cffe-9808-41b5-a2ae-29af6b4371a1';
    target_email text := 'petwalker@gmail.com';
BEGIN
    -- Validation: Ensure user exists and has NULL email_change
    IF NOT EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = user_id_val 
          AND email = target_email 
          AND email_change IS NULL
    ) THEN
        RAISE EXCEPTION 'Pre-validation failed: User not found or email_change is not NULL';
    END IF;

    -- Update
    UPDATE auth.users
    SET email_change = ''
    WHERE id = user_id_val
      AND email = target_email
      AND email_change IS NULL;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    IF affected_rows != 1 THEN
        RAISE EXCEPTION 'Expected 1 row to be affected, got %', affected_rows;
    END IF;

    RAISE NOTICE 'Remediation successful: 1 row updated.';
END $$;
