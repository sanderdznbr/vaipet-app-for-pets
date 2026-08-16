import { test, expect, type SupabaseClient } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * PARTE 2 — TESTE ISOLADO DO ACEITE (walker-acceptance:)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];

const log = (msg: string) => console.log(`[${new Date().toISOString()}] [walker-acceptance] ${msg}`);

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
  const { data, error: uError } = await admin.auth.admin.createUser({
    email, password: "Pass!", email_confirm: true,
    user_metadata: { full_name: "Owner E2E", signup_intent: "pet_owner", e2e_test: true, e2e_run_id: runId },
  });
  if (uError) throw uError;
  const ownerId = data.user!.id;
  
  await admin.from("profiles").upsert({ id: ownerId, full_name: "Owner E2E", onboarding_completed: true });
  
  const { data: pet, error: pError } = await admin.from("pets").insert({ 
    owner_id: ownerId, name: "DiagPet", breed: "SRD", is_active: true 
  }).select().single();
  if (pError) throw pError;

  // Schema: current_status, start_time, planned_duration_minutes, request_mode
  const { data: session, error: sError } = await admin.from("walk_sessions").insert({
    customer_id: ownerId, 
    pet_id: pet.id, 
    current_status: "searching",
    walk_type: "individual", 
    planned_duration_minutes: 30,
    request_mode: "now",
    start_time: new Date().toISOString(),
    meeting_point_geom: `SRID=4326;POINT(-46.7 -23.6)`
  }).select().single();
  if (sError) {
    console.error("Session creation error:", sError);
    throw sError;
  }
  
  return { ownerId, sessionId: session.id };
}

async function quickCleanup(ids: string[]) {
  if (!ids.length) return;
  const { data: sessions } = await admin.from("walk_sessions").select("id").or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  if (sessions?.length) {
    const sIds = sessions.map(s => s.id);
    await admin.from("walker_tracking").delete().in("walk_session_id", sIds);
    await admin.from("walk_offers").delete().in("session_id", sIds);
    await admin.from("petwalker_earnings").delete().in("walk_session_id", sIds);
    await admin.from("walk_sessions").delete().in("id", sIds);
  }
  await admin.from("pets").delete().in("owner_id", ids);
  await admin.from("petwalker_profiles").delete().in("user_id", ids);
  await admin.from("user_roles").delete().in("user_id", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}

test("walker-acceptance: ACEITE ISOLADO", async ({ page }) => {
  const runId = `acc_${Date.now()}`;
  const walker = await provisionWalker(runId);
  const { ownerId, sessionId } = await createOwnerAndRequest(runId);
  
  log(`Session ID: ${sessionId}`);
  log(`Walker ID esperado: ${walker.id}`);

  try {
    // provisionar a oferta manualmente
    const { error: oError } = await admin.from("walk_offers").insert({ 
      session_id: sessionId, 
      walker_id: walker.id, 
      offer_status: "pending" 
    });
    if (oError) {
        console.error("Offer creation error:", oError);
        throw oError;
    }

    log("1. Autenticando PetWalker...");
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(walker.email);
    await page.getByPlaceholder("Senha").fill(walker.password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();
    await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 25000 });

    log("2. Navegando para /petwalker...");
    await page.goto("/petwalker");
    
    log("3. Visualizando oferta...");
    const acceptBtn = page.locator('[data-testid="walker-accept-button"]');
    await expect(acceptBtn).toBeVisible({ timeout: 20000 });
    
    const urlBefore = page.url();
    log(`URL antes do aceite: ${urlBefore}`);

    log("4. Clicando em ACEITAR PASSEIO...");
    
    page.on('console', msg => log(`[browser-console] ${msg.text()}`));
    page.on('requestfailed', req => log(`[request-failed] ${req.url()} - ${req.failure()?.errorText}`));
    page.on('response', res => {
        if (res.status() >= 400) log(`[http-error] ${res.url()} - ${res.status()}`);
    });

    await acceptBtn.click();
    
    log("5. Aguardando navegação para walk-details...");
    await expect(page).toHaveURL(/.*walk-details.*/, { timeout: 25000 });
    const urlAfter = page.url();
    log(`URL depois do aceite: ${urlAfter}`);
    
    log("6. Validando banco...");
    const { data: finalSession } = await admin.from("walk_sessions")
      .select("current_status, walker_id")
      .eq("id", sessionId)
      .single();
    
    log(`Status final: ${finalSession?.current_status}`);
    log(`Walker ID gravado: ${finalSession?.walker_id}`);

    expect(finalSession?.current_status).toBe("accepted");
    expect(finalSession?.walker_id).toBe(walker.id);
    
    log("walker-acceptance: PASS");

  } finally {
    log("7. Cleanup...");
    await quickCleanup([walker.id, ownerId]);
    log("walker-acceptance: CLEANUP ZERO");
  }
});
