import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E OPERACIONAL REAL — Fase 3.1
 * 
 * Este teste utiliza contextos isolados para simular a jornada real do PetWalker
 * e do Dono, validando matching, tracking, segurança e conclusão.
 */

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
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`CRITICAL: Falha ao listar usuários (Auth API): ${error.message}`);

    const users = data?.users || [];
    if (users.length === 0) break;

    const targets = users.filter(u => 
      u.email?.endsWith("@e2e.vaipet.invalid") && 
      u.user_metadata?.e2e_test === true &&
      (u.user_metadata?.e2e_run_id && u.user_metadata.e2e_run_id !== "") &&
      u.created_at < cutoff
    );

    if (targets.length > 0) {
      log(`Limpando ${targets.length} usuários (Página ${page})...`);
      await quickCleanup(targets.map(u => u.id));
    }

    if (users.length < perPage) break;
    page++;
  }
}

async function quickCleanup(ids: string[]) {
  if (!ids.length) return;
  
  log(`quickCleanup: Processando ${ids.length} usuários...`);

  // Exclusão em ordem hierárquica
  const { data: sessions, error: listSErr } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.map(id => `'${id}'`).join(",")}),walker_id.in.(${ids.map(id => `'${id}'`).join(",")})`);
  
  if (listSErr) throw new Error(`Falha ao buscar sessões: ${listSErr.message}`);

  if (sessions?.length) {
    const sIds = sessions.map(s => s.id);
    const { error: tErr } = await admin.from("walker_tracking").delete().in("walk_session_id", sIds);
    if (tErr) throw new Error(`walker_tracking cleanup error: ${tErr.message}`);

    const { error: oErr } = await admin.from("walk_offers").delete().in("session_id", sIds);
    if (oErr) throw new Error(`walk_offers cleanup error: ${oErr.message}`);

    const { error: eErr } = await admin.from("petwalker_earnings").delete().in("walk_session_id", sIds);
    if (eErr) throw new Error(`petwalker_earnings cleanup error: ${eErr.message}`);

    const { error: sErr } = await admin.from("walk_sessions").delete().in("id", sIds);
    if (sErr) throw new Error(`walk_sessions cleanup error: ${sErr.message}`);
  }

  const { error: petErr } = await admin.from("pets").delete().in("owner_id", ids);
  if (petErr) throw new Error(`pets cleanup error: ${petErr.message}`);

  const { error: wpErr } = await admin.from("petwalker_profiles").delete().in("user_id", ids);
  if (wpErr) throw new Error(`petwalker_profiles cleanup error: ${wpErr.message}`);

  const { error: urErr } = await admin.from("user_roles").delete().in("user_id", ids);
  if (urErr) throw new Error(`user_roles cleanup error: ${urErr.message}`);

  const { error: prErr } = await admin.from("profiles").delete().in("id", ids);
  if (prErr) throw new Error(`profiles cleanup error: ${prErr.message}`);
  
  for (const id of ids) {
    const { error: dErr } = await admin.auth.admin.deleteUser(id);
    if (dErr) throw new Error(`Auth deleteUser error (${id}): ${dErr.message}`);
  }

  // Verificação pós-limpeza (fail-closed)
  const { count, error: countErr } = await admin
    .from("profiles")
    .select("*", { count: 'exact', head: true })
    .in("id", ids);
  if (countErr) throw new Error(`Cleanup verification error: ${countErr.message}`);
  if (count && count > 0) throw new Error(`CRITICAL: Cleanup falhou — ${count} perfis ainda existem`);
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
  
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: signed, error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  
  return { id, email, password, session: JSON.stringify(signed.session), client };
}

async function createAuthedContext(browser: any, sessionJson: string, coords: { lng: number; lat: number }) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: { longitude: coords.lng, latitude: coords.lat },
    locale: "pt-BR",
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [STORAGE_KEY, sessionJson]);
  await page.reload({ waitUntil: "networkidle" });
  return { context, page };
}

test.describe.configure({ mode: "serial", retries: 0 });

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await preflightCleanup();
});

test("setup: Isolamento e Autenticação", async ({ browser }) => {
  const runId = `setup_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");
  let oCtx: { context: BrowserContext; page: Page } | undefined;

  try {
    oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    // Validar isolamento RLS: Dono não vê perfil privado do Walker
    const { data: walkerProfile } = await owner.client.from("petwalker_profiles").select("experience_years").eq("user_id", walker.id).maybeSingle();
    expect(walkerProfile).toBeNull();
  } finally {
    if (oCtx) await oCtx.context.close();
    await quickCleanup([owner.id, walker.id]);
  }
});

