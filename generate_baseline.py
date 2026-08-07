import re

def parse_ts_types(content):
    tables = {}
    
    # Extract enums first
    enums = {}
    enum_matches = re.finditer(r'Enums: {\s+([\s\S]*?)\s+},', content)
    for match in enum_matches:
        enum_content = match.group(1)
        for enum_line in enum_content.strip().split('\n'):
            enum_line = enum_line.strip()
            if not enum_line: continue
            e_match = re.match(r'(\w+): "(.*)"', enum_line)
            if e_match:
                name = e_match.group(1)
                values = [v.strip().strip("'") for v in e_match.group(2).split('|')]
                enums[name] = values

    # Extract tables
    table_matches = re.finditer(r'(\w+): {\s+Row: {([\s\S]*?)}\s+Insert:', content)
    for match in table_matches:
        table_name = match.group(1)
        row_content = match.group(2)
        
        columns = []
        for line in row_content.strip().split('\n'):
            line = line.strip()
            if not line: continue
            
            col_match = re.match(r'(\w+): (.*)', line)
            if col_match:
                name = col_match.group(1)
                ts_type = col_match.group(2).replace('| null', '').strip()
                
                sql_type = "text"
                if ts_type == "number":
                    sql_type = "numeric"
                    # Refine numeric
                    if any(x in name for x in ['count', 'quantity', 'age', 'duration', 'minutes', 'years', 'is_read']):
                        sql_type = "integer"
                elif ts_type == "boolean":
                    sql_type = "boolean"
                elif ts_type == "Json":
                    sql_type = "jsonb"
                elif ts_type == "string":
                    if "at" in name or "time" in name:
                        sql_type = "timestamp with time zone"
                    elif "date" in name or "birthday" in name:
                         sql_type = "date"
                    else:
                        sql_type = "text"
                
                if name == "id":
                    sql_type = "uuid"
                
                # Check for enums
                if ts_type in enums:
                    sql_type = f"public.{ts_type}"

                is_nullable = "null" in col_match.group(2)
                
                columns.append({
                    "name": name,
                    "type": sql_type,
                    "nullable": is_nullable
                })
        
        tables[table_name] = columns
    return tables

with open('src/integrations/supabase/types.ts', 'r') as f:
    content = f.read()

tables = parse_ts_types(content)

sql = """-- Baseline Schema
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'petshop', 'petwalker');
CREATE TYPE public.application_status AS ENUM ('pending', 'approved', 'rejected');

-- Functions
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tables
"""

def get_pg_type(table_name, col_name, col_type, is_nullable):
    if col_name == 'id':
        if table_name == 'profiles':
             return 'uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE'
        return 'uuid PRIMARY KEY DEFAULT gen_random_uuid()'
    
    suffix = "" if is_nullable else " NOT NULL"
    
    if col_type == 'numeric':
        return f'numeric(10,2) DEFAULT 0.00{suffix}'
    if col_type == 'integer':
        return f'integer DEFAULT 0{suffix}'
    if col_type == 'boolean':
        return f'boolean DEFAULT false{suffix}'
    if col_type == 'timestamp with time zone':
        default = " DEFAULT now()" if 'created' in col_name or 'submitted' in col_name else ""
        return f'timestamp with time zone{default}{suffix}'
    
    return f'{col_type}{suffix}'

# Define table creation order to respect dependencies
creation_order = [
    'profiles', 'user_roles', 'pets', 'petwalker_applications', 'petwalker_profiles', 
    'walk_sessions', 'petwalker_earnings', 'products', 'product_images', 'inventory',
    'posts', 'post_likes', 'post_comments', 'notifications', 'locations', 
    'pet_documents', 'breed_photos', 'pet_models_3d'
]

