-- BASELINE EM BLOCOS: 3. SEGURANÇA (RLS, GRANTS, POLICIES)
-- GRANTS & RLS ENABLE
DO $$
DECLARE row record;
BEGIN
    FOR row IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'ALTER TABLE public.' || quote_ident(row.tablename) || ' ENABLE ROW LEVEL SECURITY';
        EXECUTE 'GRANT ALL ON public.' || quote_ident(row.tablename) || ' TO postgres, service_role';
    END LOOP;
END $$;

-- SPECIFIC GRANTS
GRANT SELECT ON public.profiles TO anon, authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE(full_name, phone, bio, avatar_url, onboarding_completed, updated_at, age, birthday) ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.pets TO anon, authenticated;
GRANT ALL ON public.pets TO authenticated;
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO authenticated;
GRANT SELECT ON public.product_images TO anon, authenticated;
GRANT ALL ON public.product_images TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pet_documents TO authenticated;
GRANT SELECT ON public.breed_photos TO anon, authenticated;
GRANT SELECT ON public.pet_models_3d TO authenticated;
GRANT SELECT ON public.petwalker_applications TO authenticated;
GRANT INSERT(user_id, legal_name, birth_date, phone, city, experience_description, emergency_contact_name, emergency_contact_phone) ON public.petwalker_applications TO authenticated;
GRANT SELECT, UPDATE ON public.petwalker_profiles TO authenticated;
GRANT SELECT ON public.petwalker_earnings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walk_sessions TO authenticated;

-- POLICIES
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Anyone view active products" ON public.products FOR SELECT USING (is_active = true);
CREATE POLICY "Petshop owners manage products" ON public.products FOR ALL USING (auth.uid() = petshop_id);
CREATE POLICY "Anyone view breed photos" ON public.breed_photos FOR SELECT USING (true);
CREATE POLICY "Allow public read on pet models" ON public.pet_models_3d FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone view posts" ON public.posts FOR SELECT USING (true);
CREATE POLICY "Users manage own posts" ON public.posts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own pets" ON public.pets FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "PetWalker read/update profile" ON public.petwalker_profiles FOR ALL TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "PetWalker view earnings" ON public.petwalker_earnings FOR SELECT TO authenticated USING (auth.uid() = petwalker_id);
CREATE POLICY "Applicants view own" ON public.petwalker_applications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Applicants insert own" ON public.petwalker_applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND birth_date <= (CURRENT_DATE - '18 years'::interval));
CREATE POLICY "Users manage notifications" ON public.notifications FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage locations" ON public.locations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage walk sessions" ON public.walk_sessions FOR ALL USING (auth.uid() = customer_id OR auth.uid() = walker_id);
