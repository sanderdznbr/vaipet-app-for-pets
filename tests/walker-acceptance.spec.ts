import { test, expect, type SupabaseClient } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];

const log = (msg: string) => console.log(`[${new Date().toISOString()}] [walker-diag] ${msg}`);

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

async function provisionWalker(runId: string) {
  const email = `e2e.walker.${runId}@e2e.vaipet.invalid`;
  const password = "Pass!" + Math.random().toString(36).slice(2, 10);
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: "Walker E2E", signup_intent: "petwalker", e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw error;
  const id = data.user!.id;
  await admin.from("profiles").upsert({ id, full_name: "Walker E2E", onboarding_completed: true });
  await admin.from("user_roles").upsert({ user_id: id, role: "petwalker" });
  await admin.from("petwalker_profiles").upsert({
    user_id: id, approval_status: "approved", profile_completed: true, availability_status: "available",
    is_accepting_requests: true, price_30_minutes: 2000, experience_years: 2, service_radius_km: 10,
    last_known_location: `SRID=4326;POINT(-46.7 -23.6)`
  });
  return { id, email, password };
}

async function createOwnerAndRequest(runId: string) {
  const email = `e2e.owner.${runId}@e2e.vaipet.invalid`;
  const { data } = await admin.auth.admin.createUser({ email, password: "Pass!", email_confirm: true, user_metadata: { e2e_test: true, e2e_run_id: runId } });
  const ownerId = data.user!.id;
  await admin.from("profiles").upsert({ id: ownerId, onboarding_completed: true });
  const { data: pet } = await admin.from("pets").insert({ owner_id: ownerId, name: "DiagPet", breed: "SRD", is_active: true }).select().single();
  const { data: session } = await admin.from("walk_sessions").insert({
    customer_id: ownerId, pet_id: pet.id, current_status: "searching",
    walk_type: "individual", planned_duration_minutes: 30, request_mode: "now",
    start_time: new Date().toISOString(), meeting_point_geom: `SRID=4326;POINT(-46.7 -23.6)`
  }).select().single();
  return { ownerId, sessionId: session.id };
}

test("walker-acceptance: DIAGNOSTICO", async ({ page }) => {
  const runId = `diag_${Date.now()}`;
  const walker = await provisionWalker(runId);
  const { ownerId, sessionId } = await createOwnerAndRequest(runId);
  
  try {
    await admin.from("walk_offers").insert({ session_id: sessionId, walker_id: walker.id, offer_status: "pending" });

    log("1. Autenticando PetWalker...");
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(walker.email);
    await page.getByPlaceholder("Senha").fill(walker.password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();
    await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 25000 });

    log("2. Navegando para /petwalker...");
    await page.goto("/petwalker");
    
    log("3. Aguardando estabilização...");
    await page.waitForTimeout(5000);
    
    const state = await page.evaluate(async () => {
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText);
        const textContent = document.body.innerText;
        return { buttons, textContent };
    });
    log(`Botoes visiveis: ${state.buttons.join(", ")}`);
    
    // Check if the walker is online
    const isOnlineText = state.textContent.includes("Você está online");
    log(`Status Online no UI: ${isOnlineText}`);

    if (!isOnlineText) {
        log("Tentando colocar Walker ONLINE via UI...");
        const onlineBtn = page.getByRole('button', { name: /Ficar Online/i }).or(page.getByText(/Ficar Online/i));
        if (await onlineBtn.count() > 0) {
            await onlineBtn.first().click();
            await page.waitForTimeout(3000);
        }
    }

    log("Check RPC directly via browser context...");
    const rpcResult = await page.evaluate(async () => {
        const { supabase } = (window as any);
        if (!supabase) return "Supabase client not found in window";
        const { data, error } = await supabase.rpc('get_available_walk_offers');
        return { data, error };
    });
    log(`RPC Result: ${JSON.stringify(rpcResult)}`);

    await page.screenshot({ path: "/tmp/browser/offer_debug.png" });
    
  } finally {
    await admin.auth.admin.deleteUser(walker.id);
    await admin.auth.admin.deleteUser(ownerId);
  }
});
