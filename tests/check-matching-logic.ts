import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const { data: users, error } = await admin.from("profiles")
    .select("id, full_name, created_at")
    .ilike("full_name", "%E2E%")
    .order("created_at", { ascending: false })
    .limit(5);
  
  if (error) console.error(error);
  console.log("Recent E2E users:", JSON.stringify(users, null, 2));
}
run();
