import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const { data: sessions, error } = await admin.from("walk_sessions")
    .select("id, current_status, customer_id, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (error) console.error(error);
  console.log("Recent sessions:", JSON.stringify(sessions, null, 2));
}
run();
