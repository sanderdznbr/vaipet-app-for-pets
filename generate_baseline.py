import re

def parse_ts_types(content):
    tables = {}
    
    # Simple regex to extract table rows from Database interface
    # This is a bit fragile but should work for this structure
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
                ts_type = col_match.group(2)
                
                # Basic mapping from TS types to Postgres types
                sql_type = "text"
                if "number" in ts_type:
                    sql_type = "numeric" if "number" in ts_type else "integer"
                elif "boolean" in ts_type:
                    sql_type = "boolean"
                elif "Json" in ts_type:
                    sql_type = "jsonb"
                elif "string" in ts_type:
                    if "at" in name or "time" in name:
                        sql_type = "timestamp with time zone"
                    else:
                        sql_type = "text"
                
                # Special cases based on name
                if name == "id":
                    sql_type = "uuid"
                
                is_nullable = "null" in ts_type
                
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

# We'll use this info to build the SQL
# But we also need the relationships and constraints which are harder to parse correctly
# For this task, I will combine the knowledge from types.ts with standard pet-shop schema conventions

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

def get_pg_type(col_name, col_type, is_nullable):
    if col_name == 'id':
        return 'uuid PRIMARY KEY DEFAULT gen_random_uuid()'
    
    suffix = "" if is_nullable else " NOT NULL"
    
    # Refine types based on common patterns
    if col_name.endswith('_id') or col_name == 'user_id':
        return f'uuid{suffix}'
    if 'at' in col_name:
        default = " DEFAULT now()" if 'created' in col_name else ""
        return f'timestamp with time zone{default}{suffix}'
    if col_type == 'numeric':
        # Default to integer if name implies count or duration
        if any(x in col_name for x in ['count', 'quantity', 'age', 'duration', 'minutes', 'years']):
             return f'integer DEFAULT 0{suffix}'
        return f'numeric(10,2) DEFAULT 0.00{suffix}'
    if col_type == 'boolean':
        return f'boolean DEFAULT false{suffix}'
    
    return f'{col_type}{suffix}'

for table_name, columns in tables.items():
    sql += f"\nCREATE TABLE public.{table_name} (\n"
    col_defs = []
    for col in columns:
        col_defs.append(f"    {col['name']} {get_pg_type(col['name'], col['type'], col['nullable'])}")
    
    # Add foreign keys based on name conventions
    for col in columns:
        if col['name'] == 'user_id' or (table_name == 'profiles' and col['name'] == 'id'):
             sql += f"    -- Foreign key for {col['name']} would be auth.users(id)\n"
        elif col['name'].endswith('_id'):
             ref_table = col['name'][:-3] + 's' # simplistic pluralization
             # fix common ones
             if ref_table == 'walkers': ref_table = 'petwalker_profiles'
             if ref_table == 'owners': ref_table = 'profiles'
             # sql += f"    -- Foreign key for {col['name']} -> {ref_table}(id)\n"

    sql += ",\n".join(col_defs)
    sql += "\n);\n"

# Security functions
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
    INSERT INTO public.profiles (id, full_name, avatar_url)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url');
    
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

-- Triggers
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS & GRANTS
"""

# Tables list for RLS
table_names = list(tables.keys())
for t in table_names:
    sql += f"ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY;\n"
    sql += f"GRANT SELECT ON public.{t} TO authenticated;\n"
    sql += f"GRANT ALL ON public.{t} TO service_role;\n"

sql += """
-- Specific Policies
CREATE POLICY "Public profiles are readable through RPC only" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Petwalkers can see their own profile" ON public.petwalker_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Petwalkers can update their own profile" ON public.petwalker_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Storage Buckets (Manual addition for baseline)
-- Note: Buckets are in storage schema, but we define their structure here for the baseline
-- This is illustrative as we use the storage API, but policies are in storage.objects

-- GRANT SELECT ON public.user_roles TO authenticated;
REVOKE ALL ON public.user_roles FROM authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE UPDATE (role) ON public.user_roles FROM authenticated;
"""

print(sql)
