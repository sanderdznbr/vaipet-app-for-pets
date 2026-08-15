import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E OPERACIONAL REAL — Fase 3.1
 * 
 * Este teste utiliza contextos isolados para simular a jornada real do PetWalker
 * e do Dono, validando matching, tracking, segurança e conclusão.
 */

test.setTimeout(180000); 

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const log = (msg: string) => console.log(`[e2e] ${msg}`);

let admin: SupabaseClient;

/**
 * Cleanup fail-closed rigoroso.
 */
async function preflightCleanup() {
  log("Iniciando preflight cleanup rigoroso...");
  let page = 1;
  const perPage = 100;
  const ttlMs = 3600_000;
  const cutoff = new Date(Date.now() - ttlMs).toISOString();

  while (true) {
    let data, error;
    try {
      const response = await admin.auth.admin.listUsers({ page, perPage });
      data = response.data;
      error = response.error;
    } catch (e: any) {
      throw new Error(`CRITICAL: Falha na rede/gateway ao listar usuários para cleanup: ${e.message}`);
    }

    if (error) {
      console.error(`[cleanup] Erro detectado na Auth API: ${error.message} (Page: ${page})`);
      throw new Error(`CRITICAL: Falha na Auth API ao listar usuários para cleanup: ${error.message}.`);
    }

    const users = data?.users || [];
    if (users.length === 0) break;

    const targets = users.filter(u => 
      u.email?.endsWith("@e2e.vaipet.invalid") && 
      u.user_metadata?.e2e_test === true &&
      u.user_metadata?.e2e_run_id &&
      u.created_at < cutoff
    );

    if (targets.length > 0) {
      log(`Limpando ${targets.length} usuários órfãos (Página ${page})...`);
      await quickCleanup(targets.map(u => u.id));
    }

    if (users.length < perPage) break;
    page++;
  }
}

async function quickCleanup(ids: string[]) {
  if (!ids.length) return;
  
  log(`quickCleanup: Processando ${ids.length} usuários...`);

  const { data: sessions, error: listSErr } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  
  if (listSErr) throw new Error(`Falha ao buscar sessões: ${listSErr.message}`);

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
  
  for (const id of ids) {
    await admin.auth.admin.deleteUser(id);
  }
}

async function provisionUser(runId: string, kind: "pet_owner" | "petwalker") {
  const email = `e2e.${kind}.${runId}.${Math.random().toString(36).slice(2, 6)}@e2e.vaipet.invalid`;
  const password = `Pass!${Math.random().toString(36).slice(2, 10)}`;
  
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { 
      full_name: `E2E ${kind} ${runId}`, 
      signup_intent: kind, 
      e2e_test: true, 
      e2e_run_id: runId 
    },
  });
  if (error) throw error;
  const id = data.user!.id;
  
  await admin.from("profiles").upsert({ 
    id, 
    full_name: `E2E ${kind} ${runId}`, 
    onboarding_completed: true 
  });
  
  if (kind === "petwalker") {
    await admin.from("user_roles").insert({ user_id: id, role: "petwalker" });
    await admin.from("petwalker_profiles").upsert({
      user_id: id,
      approval_status: "approved",
      profile_completed: true,
      availability_status: "available",
      is_accepting_requests: true,
      price_30_minutes: 2250,
      experience_years: 2,
      service_radius_km: 10,
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
  
  log(`Autenticando usuário: ${credentials.email}`);
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  
  await page.getByPlaceholder("seu@email.com").fill(credentials.email);
  await page.getByPlaceholder("sua senha").fill(credentials.password);
  await page.getByRole("button", { name: /Entrar/i }).click();

  await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 20000 });
  await expect(page.locator("nav, .mapboxgl-map, #tour-start-walk").first()).toBeVisible({ timeout: 20000 });

  const storageState = await context.storageState();
  const tokenExists = storageState.origins
    .find(o => o.origin.includes("localhost"))
    ?.localStorage.find(i => i.name === STORAGE_KEY);
  
  if (!tokenExists) {
    throw new Error(`Falha crítica: Token ${STORAGE_KEY} não encontrado no localStorage.`);
  }

  const session = JSON.parse(tokenExists.value);
  if (session.user.id !== credentials.id) {
    throw new Error(`Falha crítica: User ID incorreto.`);
  }

  log(`Autenticação confirmada para ${credentials.email}`);
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  
  return { context, page, client };
}