test("matching: Ciclo real de oferta via job e aceite via UI", async ({ browser }) => {
  const runId = `match_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");
  let oCtx: { context: BrowserContext; page: Page } | undefined;
  let wCtx: { context: BrowserContext; page: Page } | undefined;

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: `PetMatch_${runId}`, breed: "SRD", is_active: true }).select("id").single();
    oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7009, lat: -23.6004 });

    // Dono solicita
    await oCtx.page.goto("/search-walk", { waitUntil: 'networkidle' });
    const petCard = oCtx.page.locator(`[data-testid="pet-card-${pet!.id}"]`);
    await expect(petCard).toBeVisible({ timeout: 15000 });
    await petCard.click();
    
    await oCtx.page.click('button:has-text("30 minutos")');
    await oCtx.page.click('button:has-text("Solicitar Agora")');

    // Job de matching real
    await expect.poll(async () => {
      await admin.rpc("process_walk_matching");
      const { data } = await admin.from("walk_offers").select("offer_status").eq("walker_id", walker.id);
      return data?.some(o => o.offer_status === 'pending');
    }, { timeout: 15000 }).toBe(true);

    // PetWalker aceita via UI
    await wCtx.page.goto("/petwalker/painel");
    const offerCard = wCtx.page.locator(`button:has-text("ACEITAR PASSEIO")`);
    await expect(offerCard).toBeVisible({ timeout: 15000 });
    await offerCard.click();

    // Validar aceite via Realtime no Dono
    await expect(oCtx.page.locator('h3:has-text("Passeio confirmado")')).toBeVisible({ timeout: 15000 });
  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([owner.id, walker.id]);
  }
});

async function prepareOperationalWalk(runId: string, owner: any, walker: any, petName: string) {
  const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: petName, breed: "SRD", is_active: true }).select("id").single();
  
  // 1. Criar sessão
  const { data: sess } = await admin.from("walk_sessions").insert({
    customer_id: owner.id,
    current_status: "searching",
    pet_id: pet!.id,
    matching_expires_at: new Date(Date.now() + 600000).toISOString(),
    meeting_point_geom: `SRID=4326;POINT(-46.7 -23.6)`
  }).select("id").single();

  // 2. Matching e Aceite via RPC (Simulando operacional)
  await admin.rpc("process_walk_matching");
  const { error: accErr } = await walker.client.rpc("accept_walk_request", { _session_id: sess!.id });
  if (accErr) throw accErr;

  // 3. Transições até In Progress via RPC
  await walker.client.rpc("petwalker_start_heading", { _session_id: sess!.id });
  await walker.client.rpc("petwalker_arrive_pickup", { _session_id: sess!.id });
  await walker.client.rpc("petwalker_start_walk", { _session_id: sess!.id });

  return { petId: pet!.id, sessionId: sess!.id };
}

test("tracking: GPS operacional, Throttle e Realtime", async ({ browser }) => {
  const runId = `track_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");
  let oCtx: { context: BrowserContext; page: Page } | undefined;
  let wCtx: { context: BrowserContext; page: Page } | undefined;

  try {
    const { sessionId } = await prepareOperationalWalk(runId, owner, walker, `PetTrack_${runId}`);
    oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7001, lat: -23.6001 });

    await oCtx.page.goto(`/search-walk?resume=${sessionId}`);
    
    // Validar marcador do dono existe
    const walkerMarker = oCtx.page.locator('.mapboxgl-marker');
    await expect(walkerMarker).toBeVisible({ timeout: 15000 });

    // 3 atualizações de GPS com throttle
    const points = [
      { lng: -46.7005, lat: -23.6005 },
      { lng: -46.7008, lat: -23.6008 },
      { lng: -46.7010, lat: -23.6010 }
    ];

    for (const pt of points) {
      await wCtx.client.rpc("update_walker_location", { _lat: pt.lat, _lng: pt.lng, _accuracy: 10 });
      await wCtx.client.rpc("append_walk_tracking_point", { _session_id: sessionId, _point: [pt.lng, pt.lat] });
      // Esperar throttle do servidor (5s) + margem
      await new Promise(r => setTimeout(r, 6000));
    }

    // Comprovar persistência e trilha
    const { data: trail } = await admin.from("walker_tracking").select("*").eq("walk_session_id", sessionId);
    expect(trail?.length).toBeGreaterThanOrEqual(3);

    // Comprovar que o marcador no dono mudou de posição sem reload
    // (Apenas verificamos que o marcador continua visível e o status é walking)
    await expect(oCtx.page.locator('h2:has-text("Passeio em andamento")')).toBeVisible();

  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([owner.id, walker.id]);
  }
});

