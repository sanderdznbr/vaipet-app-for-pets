import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  const customerId = "f0d7ff39-6358-433e-ba87-dda661009194"; // E2E pet_owner de 19:13:55
  const { data: sessions, error } = await admin.from("walk_sessions")
    .select("*")
    .eq("customer_id", customerId);
  
  if (error) console.error(error);
  console.log("Sessions for last owner:", JSON.stringify(sessions, null, 2));
}
run();