for table_name in creation_order:
    if table_name not in tables: continue
    columns = tables[table_name]
    sql += f"\nCREATE TABLE public.{table_name} (\n"
    col_defs = []
    for col in columns:
        col_defs.append(f"    {col['name']} {get_pg_type(table_name, col['name'], col['type'], col['nullable'])}")
    
    # Add foreign keys manually for accuracy
    if table_name == 'user_roles':
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE")
         col_defs.append("    UNIQUE (user_id, role)")
    elif table_name == 'pets':
         col_defs.append("    FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
    elif table_name == 'petwalker_applications':
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE")
         col_defs.append("    UNIQUE (user_id)")
    elif table_name == 'petwalker_profiles':
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE")
         col_defs.append("    UNIQUE (user_id)")
    elif table_name == 'walk_sessions':
         col_defs.append("    FOREIGN KEY (customer_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
         col_defs.append("    FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE")
         col_defs.append("    FOREIGN KEY (walker_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
    elif table_name == 'petwalker_earnings':
         col_defs.append("    FOREIGN KEY (petwalker_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
         col_defs.append("    FOREIGN KEY (walk_session_id) REFERENCES public.walk_sessions(id) ON DELETE SET NULL")
    elif table_name == 'inventory':
         col_defs.append("    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE")
         col_defs.append("    UNIQUE (product_id)")
    elif table_name == 'product_images':
         col_defs.append("    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE")
    elif table_name == 'post_likes':
         col_defs.append("    FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE")
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
    elif table_name == 'post_comments':
         col_defs.append("    FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE")
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
    elif table_name == 'posts':
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
    elif table_name == 'notifications':
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
    elif table_name == 'locations':
         col_defs.append("    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE")
    elif table_name == 'pet_documents':
         col_defs.append("    FOREIGN KEY (pet_id) REFERENCES public.pets(id) ON DELETE CASCADE")
    elif table_name == 'pet_models_3d':
         # pet_id or whatever it links to
         pass

    sql += ",\n".join(col_defs)
    sql += "\n);\n"

sql += """
-- Security Functions
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (id uuid, full_name text, avatar_url text, bio text) AS $$
BEGIN
    RETURN QUERY 
    SELECT p.id, p.full_name, p.avatar_url, p.bio 
    FROM public.profiles p
    WHERE p.id = ANY(_user_ids);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, email)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url', NEW.email);
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.approve_petwalker_application(application_id uuid)
RETURNS void AS $$
DECLARE
    v_user_id uuid;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = application_id AND status = 'pending'
    RETURNING user_id INTO v_user_id;

    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (v_user_id, 'petwalker')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.petwalker_profiles (user_id)
        VALUES (v_user_id)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.reject_petwalker_application(application_id uuid, reason text)
RETURNS void AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE public.petwalker_applications
    SET status = 'rejected', rejection_reason = reason, reviewed_at = now(), reviewed_by = auth.uid()
    WHERE id = application_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.set_petwalker_availability(status text)
RETURNS void AS $$
BEGIN
    UPDATE public.petwalker_profiles
    SET availability_status = status, updated_at = now()
    WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(bio text, experience integer, radius integer, price numeric)
RETURNS void AS $$
BEGIN
    UPDATE public.petwalker_profiles
    SET public_bio = bio, experience_years = experience, service_radius_km = radius, price_30_minutes = price, updated_at = now()
    WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Triggers
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS & GRANTS
"""

for t in creation_order:
    if t not in tables: continue
    sql += f"ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY;\n"
    sql += f"GRANT SELECT ON public.{t} TO authenticated;\n"
    sql += f"GRANT ALL ON public.{t} TO service_role;\n"

sql += """
-- Specific Policies
-- Profiles: Private data protected
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
-- No direct public SELECT on profiles. Use get_public_profiles RPC.

-- Petwalker Profiles
CREATE POLICY "Anyone can view petwalker profiles" ON public.petwalker_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Petwalkers can update their operational fields" ON public.petwalker_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- User Roles
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE UPDATE ON public.user_roles FROM authenticated;
CREATE POLICY "Users can see their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Storage Buckets & Policies
-- Storage setup
INSERT INTO storage.buckets (id, name, public) VALUES ('pet-photos', 'pet-photos', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pet-documents', 'pet-documents', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true) ON CONFLICT DO NOTHING;

-- Storage RLS (in storage.objects)
CREATE POLICY "Public Access" ON storage.objects FOR SELECT TO public USING (bucket_id IN ('pet-photos', 'product-images'));
CREATE POLICY "Authenticated Upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id IN ('pet-photos', 'product-images', 'pet-documents'));
"""

print(sql)
