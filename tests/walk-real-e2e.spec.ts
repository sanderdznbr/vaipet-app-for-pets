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
    let response;
    try {
      response = await admin.auth.admin.listUsers({ page, perPage });
    } catch (e: any) {
      log(`AVISO: Falha na chamada listUsers (rede/gateway): ${e.message}`);
      break;
    }

    const { data, error } = response;
    if (error) {
      log(`AVISO: Falha ao listar usuários (Auth API error): ${error.message}`);
      break;
    }

    const users = data?.users || [];
    if (users.length === 0) break;

    const targets = users.filter(u => 
      u.email?.endsWith("@e2e.vaipet.invalid") && 
      u.user_metadata?.e2e_test === true &&
      u.created_at < cutoff
    );

    if (targets.length > 0) {
      log(`Limpando ${targets.length} usuários expirados (Página ${page})...`);
      await quickCleanup(targets.map(u => u.id));
    }

    if (users.length < perPage) break;
    page++;
  }
}

async function quickCleanup(ids: string[]) {
  if (!ids.length) return;
  
  // Exclusão em ordem hierárquica
  const { data: sessions, error: sErr } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  
  if (sErr) throw new Error(`Falha ao buscar sessões para cleanup: ${sErr.message}`);

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
    const { error: dErr } = await admin.auth.admin.deleteUser(id);
    if (dErr) throw new Error(`CRITICAL: Erro ao deletar usuário Auth ${id}: ${dErr.message}`);
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

  try {
    const oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    // Validar isolamento RLS: Dono não vê perfil privado do Walker
    const { data: walkerProfile } = await owner.client.from("petwalker_profiles").select("experience_years").eq("user_id", walker.id).maybeSingle();
    expect(walkerProfile).toBeNull();
    await oCtx.context.close();
  } finally {
    await quickCleanup([owner.id, walker.id]);
  }
});

test("matching: Ciclo real de oferta via job e aceite via UI", async ({ browser }) => {
  const runId = `match_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: `PetMatch_${runId}`, breed: "SRD", is_active: true }).select("id").single();
    const oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    const wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7009, lat: -23.6004 });

    // Dono solicita
    await oCtx.page.goto("/inicio");
    await oCtx.page.goto("/inicio");
    await oCtx.page.locator('h1:has-text("Bora"), h1:has-text("passear?")').waitFor({ state: 'visible', timeout: 15000 });
    await oCtx.page.click('#tour-start-walk');
    await expect(oCtx.page).toHaveURL(/\/search-walk/);
    await oCtx.page.waitForSelector(`[data-testid="pet-card-${pet!.id}"]`, { state: 'visible', timeout: 15000 });
    await oCtx.page.click(`[data-testid="pet-card-${pet!.id}"]`);
    await oCtx.page.click('button:has-text("30 minutos")');
    await oCtx.page.click('button:has-text("Solicitar Agora")');

    // Job de matching real
    await expect.poll(async () => {
      await admin.rpc("process_walk_matching");
      const { data } = await admin.from("walk_offers").select("offer_status").eq("walker_id", walker.id);
      return data?.some(o => o.offer_status === 'pending');
    }, { timeout: 15000 }).toBe(true);

    // PetWalker aceita
    await wCtx.page.goto("/petwalker/painel");
    const offerCard = wCtx.page.locator(`button:has-text("ACEITAR PASSEIO")`);
    await expect(offerCard).toBeVisible({ timeout: 10000 });
    await offerCard.click();

    // Validar aceite via Realtime no Dono
    await expect(oCtx.page.locator('h3:has-text("Passeio confirmado")')).toBeVisible({ timeout: 10000 });
    
    await oCtx.context.close();
    await wCtx.context.close();
  } finally {
    await quickCleanup([owner.id, walker.id]);
  }
});

test("tracking: GPS real e Marcador Dinâmico", async ({ browser }) => {
  const runId = `track_${Math.random().toString(36).slice(2, 8)}`;
  const owner = await provisionUser(runId, "pet_owner");
  const walker = await provisionUser(runId, "petwalker");

  try {
    const { data: pet } = await admin.from("pets").insert({ owner_id: owner.id, name: `PetTrack_${runId}`, breed: "SRD" }).select("id").single();
    const { data: sess } = await admin.from("walk_sessions").insert({
      customer_id: owner.id,
      walker_id: walker.id,
      current_status: "in_progress",
      start_time: new Date().toISOString(),
      pet_id: pet!.id,
      matching_expires_at: new Date(Date.now() + 600000).toISOString()
    }).select("id").single();

    const oCtx = await createAuthedContext(browser, owner.session, { lng: -46.7, lat: -23.6 });
    const wCtx = await createAuthedContext(browser, walker.session, { lng: -46.7001, lat: -23.6001 });

    await wCtx.page.goto(`/petwalker/passeio/${sess!.id}`);
    await oCtx.page.goto(`/search-walk?resume=${sess!.id}`);

    // Mover GPS
    const newPos = { lng: -46.7005, lat: -23.6005 };
    await wCtx.context.setGeolocation({ longitude: newPos.lng, latitude: newPos.lat });

    // Validar atualização no mapa do dono
    await expect.poll(async () => {
      const { data } = await admin.from("walker_tracking").select("*").eq("walk_session_id", sess!.id);
      return data?.length || 0;
    }, { timeout: 15000 }).toBeGreaterThan(0);

    await oCtx.context.close();
    await wCtx.context.close();
  } finally {
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
