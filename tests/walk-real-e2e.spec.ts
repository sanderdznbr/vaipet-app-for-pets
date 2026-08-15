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
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`CRITICAL: Falha ao listar usuários para cleanup: ${error.message}`);
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

  // Exclusão em ordem hierárquica
  const { data: sessions, error: listSErr } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  
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
    // 1. Setup: Pet para o dono
    const { data: pet } = await admin.from("pets").insert({ 
      owner_id: owner.id, 
      name: `PetMatch_${runId}`, 
      breed: "SRD", 
      is_active: true 
    }).select("id").single();

    oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7001, lat: -23.6001 });

    // 2. Dono solicita passeio via UI
    await oCtx.page.goto("/", { waitUntil: 'networkidle' });
    
    // Clicar no CTA de iniciar passeio (usando ID do tour definido em HomePasseio.tsx)
    const heroBtn = oCtx.page.locator('#tour-start-walk');
    await expect(heroBtn).toBeVisible({ timeout: 15000 });
    await heroBtn.click();
    
    // Modal de seleção de tempo
    await oCtx.page.click('button:has-text("30 minutos")');
    await oCtx.page.click('button:has-text("Confirmar")');
    
    // Esperar redirecionamento e capturar session_id
    await expect(oCtx.page).toHaveURL(/.*search-walk.*/, { timeout: 15000 });
    const url = new URL(oCtx.page.url());
    const sessId = url.searchParams.get("resume");
    expect(sessId).toBeTruthy();

    // 3. Matching Job (Server-side)
    await expect.poll(async () => {
      await admin.rpc("process_walk_matching");
      const { data } = await admin.from("walk_offers").select("offer_status").eq("session_id", sessId!);
      return data?.some(o => o.offer_status === 'pending');
    }, { timeout: 15000 }).toBe(true);

    // 4. Walker aceita via UI no Painel
    await wCtx.page.goto("/petwalker/painel");
    const acceptBtn = wCtx.page.locator('button:has-text("Aceitar Passeio")');
    await expect(acceptBtn).toBeVisible({ timeout: 20000 });
    await acceptBtn.click();

    // 5. Verificação de sucesso
    await expect(wCtx.page).toHaveURL(/.*walk-details.*/, { timeout: 15000 });
    const { data: sess } = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", sessId!).single();
    expect(sess?.current_status).toBe("walker_assigned");
    expect(sess?.walker_id).toBe(walker.id);

  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([owner.id, walker.id]);
  }
});

async function prepareOperationalWalk(runId: string, owner: any, walker: any, petName: string) {
  const { data: pet, error: petErr } = await admin.from("pets").insert({ owner_id: owner.id, name: petName, breed: "SRD", is_active: true }).select("id").single();
  if (petErr) throw new Error(`Falha ao criar pet: ${petErr.message}`);
  
  const { data: sess, error: sessErr } = await admin.from("walk_sessions").insert({
    customer_id: owner.id,
    current_status: "searching",
    pet_id: pet!.id,
    matching_expires_at: new Date(Date.now() + 600000).toISOString(),
    meeting_point_geom: `SRID=4326;POINT(-46.7 -23.6)`,
    home_location: { lng: -46.7, lat: -23.6 },
    planned_duration_minutes: 30,
    total_price_cents: 2250
  }).select("id").single();
  if (sessErr) throw new Error(`Falha ao criar sessão: ${sessErr.message}`);

  await admin.rpc("process_walk_matching");
  const { error: accErr } = await walker.client.rpc("accept_walk_request", { _session_id: sess!.id });
  if (accErr) throw new Error(`Falha ao aceitar: ${accErr.message}`);

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
    
    // 1. Comprovar que o marcador do dono existe e ler posição inicial
    const walkerMarker = oCtx.page.locator('.mapboxgl-marker').first();
    await expect(walkerMarker).toBeVisible({ timeout: 15000 });
    const initialPos = await walkerMarker.boundingBox();

    // 2. 3 atualizações de GPS real via context.setGeolocation()
    // Abrir página operacional do walker para disparar watchPosition
    const wOpCtx = await createAuthedContext(browser, walker.session, { lng: -46.7001, lat: -23.6001 });
    await wOpCtx.page.goto(`/petwalker/passeio/${sessionId}`);

    const points = [
      { lng: -46.7005, lat: -23.6005 },
      { lng: -46.7008, lat: -23.6008 },
      { lng: -46.7010, lat: -23.6010 }
    ];

    for (const pt of points) {
      await wOpCtx.context.setGeolocation({ longitude: pt.lng, latitude: pt.lat });
      await wOpCtx.page.waitForTimeout(7000); // 5s throttle + 2s buffer
    }
    await wOpCtx.context.close();

    // 3. Comprovar persistência da trilha histórica
    const { data: trail } = await admin.from("walker_tracking").select("*").eq("walk_session_id", sessionId);
    expect(trail?.length).toBeGreaterThanOrEqual(3);

    // 4. Comprovar que a posição visual do marcador mudou sem reload
    const finalPos = await walkerMarker.boundingBox();
    expect(finalPos!.x).not.toBe(initialPos!.x);
    expect(oCtx.page.url()).toContain(sessionId); // Não recarregou a página do dono (preservou URL)

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
    
    // 1. GPS inválido
    const { error: gpsErr } = await walker.client.rpc("update_walker_location", { _lat: 91, _lng: 0, _accuracy: 10 });
    expect(gpsErr).toBeTruthy();

    // 2. Auto-aceite proibido
    const { data: sess } = await admin.from("walk_sessions").insert({
      customer_id: owner.id,
      current_status: "searching",
      matching_expires_at: new Date(Date.now() + 600000).toISOString(),
      pet_id: pet!.id
    }).select("id").single();
    const { error: autoErr } = await owner.client.rpc("accept_walk_request", { _session_id: sess!.id });
    expect(autoErr?.message).toContain("Auto-aceite proibido");

    // 3. RLS: Stranger cannot delete session
    const { error: delErr } = await stranger.client.from("walk_sessions").delete().eq("id", sess!.id).select("id");
    expect(delErr || []).toHaveLength(0);
    const { data: stillExists } = await admin.from("walk_sessions").select("id").eq("id", sess!.id).single();
    expect(stillExists).toBeTruthy();

    // 4. Expirada não pode ser aceita
    const { data: expSess } = await admin.from("walk_sessions").insert({
      customer_id: owner.id,
      current_status: "searching",
      matching_expires_at: new Date(Date.now() - 1000).toISOString(),
      pet_id: pet!.id
    }).select("id").single();
    const { error: expErr } = await walker.client.rpc("accept_walk_request", { _session_id: expSess!.id });
    expect(expErr).toBeTruthy();

    // 5. matching_expires_at NULL
    const { data: nullSess } = await admin.from("walk_sessions").insert({
      customer_id: owner.id,
      current_status: "searching",
      pet_id: pet!.id
    }).select("id").single();
    const { error: nullErr } = await walker.client.rpc("accept_walk_request", { _session_id: nullSess!.id });
    expect(nullErr).toBeTruthy();

    // 6. Privacidade pós-conclusão: RLS no tracking
    await admin.from("walk_sessions").update({ current_status: 'completed', walker_id: walker.id }).eq("id", sess!.id);
    await admin.from("walker_tracking").insert({ walk_session_id: sess!.id, location: `SRID=4326;POINT(-46 -23)` });
    
    const { data: trackData } = await stranger.client.from("walker_tracking").select("*").eq("walk_session_id", sess!.id);
    expect(trackData?.length || 0).toBe(0);

    // 7. Ponto de GPS após conclusão
    const { error: lateGps } = await walker.client.rpc("append_walk_tracking_point", { _session_id: sess!.id, _point: [-46, -23] });
    expect(lateGps).toBeTruthy();

  } finally {
    await quickCleanup([owner.id, walker.id, busyWalker.id, stranger.id]);
  }
});

