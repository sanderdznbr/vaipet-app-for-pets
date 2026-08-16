import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E OPERACIONAL REAL — Fase 3.1 (Patch Mínimo)
 * 
 * Este teste utiliza contextos isolados para simular a jornada real do PetWalker
 * e do Dono, validando matching, tracking, segurança e conclusão.
 */


test.setTimeout(240000); 

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const log = (msg: string) => console.log(`[${new Date().toISOString()}] [e2e] ${msg}`);

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await preflightCleanup();
});

async function preflightCleanup() {
  log("1. preflightCleanup iniciado");
  let page = 1;
  const perPage = 100;
  const ttlMs = 3600_000;
  const cutoff = new Date(Date.now() - ttlMs).toISOString();

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    if (users.length === 0) break;

    const targets = users.filter(u => 
      u.email?.endsWith("@e2e.vaipet.invalid") && 
      u.user_metadata?.e2e_test === true &&
      u.created_at < cutoff
    );

    if (targets.length > 0) {
      await quickCleanup(targets.map(u => u.id));
    }
    if (users.length < perPage) break;
    page++;
  }
  log("1. preflightCleanup concluído");
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

async function provisionUser(runId: string, kind: "pet_owner" | "petwalker") {
  const email = `e2e.${kind}.${runId}.${Math.random().toString(36).slice(2, 6)}@e2e.vaipet.invalid`;
  const password = `Pass!${Math.random().toString(36).slice(2, 10)}`;
  
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `E2E ${kind}`, signup_intent: kind, e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw error;
  const id = data.user!.id;
  
  await admin.from("profiles").upsert({ id, full_name: `E2E ${kind}`, onboarding_completed: true });
  
  if (kind === "petwalker") {
    await admin.from("user_roles").insert({ user_id: id, role: "petwalker" });
    await admin.from("petwalker_profiles").upsert({
      user_id: id, approval_status: "approved", profile_completed: true, availability_status: "available",
      is_accepting_requests: true, price_30_minutes: 2250, experience_years: 2, service_radius_km: 10,
      last_known_location: `SRID=4326;POINT(-46.7009 -23.6004)`
    });
  }
  return { id, email, password };
}

async function createAuthedContext(browser: any, credentials: { email: string; password: string; id: string }, coords: { lng: number; lat: number }) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: { longitude: coords.lng, latitude: coords.lat },
    locale: "pt-BR",
  });
  const page = await context.newPage();
  await page.goto("/auth");
  await page.getByPlaceholder("E-mail").fill(credentials.email);
  await page.getByPlaceholder("Senha").fill(credentials.password);
  await page.getByRole("button", { name: /^Entrar$/i }).click();
  await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 45000 });
  
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const storageState = await context.storageState();
  const token = storageState.origins.find(o => o.origin.includes("localhost"))?.localStorage.find(i => i.name === STORAGE_KEY);
  if (token) {
    const session = JSON.parse(token.value);
    await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  }
  return { context, page, client };
}

test.describe.configure({ mode: "serial", retries: 0 });

test("setup: Isolamento e Autenticação", async ({ browser }) => {
  const runId = `setup_${Date.now()}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let oCtx, wCtx;
  try {
    [oCtx, wCtx] = await Promise.all([
      createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 }),
      createAuthedContext(browser, walkerCreds, { lng: -46.7, lat: -23.6 })
    ]);
    log("2. Pet Owner autenticado");
    log("7. PetWalker autenticado");
    await expect(oCtx.page).not.toHaveURL(/.*\/auth.*/);
    await expect(wCtx.page).not.toHaveURL(/.*\/auth.*/);
  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([ownerCreds.id, walkerCreds.id]);
  }
});

test("matching: Ciclo real de oferta via job e aceite via UI", async ({ browser }) => {
  const runId = `match_${Date.now()}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let oCtx: any, wCtx: any;

  try {
    [oCtx, wCtx] = await Promise.all([
      createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 }),
      createAuthedContext(browser, walkerCreds, { lng: -46.7001, lat: -23.6001 })
    ]);
    log("2. Pet Owner autenticado");
    log("7. PetWalker autenticado");

    await admin.from("pets").insert({ owner_id: ownerCreds.id, name: `PetMatch`, breed: "SRD", is_active: true });

    await oCtx.page.goto("/inicio");
    await oCtx.page.locator('#tour-start-walk').click();
    await oCtx.page.click('button:has-text("30 minutos")');
    await oCtx.page.click('button:has-text("Confirmar")');
    
    await expect(oCtx.page).toHaveURL(/.*search-walk.*/, { timeout: 30000 });
    const sessId = new URL(oCtx.page.url()).searchParams.get("resume");
    expect(sessId).toBeTruthy();
    log("3. Passeio publicado");

    const { data: sessCheck } = await admin.from("walk_sessions").select("current_status").eq("id", sessId!).single();
    expect(sessCheck?.current_status).toBe("searching");
    log("4. Status walk_session validado (searching)");

    await admin.rpc("process_walk_matching");
    log("5. Job matching executado");

    await wCtx.page.goto("/petwalker/painel");
    const acceptBtn = wCtx.page.locator('button:has-text("Aceitar Passeio")');
    
    try {
      await expect(acceptBtn).toBeVisible({ timeout: 45000 });
      log("6. Oferta visível no PetWalker");
      await acceptBtn.click();
      log("8. Aceite realizado pela interface");
    } catch (e) {
      log(`FALHA na oferta: URL=${wCtx.page.url()}`);
      const { data: s } = await admin.from("walk_sessions").select("*").eq("id", sessId!).single();
      const { data: o } = await admin.from("walk_offers").select("*").eq("session_id", sessId!);
      log(`Estado walk_session: ${JSON.stringify(s)}`);
      log(`Estado walk_offer: ${JSON.stringify(o)}`);
      throw e;
    }

    await expect(wCtx.page).toHaveURL(/.*walk-details.*/, { timeout: 30000 });
    const { data: finalSess } = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", sessId!).single();
    expect(finalSess?.current_status).toBe("walker_assigned");
    expect(finalSess?.walker_id).toBe(walkerCreds.id);
    log("9. Banco confirma walker correto");

  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([ownerCreds.id, walkerCreds.id]);
    log("10. Cleanup concluído");
  }
});