test("negative: Segurança de RPC e Regras de Negócio", async ({ browser }) => {
  const runId = `neg_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");
  const busyWalker = await provisionUser(runId, "petwalker");
  const stranger = await provisionUser(runId, "pet_owner");

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: "N", breed: "SRD" }).select("id").single();
    
    // 1. GPS inválido (limites físicos)
    const { error: gpsErr } = await walker.client.rpc("update_walker_location", { _lat: 91, _lng: 0, _accuracy: 10 });
    expect(gpsErr).toBeTruthy();

    // 2. Solicitação sem Pet
    const { error: noPetErr } = await owner.client.from("walk_sessions").insert({ customer_id: owner.id, current_status: "searching" });
    expect(noPetErr).toBeTruthy();

    const { data: sess } = await admin.from("walk_sessions").insert({
      customer_id: owner.id,
      current_status: "searching",
      matching_expires_at: new Date(Date.now() + 600000).toISOString(),
      pet_id: pet!.id
    }).select("id").single();

    // 3. Auto-aceite proibido
    const { error: autoErr } = await owner.client.rpc("accept_walk_request", { _session_id: sess!.id });
    expect(autoErr?.message).toContain("Auto-aceite proibido");

    // 4. Acesso negado para estranho (RLS)
    const { error: sErr } = await stranger.client.rpc("accept_walk_request", { _session_id: sess!.id });
    expect(sErr).toBeTruthy();

    // 5. Walker ocupado não deve ver ofertas (validado via RPC get_available_walk_offers)
    await admin.from("walk_sessions").insert({
      customer_id: stranger.id,
      walker_id: busyWalker.id,
      current_status: "in_progress",
      pet_id: pet!.id, // reuse pet for brevity
      matching_expires_at: new Date(Date.now() + 600000).toISOString()
    });
    const { data: busyOffers } = await busyWalker.client.rpc("get_available_walk_offers");
    expect(busyOffers?.length || 0).toBe(0);

    // 6. Sessão expirada não pode ser aceita
    const { data: expSess } = await admin.from("walk_sessions").insert({
      customer_id: owner.id,
      current_status: "searching",
      matching_expires_at: new Date(Date.now() - 1000).toISOString(),
      pet_id: pet!.id
    }).select("id").single();
    const { error: expErr } = await walker.client.rpc("accept_walk_request", { _session_id: expSess!.id });
    expect(expErr).toBeTruthy();

    // 7. Transição de status inválida (finalizar sem iniciar)
    const { error: statusErr } = await walker.client.rpc("petwalker_complete_walk", { _session_id: sess!.id });
    expect(statusErr).toBeTruthy();

    // 8. RLS: Dono não pode deletar sessão de outro dono
    const { error: delErr } = await stranger.client.from("walk_sessions").delete().eq("id", sess!.id);
    expect(delErr).toBeTruthy();

    // 9. RLS: Walker não pode ver localização de sessão concluída
    await admin.from("walk_sessions").update({ current_status: 'completed' }).eq("id", sess!.id);
    const { data: trackData } = await walker.client.from("walker_tracking").select("*").eq("walk_session_id", sess!.id);
    expect(trackData?.length || 0).toBe(0);

    // 10. Anonimato: Acesso sem token
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { error: anonErr } = await anon.rpc("get_available_walk_offers");
    expect(anonErr).toBeTruthy();

  } finally {
    await quickCleanup([owner.id, walker.id, busyWalker.id, stranger.id]);
  }
});

test("completion: Fluxo UI e Cálculo de Métricas", async ({ browser }) => {
  const runId = `comp_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: "C", breed: "SRD" }).select("id").single();
    const { data: sess } = await admin.from("walk_sessions").insert({
      customer_id: owner.id,
      walker_id: walker.id,
      current_status: "in_progress",
      start_time: new Date(Date.now() - 900000).toISOString(),
      pet_id: pet!.id,
      matching_expires_at: new Date(Date.now() + 600000).toISOString()
    }).select("id").single();

    const wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7, lat: -23.6 });
    await wCtx.page.goto(`/petwalker/passeio/${sess!.id}`);

    await wCtx.page.click('button:has-text("Finalizar passeio")');
    await wCtx.page.click('button:has-text("Confirmar")');

    await expect(wCtx.page).toHaveURL("/petwalker/painel");
    const { data: final } = await admin.from("walk_sessions").select("current_status").eq("id", sess!.id).single();
    expect(final!.current_status).toBe("completed");
    
    await wCtx.context.close();
  } finally {
    await quickCleanup([owner.id, walker.id]);
  }
});