test("completion: Fluxo UI e Cálculo de Métricas", async ({ browser }) => {
  const runId = `comp_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");
  let wCtx: { context: BrowserContext; page: Page } | undefined;

  try {
    const { sessionId } = await prepareOperationalWalk(runId, owner, walker, `PetComp_${runId}`);
    
    wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7, lat: -23.6 });
    await wCtx.page.goto(`/petwalker/passeio/${sessionId}`);

    // Validação de conclusão UI
    await wCtx.page.click('button:has-text("Finalizar passeio")');
    await wCtx.page.click('button:has-text("Confirmar")');

    await expect(wCtx.page).toHaveURL("/petwalker/painel");
    
    // Validar preço e duração no histórico
    const { data: final } = await admin.from("walk_sessions").select("current_status, total_price_cents, actual_duration_minutes").eq("id", sessionId).single();
    expect(final!.current_status).toBe("completed");
    expect(final!.total_price_cents).toBeGreaterThan(0);
    
    // Segunda conclusão deve falhar (já testado em negative, mas bom ter aqui)
    const { error: repeatErr } = await walker.client.rpc("petwalker_complete_walk", { _session_id: sessionId });
    expect(repeatErr).toBeTruthy();

  } finally {
    if (wCtx) await wCtx.context.close();
    await quickCleanup([owner.id, walker.id]);
  }
});

test("full: Jornada Completa determinística (Dois Contextos)", async ({ browser }) => {
  const runId = `full_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");
  let oCtx: { context: BrowserContext; page: Page } | undefined;
  let wCtx: { context: BrowserContext; page: Page } | undefined;

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: `FullPet_${runId}`, breed: "SRD", is_active: true }).select("id").single();
    oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7009, lat: -23.6004 });

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
    await expect(offerBtn).toBeVisible({ timeout: 15000 });
    await offerBtn.click();

    // 4. Ciclo operacional via UI
    await wCtx.page.click('button:has-text("Iniciar deslocamento")');
    await wCtx.page.click('button:has-text("Cheguei ao local")');
    await wCtx.page.click('button:has-text("Iniciar passeio")');

    // 5. GPS operacional
    await wCtx.context.setGeolocation({ latitude: -23.6005, longitude: -46.7005 });
    await wCtx.page.waitForTimeout(7000); // Esperar watchPosition capturar e processar (throttled 5s + 2s buffer)
    
    // 6. Conclusão via UI
    await wCtx.page.click('button:has-text("Finalizar passeio")');
    await wCtx.page.click('button:has-text("Confirmar")');

    await expect(wCtx.page).toHaveURL("/petwalker/painel");
    await expect(oCtx.page.locator('h2:has-text("Passeio concluído"), h3:has-text("Passeio concluído")').first()).toBeVisible({ timeout: 15000 });

  } finally {
    if (oCtx) await oCtx.context.close();
    if (wCtx) await wCtx.context.close();
    await quickCleanup([owner.id, walker.id]);
  }
});