test.describe.configure({ mode: "serial", retries: 0 });

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await preflightCleanup();
});

test("setup: Isolamento e Autenticação", async ({ browser }) => {
  const runId = `setup_${Math.random().toString(36).slice(2, 8)}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let oCtx: any;

  try {
    oCtx = await createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 });
    
    // Fail-fast assertions
    await expect(oCtx.page).not.toHaveURL(/.*\/auth.*/);
    const { data: { user } } = await oCtx.client.auth.getUser();
    expect(user?.id).toBe(ownerCreds.id);
    
    const { data: walkerProfile } = await oCtx.client.from("petwalker_profiles").select("experience_years").eq("user_id", walkerCreds.id).maybeSingle();
    expect(walkerProfile).toBeNull();
  } finally {
    if (oCtx) await oCtx.context.close();
    await quickCleanup([ownerCreds.id, walkerCreds.id]);
  }
});

test("matching: Ciclo real de oferta via job e aceite via UI", async ({ browser }) => {
  const runId = `match_${Math.random().toString(36).slice(2, 8)}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let oCtx: any, wCtx: any;

  try {
    const { data: pet } = await admin.from("pets").insert({ 
      owner_id: ownerCreds.id, 
      name: `PetMatch_${runId}`, 
      breed: "SRD", 
      is_active: true 
    }).select("id").single();

    oCtx = await createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 });
    wCtx = await createAuthedContext(browser, walkerCreds, { lng: -46.7001, lat: -23.6001 });

    // Fail-fast assertions
    await expect(oCtx.page).not.toHaveURL(/.*\/auth.*/);
    await expect(wCtx.page).not.toHaveURL(/.*\/auth.*/);
    const { data: { user: ownerUser } } = await oCtx.client.auth.getUser();
    expect(ownerUser?.id).toBe(ownerCreds.id);

    await oCtx.page.goto("/", { waitUntil: 'domcontentloaded' });
    const heroBtn = oCtx.page.locator('#tour-start-walk');
    await expect(heroBtn).toBeVisible({ timeout: 15000 });
    await heroBtn.click();
    
    await oCtx.page.click('button:has-text("30 minutos")');
    await oCtx.page.click('button:has-text("Confirmar")');
    
    await expect(oCtx.page).toHaveURL(/.*search-walk.*/, { timeout: 15000 });
    const url = new URL(oCtx.page.url());
    const sessId = url.searchParams.get("resume");
    expect(sessId).toBeTruthy();

    await expect.poll(async () => {
      await admin.rpc("process_walk_matching");
      const { data } = await admin.from("walk_offers").select("offer_status").eq("session_id", sessId!);
      return data?.some(o => o.offer_status === 'pending');
    }, { timeout: 15000 }).toBe(true);

    await wCtx.page.goto("/petwalker/painel", { waitUntil: 'domcontentloaded' });
    const acceptBtn = wCtx.page.locator('button:has-text("Aceitar Passeio")');
    await expect(acceptBtn).toBeVisible({ timeout: 20000 });
    await acceptBtn.click();

    await expect(wCtx.page).toHaveURL(/.*walk-details.*/, { timeout: 15000 });
    const { data: sess } = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", sessId!).single();
    expect(sess?.current_status).toBe("walker_assigned");
    expect(sess?.walker_id).toBe(walkerCreds.id);

  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([ownerCreds.id, walkerCreds.id]);
  }
});

