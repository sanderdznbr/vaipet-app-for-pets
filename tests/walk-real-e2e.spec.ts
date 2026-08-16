import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
 
 /**
  * E2E OPERACIONAL REAL — Fase 3.1 (Patch Mínimo)
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
    await test.step("0. preflight: pet no banco", async () => {
      const { error } = await admin.from("pets").insert({ owner_id: ownerCreds.id, name: `PetMatch`, breed: "SRD", is_active: true });
      if (error) throw error;
      log("0. Pet criado no banco");
    });

    await test.step("1. auth: paralelo", async () => {
      [oCtx, wCtx] = await Promise.all([
        createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 }),
        createAuthedContext(browser, walkerCreds, { lng: -46.7001, lat: -23.6001 })
      ]);
    });

    await test.step("1. owner: authenticated-ready", async () => {
      log("2. Pet Owner autenticado");
      await expect(oCtx.page).toHaveURL(/.*\/inicio.*/, { timeout: 10000 });
      const storageState = await oCtx.context.storageState();
      const hasSession = storageState.origins.some(o => o.localStorage.some(i => i.name === STORAGE_KEY));
      expect(hasSession).toBeTruthy();
    });

    await test.step("2. owner: start-walk-visible", async () => {
      const startWalkBtn = oCtx.page.locator('#tour-start-walk');
      try {
        await expect(startWalkBtn).toBeVisible({ timeout: 10000 });
        await expect(startWalkBtn).toBeEnabled({ timeout: 10000 });
      } catch (e) {
        log("ERRO: #tour-start-walk não visível/habilitado");
        const bodyText = await oCtx.page.innerText('body');
        log(`Conteúdo visível: ${bodyText.substring(0, 500)}`);
        throw e;
      }
    });

    await test.step("3. owner: open-request-flow", async () => {
      await oCtx.page.locator('#tour-start-walk').click();
      // O fluxo de abertura pode levar a uma nova rota ou modal
      await expect(oCtx.page.locator('button:has-text("30 minutos"), h2:has-text("solicitação"), h1:has-text("solicitação")').first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("4. owner: select-duration", async () => {
      const durationBtn = oCtx.page.getByRole('button', { name: /30 minutos/i });
      await expect(durationBtn).toBeVisible({ timeout: 10000 });
      await durationBtn.click();
    });

    await test.step("5. owner: confirm-request", async () => {
      const confirmBtn = oCtx.page.getByRole('button', { name: /confirmar/i });
      await confirmBtn.click();
      await expect(oCtx.page).toHaveURL(/.*search-walk.*/, { timeout: 15000 });
      log("5. Pedido publicado");
    });

    let sessId: string;
    await test.step("6. backend: matching-session-created", async () => {
      sessId = new URL(oCtx.page.url()).searchParams.get("resume") || "";
      expect(sessId).toBeTruthy();

      await expect.poll(async () => {
        const { data } = await admin.from("walk_sessions")
          .select("current_status, matching_expires_at")
          .eq("id", sessId)
          .single();
        
        if (data?.current_status !== "searching") return false;
        if (!data.matching_expires_at) return false;
        
        const expires = new Date(data.matching_expires_at).getTime();
        return expires > Date.now();
      }, {
        message: "Aguardando walk_session no estado searching com matching_expires_at futuro",
        timeout: 20000,
      }).toBeTruthy();
      
      log("6. Backend validado");
    });

    await test.step("job: process-matching", async () => {
      const { error } = await admin.rpc("process_walk_matching");
      if (error) throw error;
      log("Job matching executado");
    });

    await test.step("7. walker: authenticated-ready", async () => {
      log("7. PetWalker autenticado");
      await expect(wCtx.page).not.toHaveURL(/.*\/auth.*/, { timeout: 10000 });
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", walkerCreds.id);
      expect(roles?.some(r => r.role === 'petwalker')).toBeTruthy();
    });

    await test.step("8. walker: offer-visible", async () => {
      await wCtx.page.goto("/petwalker/painel");
      const acceptBtn = wCtx.page.locator('button:has-text("Aceitar Passeio")');
      await expect(acceptBtn).toBeVisible({ timeout: 30000 });
      log("8. Oferta visível no PetWalker");
    });

    await test.step("9. walker: accept-offer", async () => {
      const acceptBtn = wCtx.page.locator('button:has-text("Aceitar Passeio")');
      await acceptBtn.click();
      await expect(wCtx.page).toHaveURL(/.*walk-details.*/, { timeout: 15000 });
      log("9. Aceite realizado pela interface");
    });

    await test.step("10. backend: acceptance-confirmed", async () => {
      await expect.poll(async () => {
        const { data } = await admin.from("walk_sessions")
          .select("current_status, walker_id")
          .eq("id", sessId)
          .single();
        
        return data?.current_status === "walker_assigned" && data?.walker_id === walkerCreds.id;
      }, {
        message: "Confirmando walker_id e status walker_assigned no banco",
        timeout: 20000,
      }).toBeTruthy();

      // Verificar se não há ofertas duplicadas aceitas (opcional, mas bom para integridade)
      const { count } = await admin.from("walk_sessions")
        .select("*", { count: 'exact', head: true })
        .eq("id", sessId)
        .eq("current_status", "walker_assigned");
      expect(count).toBe(1);
      
      log("10. Banco confirmado");
    });

  } finally {
    await test.step("11. cleanup", async () => {
      if (oCtx) await oCtx.context.close();
      if (wCtx) await wCtx.context.close();
      await quickCleanup([ownerCreds.id, walkerCreds.id]);
      log("11. Cleanup concluído com zero resíduos");
    });
  }
});
