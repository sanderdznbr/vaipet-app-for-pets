DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signup_intent_type') THEN
        CREATE TYPE public.signup_intent_type AS ENUM ('pet_owner', 'petwalker');
    END IF;
END $$;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_intent public.signup_intent_type;

CREATE OR REPLACE FUNCTION public.set_signup_intent(_intent public.signup_intent_type)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET signup_intent = _intent
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.set_signup_intent(public.signup_intent_type) TO authenticated;