async function prepareOperationalWalk(runId: string, ownerCreds: any, walkerCreds: any, petName: string) {
  const { data: pet } = await admin.from("pets").insert({ owner_id: ownerCreds.id, name: petName, breed: "SRD", is_active: true }).select("id").single();
  const { data: sess } = await admin.from("walk_sessions").insert({
    customer_id: ownerCreds.id,
    current_status: "searching",
    pet_id: pet!.id,
    matching_expires_at: new Date(Date.now() + 600000).toISOString(),
    meeting_point_geom: `SRID=4326;POINT(-46.7 -23.6)`,
    home_location: { lng: -46.7, lat: -23.6 },
    planned_duration_minutes: 30,
    total_price_cents: 2250,
    start_time: new Date().toISOString(),
    walk_type: 'outdoor'
  }).select("id").single();

  await admin.rpc("process_walk_matching");
  
  const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await walkerClient.auth.signInWithPassword({ email: walkerCreds.email, password: walkerCreds.password });

  await walkerClient.rpc("accept_walk_request", { _session_id: sess!.id });
  await walkerClient.rpc("petwalker_start_heading", { _session_id: sess!.id });
  await walkerClient.rpc("petwalker_arrive_pickup", { _session_id: sess!.id });
  await walkerClient.rpc("petwalker_start_walk", { _session_id: sess!.id });

  return { sessionId: sess!.id, walkerClient };
}

test("tracking: GPS operacional, Throttle e Realtime", async ({ browser }) => {
  const runId = `track_${Math.random().toString(36).slice(2, 8)}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let oCtx: any, wCtx: any;

  try {
    const { sessionId, walkerClient } = await prepareOperationalWalk(runId, ownerCreds, walkerCreds, `PetTrack_${runId}`);
    oCtx = await createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 });
    wCtx = await createAuthedContext(browser, walkerCreds, { lng: -46.7001, lat: -23.6001 });

    await oCtx.page.goto(`/search-walk?resume=${sessionId}`);
    const walkerMarker = oCtx.page.locator('.mapboxgl-marker').first();
    await expect(walkerMarker).toBeVisible({ timeout: 15000 });
    const initialPos = await walkerMarker.boundingBox();

    const wOpCtx = await createAuthedContext(browser, walkerCreds, { lng: -46.7001, lat: -23.6001 });
    await wOpCtx.page.goto(`/petwalker/passeio/${sessionId}`);

    const points = [
      { lng: -46.7005, lat: -23.6005 },
      { lng: -46.7008, lat: -23.6008 },
      { lng: -46.7010, lat: -23.6010 }
    ];

    for (const pt of points) {
      await wOpCtx.context.setGeolocation({ longitude: pt.lng, latitude: pt.lat });
      await wOpCtx.page.waitForTimeout(7000);
    }
    await wOpCtx.context.close();

    const { data: trail } = await admin.from("walker_tracking").select("*").eq("walk_session_id", sessionId);
    expect(trail?.length).toBeGreaterThanOrEqual(3);

    const finalPos = await walkerMarker.boundingBox();
    expect(finalPos!.x).not.toBe(initialPos!.x);

  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([ownerCreds.id, walkerCreds.id]);
  }
});

test("negative: Segurança de RPC e Regras de Negócio", async ({ browser }) => {
  const runId = `neg_${Math.random().toString(36).slice(2, 8)}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  const strangerCreds = await provisionUser(runId, "pet_owner");

  const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await walkerClient.auth.signInWithPassword({ email: walkerCreds.email, password: walkerCreds.password });
  
  const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await ownerClient.auth.signInWithPassword({ email: ownerCreds.email, password: ownerCreds.password });

  const strangerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  await strangerClient.auth.signInWithPassword({ email: strangerCreds.email, password: strangerCreds.password });

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: ownerCreds.id, name: "N", breed: "SRD" }).select("id").single();
    
    const { error: gpsErr } = await walkerClient.rpc("update_walker_location", { _lat: 91, _lng: 0, _accuracy: 10 });
    expect(gpsErr).toBeTruthy(); 

    const { data: sess } = await admin.from("walk_sessions").insert({
      customer_id: ownerCreds.id,
      current_status: "searching",
      matching_expires_at: new Date(Date.now() + 600000).toISOString(),
      pet_id: pet!.id,
      start_time: new Date().toISOString(),
      walk_type: 'outdoor'
    }).select("id").single();
    
    const { error: autoErr } = await ownerClient.rpc("accept_walk_request", { _session_id: sess!.id });
    expect(autoErr?.message).toContain("Auto-aceite proibido");

    const { error: delErr } = await strangerClient.from("walk_sessions").delete().eq("id", sess!.id);
    const { data: stillExists } = await admin.from("walk_sessions").select("id").eq("id", sess!.id).single();
    expect(stillExists).toBeTruthy();

  } finally {
    await quickCleanup([ownerCreds.id, walkerCreds.id, strangerCreds.id]);
  }
});