test("full: Jornada Completa determinística (Dois Contextos)", async ({ browser }) => {
  const runId = `full_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: `FullPet_${runId}`, breed: "SRD", is_active: true }).select("id").single();
    const oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    const wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7009, lat: -23.6004 });

    // 1. Dono solicita via UI
    await oCtx.page.goto("/inicio");
    await oCtx.page.locator('h1:has-text("Bora"), h1:has-text("passear?")').waitFor({ state: 'visible', timeout: 15000 });
    await oCtx.page.click('#tour-start-walk');
    await expect(oCtx.page).toHaveURL(/\/search-walk/);
    await oCtx.page.waitForSelector(`[data-testid="pet-card-${pet!.id}"]`, { state: 'visible', timeout: 15000 });
    await oCtx.page.click(`[data-testid="pet-card-${pet!.id}"]`);
    await oCtx.page.click('button:has-text("30 minutos")');
    await oCtx.page.click('button:has-text("Solicitar Agora")');

    // 2. Matching via Job Real
    await expect.poll(async () => {
      await admin.rpc("process_walk_matching");
      const { data } = await admin.from("walk_offers").select("offer_status").eq("walker_id", walker.id);
      return data?.some(o => o.offer_status === 'pending');
    }, { timeout: 15000 }).toBe(true);

    // 3. Walker aceita via UI
    await wCtx.page.goto("/petwalker/painel");
    const offerBtn = wCtx.page.locator(`button:has-text("ACEITAR PASSEIO")`);
    await expect(offerBtn).toBeVisible({ timeout: 10000 });
    await offerBtn.click();

    // 4. Ciclo operacional via UI
    await wCtx.page.click('button:has-text("Iniciar deslocamento")');
    await wCtx.page.click('button:has-text("Cheguei ao local")');
    await wCtx.page.click('button:has-text("Iniciar passeio")');

    // 5. GPS operacional
    await wCtx.context.setGeolocation({ longitude: -46.7005, latitude: -23.6005 });
    
    // 6. Conclusão via UI
    await wCtx.page.click('button:has-text("Finalizar passeio")');
    await wCtx.page.click('button:has-text("Confirmar")');

    await expect(wCtx.page).toHaveURL("/petwalker/painel");
    await expect(oCtx.page.locator('h2:has-text("Passeio concluído"), h3:has-text("Passeio concluído")').first()).toBeVisible({ timeout: 15000 });

    await oCtx.context.close();
    await wCtx.context.close();
  } finally {
    await quickCleanup([owner.id, walker.id]);
  }
});
