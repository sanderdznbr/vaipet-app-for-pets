import { test, expect, type SupabaseClient } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

async function provisionWalker(runId: string) {
  const email = `e2e.walker.${runId}@e2e.vaipet.invalid`;
  const password = "Pass!" + Math.random().toString(36).slice(2, 10);
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { signup_intent: "petwalker", e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw error;
  const id = data.user!.id;
  await admin.from("profiles").upsert({ id, onboarding_completed: true });
  await admin.from("user_roles").upsert({ user_id: id, role: "petwalker" });
  await admin.from("petwalker_profiles").upsert({
    user_id: id, approval_status: "approved", profile_completed: true, availability_status: "available",
    is_accepting_requests: true, price_30_minutes: 2000,
    last_known_location: `SRID=4326;POINT(-46.7 -23.6)`
  });
  return { id, email, password };
}

test("walker-acceptance: AVAILABILITY_RPC_DIAG", async ({ page }) => {
  const runId = `rpc_${Date.now()}`;
  const walker = await provisionWalker(runId);
  try {
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(walker.email);
    await page.getByPlaceholder("Senha").fill(walker.password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();
    await expect(page).not.toHaveURL(/.*\/auth.*/);
    
    // Check initial status
    const { data: profile } = await admin.from("petwalker_profiles").select("availability_status").eq("user_id", walker.id).single();
    console.log("Initial DB status:", profile?.availability_status);

    await page.goto("/petwalker");
    await page.waitForTimeout(5000);
    
    const uiStatus = await page.evaluate(() => {
        return document.body.innerText.includes("Você está online") ? "online" : "offline";
    });
    console.log("UI reported status:", uiStatus);

  } finally {
    await admin.auth.admin.deleteUser(walker.id);
  }
});