test("completion: Fluxo UI e Cálculo de Métricas", async ({ browser }) => {
  const runId = `comp_${Math.random().toString(36).slice(2, 8)}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let wCtx: any;

  try {
    const { sessionId, walkerClient } = await prepareOperationalWalk(runId, ownerCreds, walkerCreds, `PetComp_${runId}`);
    
    wCtx = await createAuthedContext(browser, walkerCreds, { lng: -46.7, lat: -23.6 });
    await wCtx.page.goto(`/petwalker/passeio/${sessionId}`);

    await wCtx.page.click('button:has-text("Finalizar passeio")');
    await wCtx.page.click('button:has-text("Confirmar")');

    await expect(wCtx.page).toHaveURL("/petwalker/painel");
    
    const { data: final } = await admin.from("walk_sessions").select("current_status, total_price_cents").eq("id", sessionId).single();
    expect(final!.current_status).toBe("completed");
    
    const { error: repeatErr } = await walkerClient.rpc("petwalker_complete_walk", { _session_id: sessionId });
    expect(repeatErr).toBeTruthy();

  } finally {
    if (wCtx) await wCtx.context.close();
    await quickCleanup([ownerCreds.id, walkerCreds.id]);
  }
});

test("full: Jornada Completa determinística (Dois Contextos)", async ({ browser }) => {
  const runId = `full_${Math.random().toString(36).slice(2, 8)}`;
  const ownerCreds = await provisionUser(runId, "pet_owner");
  const walkerCreds = await provisionUser(runId, "petwalker");
  let oCtx: any, wCtx: any;

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: ownerCreds.id, name: `FullPet_${runId}`, breed: "SRD", is_active: true }).select("id").single();
    oCtx = await createAuthedContext(browser, ownerCreds, { lng: -46.7, lat: -23.6 });
    wCtx = await createAuthedContext(browser, walkerCreds, { lng: -46.7009, lat: -23.6004 });

    await oCtx.page.goto("/inicio", { waitUntil: 'domcontentloaded' });
    await oCtx.page.click('#tour-start-walk');
    await expect(oCtx.page).toHaveURL(/\/search-walk/);
    
    await oCtx.page.click('button:has-text("30 minutos")');
    await oCtx.page.click('button:has-text("Confirmar")');

    await expect.poll(async () => {
      await admin.rpc("process_walk_matching");
      const { data } = await admin.from("walk_offers").select("offer_status").eq("walker_id", walkerCreds.id);
      return data?.some(o => o.offer_status === 'pending');
    }, { timeout: 15000 }).toBe(true);

    await wCtx.page.goto("/petwalker/painel", { waitUntil: 'domcontentloaded' });
    const offerBtn = wCtx.page.locator(`button:has-text("ACEITAR PASSEIO")`);
    await expect(offerBtn).toBeVisible({ timeout: 15000 });
    await offerBtn.click();

    await wCtx.page.click('button:has-text("Iniciar deslocamento")');
    await wCtx.page.click('button:has-text("Cheguei ao local")');
    await wCtx.page.click('button:has-text("Iniciar passeio")');

    await wCtx.context.setGeolocation({ latitude: -23.6005, longitude: -46.7005 });
    await wCtx.page.waitForTimeout(7000); 
    
    await wCtx.page.click('button:has-text("Finalizar passeio")');
    await wCtx.page.click('button:has-text("Confirmar")');
    
    await expect(wCtx.page).toHaveURL("/petwalker/painel");

  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([ownerCreds.id, walkerCreds.id]);
  }
});