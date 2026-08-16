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

test("walker-acceptance: GPS_ONLINE_DIAG", async ({ browser }) => {
  const runId = `diag_${Date.now()}`;
  const walker = await provisionWalker(runId);
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: { longitude: -46.7, latitude: -23.6 },
  });
  const page = await context.newPage();

  try {
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(walker.email);
    await page.getByPlaceholder("Senha").fill(walker.password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();
    await expect(page).not.toHaveURL(/.*\/auth.*/);
    await page.goto("/petwalker");
    
    // Diagnostic: Wait for GPS status sync or error
    await page.waitForTimeout(5000);
    const diag = await page.evaluate(() => {
        const body = document.body.innerText;
        const onlineBtn = !!document.querySelector('button:has-text("Ficar Online")');
        const offlineBtn = !!document.querySelector('button:has-text("Ficar offline")');
        return { body: body.substring(0, 500), onlineBtn, offlineBtn };
    });
    console.log("UI DIAG:", diag);
    
    // If there's a GPS error, we'll see it in body text
    if (diag.body.includes("Ative sua localização")) {
        console.log("GPS PERMISSION/LOCK FAILED IN SANDBOX");
    }

  } finally {
    await context.close();
    await admin.auth.admin.deleteUser(walker.id);
  }
});
