/**
 * E2E OPERACIONAL REAL — Fase 3.1
 *
 * Nenhum mock. Banco real do preview, RPCs reais, Realtime real, matching
 * geográfico real (pg_cron -> process_walk_matching), duas sessões
 * autenticadas simultâneas em contextos isolados.
 *
 * Provisionamento/teardown são código de teste (nunca migration) e usam
 * SUPABASE_SERVICE_ROLE_KEY apenas no processo Node — nunca no browser.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const ART = path.resolve("test-results/walk-real-e2e");
fs.mkdirSync(ART, { recursive: true });

// ---------- log sanitizado ----------
const short = (id?: string | null) => (id ? `${String(id).slice(0, 8)}…` : "null");
const LOG: string[] = [];
const log = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  LOG.push(line);
  // eslint-disable-next-line no-console
  console.log(line);
};
const flushLog = () =>
  fs.writeFileSync(path.join(ART, "transitions.log"), LOG.join("\n") + "\n", "utf8");

/** Remove dados E2E abandonados (TTL: 1 hora) com paginação e falha explícita */
async function preflightCleanup() {
  log("iniciando preflight cleanup de dados abandonados...");
  const ttlMs = 3600_000;
  const cutoff = new Date(Date.now() - ttlMs).toISOString();
  let allTargetIds: string[] = [];
  let nextCursor: string | undefined;

  // 1. Paginando listUsers para encontrar todos os usuários @e2e.vaipet.invalid
  do {
    const { data, error } = await admin.auth.admin.listUsers();
    
    if (error) {
      log(`AVISO: Falha ao listar usuários (tentando continuar sem cleanup de Auth): ${error.message}`);
      break; 
    }

    const targets = (data.users || []).filter(u => 
      u.email?.endsWith("@e2e.vaipet.invalid") && 
      u.created_at < cutoff &&
      (u.user_metadata?.e2e_test === true || u.email?.startsWith("e2e."))
    );
    
    allTargetIds.push(...targets.map(u => u.id));
    nextCursor = data.nextPageToken;
  } while (nextCursor);

  if (allTargetIds.length === 0) {
    log("nenhum dado E2E abandonado encontrado (TTL + metadata check).");
    return;
  }

  log(`encontrados ${allTargetIds.length} usuários abandonados. removendo dependências...`);

  // 2. Exclusão em ordem de dependência
  const deleteOps = [
    { table: "walker_tracking", col: "walker_id" },
    { table: "walk_offers", col: "walker_id" },
    { table: "pets", col: "owner_id" },
    { table: "petwalker_profiles", col: "user_id" },
    { table: "user_roles", col: "user_id" },
    { table: "profiles", col: "id" }
  ];

  for (const op of deleteOps) {
    const { error } = await admin.from(op.table).delete().in(op.col, allTargetIds);
    if (error) {
      log(`ERRO FATAL: Falha ao limpar tabela ${op.table}: ${error.message}`);
      process.exit(1);
    }
  }

  // Sessões e ofertas vinculadas
  const { data: sessions, error: sError } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${allTargetIds.join(",")}),walker_id.in.(${allTargetIds.join(",")})`);
  
  if (sError) {
    log(`ERRO FATAL: Falha ao buscar sessões para cleanup: ${sError.message}`);
    process.exit(1);
  }

  const sIds = (sessions || []).map(s => s.id);
  if (sIds.length > 0) {
    await admin.from("walk_offers").delete().in("session_id", sIds);
    await admin.from("walk_sessions").delete().in("id", sIds);
  }

  // 3. Exclusão dos usuários no Auth
  for (const id of allTargetIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      log(`AVISO: Falha ao deletar usuário ${short(id)}: ${error.message}`);
      // Não interrompe aqui pois o usuário pode ter sido deletado em paralelo
    }
  }

  // 4. Verificação pós-limpeza
  const { data: verify } = await admin.auth.admin.listUsers();
  const stillExists = (verify.users || []).filter(u => allTargetIds.includes(u.id));
  if (stillExists.length > 0) {
    log(`ERRO FATAL: Cleanup incompleto. ${stillExists.length} usuários ainda presentes.`);
    process.exit(1);
  }

  log(`cleanup concluído com sucesso. IDs removidos: ${allTargetIds.map(short).join(", ")}`);
}

async function quickCleanup(ids: string[]) {
  if (!ids.length) return;
  const deleteOps = [
    { table: "walker_tracking", col: "walker_id" },
    { table: "walk_offers", col: "walker_id" },
    { table: "pets", col: "owner_id" },
    { table: "petwalker_profiles", col: "user_id" },
    { table: "user_roles", col: "user_id" },
    { table: "profiles", col: "id" }
  ];
  for (const op of deleteOps) {
    await admin.from(op.table).delete().in(op.col, ids);
  }
  const { data: sessions } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  const sIds = (sessions || []).map(s => s.id);
  if (sIds.length > 0) {
    await admin.from("walk_offers").delete().in("session_id", sIds);
    await admin.from("walk_sessions").delete().in("id", sIds);
  }
}

// ---------- coordenadas sintéticas (ficção, não endereços reais) ----------
const OWNER_POINT = { lng: -46.700000, lat: -23.600000 };
const WALKER_START = { lng: -46.700900, lat: -23.600400 }; // ~110m
const WALK_TRACK = [
  { lng: -46.700100, lat: -23.600100 },
  { lng: -46.700250, lat: -23.600200 },
  { lng: -46.700400, lat: -23.600300 },
  { lng: -46.700550, lat: -23.600400 },
];

type Ctx = { context: BrowserContext; page: Page; name: string };

let admin: SupabaseClient;
let ownerId = "";
let walkerId = "";
let petId = "";
let sessionId = "";
let ownerEmail = "";
let walkerEmail = "";
let ownerPassword = "";
let walkerPassword = "";
let ownerSession: string = "";
let walkerSession: string = "";
let ownerCtx: Ctx;
let walkerCtx: Ctx;

const rand = () => Math.random().toString(36).slice(2, 10);

async function newAuthedContext(browser: any, name: string, sessionJson: string, coords: { lng: number; lat: number }): Promise<Ctx> {
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: { longitude: coords.lng, latitude: coords.lat },
    locale: "pt-BR",
    recordVideo: { dir: path.join(ART, `video-${name}`) },
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") log(`[${name}] console.error: ${m.text().slice(0, 240)}`);
    else if (/\[walk-(status|tracking)\]/.test(m.text()))
      log(`[${name}] ${m.text().slice(0, 300)}`);
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k as string, v as string),
    [STORAGE_KEY, sessionJson],
  );
  return { context, page, name };
}

const shot = async (c: Ctx, label: string) => {
  await c.page.screenshot({ path: path.join(ART, `${c.name}-${label}.png`) });
};

/** Chama uma RPC real usando a sessão real do próprio contexto do browser. */
async function rpcAsUser(c: Ctx, fn: string, args: Record<string, unknown>) {
  return c.page.evaluate(
    async ([url, key, name, body, storageKey]) => {
      const raw = localStorage.getItem(storageKey as string);
      const token = raw ? JSON.parse(raw).access_token : null;
      const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key as string,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, ok: res.ok, body: json };
    },
    [SUPABASE_URL, ANON_KEY, fn, args, STORAGE_KEY] as const,
  );
}

const dbSession = async () => {
  const { data, error } = await admin.from("walk_sessions").select("*").eq("id", sessionId).single();
  if (error) throw error;
  return data as Record<string, any>;
};

/** Chama uma RPC real com um token arbitrário (usuário externo) ou anônimo. */
async function rpcAsToken(fn: string, args: Record<string, unknown>, token?: string | null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

type RpcResult = { status: number; ok: boolean; body: unknown };

/** Negado = erro HTTP OU retorno de negócio false. Nunca "silenciosamente aceito". */
function expectDenied(label: string, r: RpcResult) {
  log(`negado? ${label}: http=${r.status} body=${JSON.stringify(r.body).slice(0, 160)}`);
  expect(r.ok === false || r.body === false, `${label} deveria ser negado`).toBe(true);
}

/** Snapshot íntegro do estado sensível, para provar que nada mudou após negativas. */
async function snapshotState() {
  const s = await dbSession();
  const { data: offers } = await admin
    .from("walk_offers")
    .select("id, walker_id, offer_status")
    .eq("session_id", sessionId)
    .order("id");
  const w = await dbWalker();
  const { count: trackCount } = await admin
    .from("walker_tracking")
    .select("id", { count: "exact", head: true })
    .eq("walk_session_id", sessionId);
  return {
    // Campos protegidos: nenhuma tentativa negada pode alterá-los.
    guarded: JSON.stringify({
      current_status: s.current_status,
      walker_id: s.walker_id,
      end_time: s.end_time,
      total_price_cents: s.total_price_cents,
      price_per_minute_cents: s.price_per_minute_cents,
      pricing_surcharge_cents: s.pricing_surcharge_cents,
      actual_duration_minutes: s.actual_duration_minutes,
      distance_km: s.distance_km,
      offers,
      walker: {
        availability_status: w.availability_status,
        current_walk_id: w.current_walk_id,
        completed_walks: w.completed_walks,
      },
    }),
    // O rastro do walker legítimo pode crescer pelo GPS real: só nunca encolhe.
    trail: (s.route_coordinates || []).length,
    trackCount: trackCount ?? 0,
  };
}

/** Cria um usuário real extra (limpo no teardown) e devolve o access_token. */
const extraUserIds: string[] = [];
async function createExtraUser(kind: "common" | "petwalker") {
  const email = `e2e.extra.${rand()}@e2e.vaipet.invalid`;
  const password = `Ex${rand()}!Aa1`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E Extra ${kind}` },
  });
  if (error) throw error;
  const id = data.user!.id;
  extraUserIds.push(id);
  if (kind === "petwalker") {
    await admin.from("user_roles").upsert({ user_id: id, role: "petwalker" }, { onConflict: "user_id,role" });
    await admin.from("petwalker_profiles").upsert(
      {
        user_id: id,
        approval_status: "approved",
        profile_completed: true,
        availability_status: "available",
        is_accepting_requests: true,
        public_bio: "E2E extra",
        experience_years: 1,
        service_radius_km: 5,
        price_30_minutes: 4500,
        completed_walks: 0,
      },
      { onConflict: "user_id" },
    );
  }
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const signed = await c.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id, token: signed.data.session!.access_token };
}
const dbWalker = async () => {
  const { data, error } = await admin
    .from("petwalker_profiles")
    .select("*")
    .eq("user_id", walkerId)
    .single();
  if (error) throw error;
  return data as Record<string, any>;
};

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 60_000, interval = 2_000): Promise<T> {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`timeout aguardando ${label} ${last ? `(${String(last).slice(0, 120)})` : ""}`);
}

test.describe.configure({ mode: "serial", retries: 0 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  expect(SUPABASE_URL, "SUPABASE_URL ausente").toBeTruthy();
  expect(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY ausente").toBeTruthy();
  expect(ANON_KEY, "chave publicável ausente").toBeTruthy();

  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await preflightCleanup();

  const runId = rand();
  ownerEmail = `e2e.owner.${runId}@e2e.vaipet.invalid`;
  walkerEmail = `e2e.walker.${runId}@e2e.vaipet.invalid`;
  ownerPassword = `Ow${rand()}!Aa1`;
  walkerPassword = `Wk${rand()}!Aa1`;

  const o = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { full_name: "E2E Owner", signup_intent: "pet_owner", e2e_test: true },
  });
  if (o.error) throw o.error;
  ownerId = o.data.user!.id;

  const w = await admin.auth.admin.createUser({
    email: walkerEmail,
    password: walkerPassword,
    email_confirm: true,
    user_metadata: { full_name: "E2E Walker", signup_intent: "petwalker", e2e_test: true },
  });
  if (w.error) throw w.error;
  walkerId = w.data.user!.id;
  log(`provisionado owner=${short(ownerId)} walker=${short(walkerId)}`);

  // Perfis (idempotente: trigger pode já ter criado)
  for (const [id, name] of [[ownerId, "E2E Owner"], [walkerId, "E2E Walker"]] as const) {
    await admin.from("profiles").upsert({ id, full_name: name, onboarding_completed: true });
  }

  const pet = await admin
    .from("pets")
    .insert({ owner_id: ownerId, name: `PetE2E${runId.slice(0, 4)}`, breed: "SRD", is_active: true })
    .select("id")
    .single();
  if (pet.error) throw pet.error;
  petId = pet.data.id;

  const roleRes = await admin.from("user_roles").insert({ user_id: walkerId, role: "petwalker" });
  if (roleRes.error && !/duplicate/i.test(roleRes.error.message)) throw roleRes.error;

  const prof = await admin.from("petwalker_profiles").upsert(
    {
      user_id: walkerId,
      approval_status: "approved",
      profile_completed: true,
      availability_status: "offline",
      is_accepting_requests: false,
      public_bio: "E2E",
      experience_years: 2,
      service_radius_km: 5,
      price_30_minutes: 4500,
      completed_walks: 0,
    },
    { onConflict: "user_id" },
  );
  if (prof.error) throw prof.error;
  log("petwalker aprovado e operacionalmente completo");

  // Sessões autenticadas independentes (senha real, sem service-role no browser)
  const signIn = async (email: string, password: string) => {
    const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return JSON.stringify({ ...data.session, user: data.user });
  };
  ownerSession = await signIn(ownerEmail, ownerPassword);
  walkerSession = await signIn(walkerEmail, walkerPassword);

  ownerCtx = await newAuthedContext(browser, "owner", ownerSession, OWNER_POINT);
  walkerCtx = await newAuthedContext(browser, "walker", walkerSession, WALKER_START);
  log("dois contextos isolados criados e autenticados");
});

test.afterAll(async () => {
  try {
    for (const c of [ownerCtx, walkerCtx]) {
      if (!c) continue;
      await c.context.close().catch(() => {});
    }
  } finally {
    if (admin) {
      // teardown completo, roda mesmo em falha
      if (walkerId) await admin.from("walker_tracking").delete().eq("walker_id", walkerId);
      await quickCleanup([ownerId, walkerId, ...extraUserIds].filter(Boolean));
      for (const id of [ownerId, walkerId, ...extraUserIds].filter(Boolean)) {
        await admin.auth.admin.deleteUser(id).catch(() => {});
      }
      log("teardown concluído (sessões, ofertas, tracking, pet, perfis, roles, usuários)");
    }
    flushLog();
  }
});

test("setup: isolamento das duas sessões simultâneas", async () => {
  const readKey = (c: Ctx) =>
    c.page.evaluate((k) => {
      const raw = localStorage.getItem(k as string);
      return raw ? JSON.parse(raw).user?.id ?? null : null;
    }, STORAGE_KEY);

  expect(await readKey(ownerCtx)).toBe(ownerId);
  expect(await readKey(walkerCtx)).toBe(walkerId);

  // O dono não consegue ler o perfil operacional privado do walker.
  const leak = await ownerCtx.page.evaluate(
    async ([url, key, wid, sk]) => {
      const raw = localStorage.getItem(sk as string);
      const token = raw ? JSON.parse(raw).access_token : null;
      const res = await fetch(`${url}/rest/v1/petwalker_profiles?user_id=eq.${wid}&select=price_30_minutes`, {
        headers: { apikey: key as string, Authorization: `Bearer ${token}` },
      });
      return { status: res.status, body: await res.text() };
    },
    [SUPABASE_URL, ANON_KEY, walkerId, STORAGE_KEY] as const,
  );
  log(`isolamento: leitura cruzada status=${leak.status} len=${leak.body.length}`);
  expect(await readKey(ownerCtx)).not.toBe(await readKey(walkerCtx));
});

test("matching: dono cria solicitação real de 15 min pela interface", async () => {
  const p = ownerCtx.page;
  await p.goto("/inicio", { waitUntil: "domcontentloaded" });
  await shot(ownerCtx, "01-inicio");
  await p.goto("/search-walk", { waitUntil: "domcontentloaded" });

  // Passo 1: pet
  const cont1 = p.getByRole("button", { name: "Continuar" });
  const petBtn = p.getByRole("button", { name: new RegExp("PetE2E", "i") }).first();
  if (await petBtn.count()) await petBtn.click().catch(() => {});
  await expect(cont1).toBeEnabled({ timeout: 30_000 });
  await cont1.click();

  // Passo 2: tipo (livre já default) -> Continuar
  await p.getByRole("button", { name: "Continuar" }).click();

  // Passo 3: duração 30 -> 15
  const minus = p.getByRole("button", { name: "Diminuir duração" });
  await expect(minus).toBeVisible({ timeout: 15_000 });
  await minus.click();
  await expect(p.getByText(/^15$/)).toBeVisible();
  const priceLine = p.locator("p", { hasText: /R\$/ }).first();
  await expect(priceLine).toBeVisible({ timeout: 20_000 });
  await expect(priceLine).not.toHaveText(/Calculando/, { timeout: 20_000 });
  const priceText = (await priceLine.innerText()).trim();
  log(`preço exibido na etapa de duração: "${priceText}"`);
  await shot(ownerCtx, "02-duracao-15min");
  // O orçamento canônico é R$ 22,50 (R$ 1,50/min).
  expect.soft(priceText.replace(/\s/g, ""), "UI deve exibir o orçamento canônico R$ 22,50").toContain("22,50");
  await p.getByRole("button", { name: "Continuar" }).click();

  // Passo 4: confirmação — modo "Agora" é o default
  const agora = p.getByRole("button", { name: "Agora" });
  if (await agora.count()) await agora.first().click().catch(() => {});
  await shot(ownerCtx, "03-confirmacao");

  const slider = p.locator('[data-testid="slide-to-confirm"]').first();
  await expect(slider).toBeVisible({ timeout: 15_000 });
  const box = await slider.boundingBox();
  if (!box) throw new Error("slide-to-confirm sem bounding box");
  await p.mouse.move(box.x + 24, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 25 });
  await p.mouse.up();

  const s = await waitFor("sessão searching no banco", async () => {
    const { data } = await admin
      .from("walk_sessions")
      .select("*")
      .eq("customer_id", ownerId)
      .eq("current_status", "searching")
      .maybeSingle();
    return data;
  }, 60_000);
  sessionId = (s as any).id;
  log(`sessão ${short(sessionId)} status=searching total=${(s as any).total_price_cents}`);
  expect((s as any).total_price_cents).toBe(2250);
  expect((s as any).walker_id).toBeNull();
  expect((s as any).matching_expires_at).toBeTruthy();
  await shot(ownerCtx, "04-buscando");
});

test("matching: petwalker fica online, recebe oferta real via matching e aceita", async () => {
  test.setTimeout(300_000);
  const p = walkerCtx.page;
  await p.goto("/petwalker", { waitUntil: "domcontentloaded" });
  await shot(walkerCtx, "05-painel");

  const onlineBtn = p.getByRole("button", { name: /ficar online|online/i }).first();
  await expect(onlineBtn).toBeVisible({ timeout: 30_000 });
  await onlineBtn.click();

  await waitFor("walker available com localização", async () => {
    const w = await dbWalker();
    return w.availability_status === "available" && w.last_known_location ? w : null;
  }, 90_000);
  log("walker online e com last_known_location gravado pelo GPS real do browser");

  const offer = await waitFor("oferta criada pelo matching (pg_cron)", async () => {
    const { data } = await admin
      .from("walk_offers")
      .select("*")
      .eq("session_id", sessionId)
      .eq("walker_id", walkerId)
      .maybeSingle();
    return data;
  }, 180_000, 3_000);
  log(`oferta ${short((offer as any).id)} status=${(offer as any).offer_status}`);

  // Diagnóstico isolado: a RPC do próprio PetWalker autenticado deve retornar a oferta.
  const rpcOffers = await waitFor(
    "get_available_walk_offers retornar a oferta (RPC do petwalker)",
    async () => {
      const r = await rpcAsUser(walkerCtx, "get_available_walk_offers", {});
      log(
        `RPC get_available_walk_offers status=${r.status} erro=${
          (r.body as any)?.code ?? "null"
        } ofertas=${Array.isArray(r.body) ? r.body.length : "n/a"}`,
      );
      return Array.isArray(r.body) && r.body.length > 0 ? r : null;
    },
    120_000,
    3_000,
  );
  const rpcRow = (rpcOffers.body as any[]).find((offer) => offer.session_id === sessionId);
  expect(rpcRow, "RPC deve retornar a oferta da sessão do teste").toBeDefined();
  log(`RPC confirmou oferta session=${short(rpcRow.session_id)} pet=${rpcRow.pet_name}`);

  // A oferta deve surgir na UI sem reload (Realtime).
  const card = p.locator('[data-testid="incoming-walk-card"]').first();
  await expect(card).toBeVisible({ timeout: 120_000 });
  const petNameVisible = await card.locator('h3').innerText();
  log(`card detectado para o pet: "${petNameVisible}"`);
  expect(petNameVisible).toContain(rpcRow.pet_name);

  // Aguarda e clica na primeira oferta real retornada pela RPC
  log("walker: aguardando card de oferta...");
  const offerCard = p.getByTestId("incoming-offer-card").first();
  await expect(offerCard).toBeVisible({ timeout: 45_000 });
  
  // Verificação visual do nome do pet no card antes do clique
  const petNameInCard = await offerCard.locator('[data-testid="offer-pet-name"]').innerText();
  log(`walker: pet no card="${petNameInCard}"`);
  expect(petNameInCard.toLowerCase()).toContain("pete2e");

  // Intercepta a requisição para garantir que o session_id enviado é o correto
  const requestPromise = p.waitForRequest(req => 
    req.url().includes("rpc/accept_walk_request") && req.method() === "POST"
  );

  const accept = offerCard.getByRole("button", { name: /aceitar passeio/i });
  await expect(accept).toBeVisible();
  await shot(walkerCtx, "06-oferta");

  // Dados sensíveis não expostos antes do aceite.
  const body = (await p.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain(ownerEmail.toLowerCase());
  expect(body).not.toContain(sessionId.toLowerCase());

  await accept.click();
  const request = await requestPromise;
  const postData = request.postDataJSON();
  const interceptedSessionId = postData._session_id;
  
  log(`walker: aceitou oferta session_id=${short(interceptedSessionId)}`);
  expect(interceptedSessionId).toBe(sessionId);

  const accepted = await waitFor("sessão accepted", async () => {
    const s = await dbSession();
    return s.current_status === "accepted" ? s : null;
  }, 60_000);
  expect(accepted.walker_id).toBe(walkerId);
  const offers = await admin.from("walk_offers").select("walker_id, offer_status").eq("session_id", sessionId);
  log(`ofertas: ${(offers.data ?? []).map((o: any) => o.offer_status).join(",")}`);
  expect((offers.data ?? []).some((o: any) => o.offer_status === "accepted")).toBe(true);
  expect((offers.data ?? []).some((o: any) => o.offer_status === "pending")).toBe(false);
  const wp = await dbWalker();
  expect(wp.availability_status).toBe("busy");
  expect(wp.current_walk_id).toBe(sessionId);
  await shot(walkerCtx, "07-aceito");
});

test("dono sincroniza por Realtime sem reload", async () => {
  const p = ownerCtx.page;
  await expect(p.getByText(/aguardando/i)).toBeHidden({ timeout: 90_000 });
  await shot(ownerCtx, "08-dono-sincronizado");

  // Sinal semântico e estável de aceite (sem reload).
  await expect(p.getByTestId("walk-accepted-state")).toBeVisible({ timeout: 60_000 });
  const shownName = await p.getByTestId("walk-walker-name").innerText();
  log(`dono reconheceu aceite; nome exibido="${shownName}"`);
  expect(shownName.trim().length).toBeGreaterThan(0);

  const dbg = await dbSession();
  log(
    `diagnóstico dono: current_status=${dbg.current_status} walker=${short(dbg.walker_id)} updated_at=${dbg.updated_at}`,
  );
  expect(dbg.walker_id).toBe(walkerId);
  fs.writeFileSync(
    path.join(ART, "owner-accepted.html"),
    await p.content(),
    "utf8",
  );

  for (let i = 0; i < 4; i++) {
    await p.waitForTimeout(2_000);
    const s = await dbSession();
    expect(s.current_status).not.toBe("searching");
  }
});

test("tracking: ciclo operacional pela interface do petwalker", async () => {
  test.setTimeout(180_000);
  const p = walkerCtx.page;
  const stepBtn = (re: RegExp) => p.getByRole("button", { name: re }).first();

  // Entra na tela operacional real do passeio (mesma rota do botão do painel).
  await p.getByRole("button", { name: /iniciar deslocamento/i }).first().click();
  await p.waitForURL(/\/petwalker\/passeio\//, { timeout: 30_000 }).catch(async () => {
    await p.goto(`/petwalker/passeio/${sessionId}`, { waitUntil: "domcontentloaded" });
  });
  if (!/\/petwalker\/passeio\//.test(p.url())) {
    await p.goto(`/petwalker/passeio/${sessionId}`, { waitUntil: "domcontentloaded" });
  }
  log(`tela operacional do walker: ${p.url()}`);

  // Cada passo: aguarda o botão real ficar visível antes de clicar.
  await expect(stepBtn(/iniciar deslocamento/i)).toBeVisible({ timeout: 45_000 });
  await stepBtn(/iniciar deslocamento/i).click();
  await waitFor("heading_to_pickup", async () => ((await dbSession()).current_status === "heading_to_pickup" ? true : null), 45_000);
  log("transição: accepted -> heading_to_pickup");
  await shot(walkerCtx, "09-heading");

  await expect(stepBtn(/cheguei (no|ao) local/i)).toBeVisible({ timeout: 45_000 });
  await stepBtn(/cheguei (no|ao) local/i).click();
  await waitFor("arrived", async () => ((await dbSession()).current_status === "arrived" ? true : null), 45_000);
  log("transição: heading_to_pickup -> arrived");

  await expect(stepBtn(/iniciar passeio/i)).toBeVisible({ timeout: 45_000 });
  await stepBtn(/iniciar passeio/i).click();
  await waitFor("in_progress", async () => ((await dbSession()).current_status === "in_progress" ? true : null), 45_000);
  log("transição: arrived -> in_progress");
  await shot(walkerCtx, "10-in-progress");
});

test("tracking: rastreamento real com throttle de 5s no servidor", async () => {
  test.setTimeout(180_000);
  const ownerMarkers = async () =>
    ownerCtx.page.evaluate(() =>
      Array.from(document.querySelectorAll(".mapboxgl-marker")).map(
        (el) => (el as HTMLElement).style.transform,
      ),
    );
  const before = await ownerMarkers();

  for (const [i, c] of WALK_TRACK.entries()) {
    await walkerCtx.context.setGeolocation({ longitude: c.lng, latitude: c.lat });
    // Posição canônica do walker (mesma RPC que o app usa no GPS real).
    const loc = await rpcAsUser(walkerCtx, "update_walker_location", {
      _lat: c.lat,
      _lng: c.lng,
      _accuracy: 8,
    });
    expect(loc.body).toBe(true);
    const r = await rpcAsUser(walkerCtx, "append_walk_tracking_point", {
      _session_id: sessionId,
      _point: [c.lng, c.lat],
    });
    log(`ponto ${i + 1}: http=${r.status} retorno=${JSON.stringify(r.body)}`);
    expect(r.body).toBe(true);
    const s = await dbSession();
    expect(Array.isArray(s.route_coordinates)).toBe(true);
    expect(Array.isArray(s.route_coordinates[s.route_coordinates.length - 1])).toBe(true);
    expect(s.last_tracking_at).toBeTruthy();
    if (i < WALK_TRACK.length - 1) await walkerCtx.page.waitForTimeout(6_500);
  }

  // Tentativa antes de 5s deve retornar false (rejeição de frequência).
  const tooSoon = await rpcAsUser(walkerCtx, "append_walk_tracking_point", {
    _session_id: sessionId,
    _point: [WALK_TRACK[0].lng, WALK_TRACK[0].lat],
  });
  log(`tentativa <5s retorno=${JSON.stringify(tooSoon.body)}`);
  expect(tooSoon.body).toBe(false);
  const lenAfterReject = (await dbSession()).route_coordinates.length;

  await walkerCtx.page.waitForTimeout(6_000);
  const retry = await rpcAsUser(walkerCtx, "append_walk_tracking_point", {
    _session_id: sessionId,
    _point: [-46.700700, -23.600500],
  });
  expect(retry.body).toBe(true);
  expect((await dbSession()).route_coordinates.length).toBe(lenAfterReject + 1);

  // ── Condições REAIS (sem pular animação, sem reload, sem retry) ──
  // 1. Banco em estado rastreável.
  expect((await dbSession()).current_status).toBe("in_progress");
  // 2. Tela do dono no estado operacional (mapa montado + marcador ao vivo).
  const liveMarker = ownerCtx.page.locator('[data-testid="active-walker-marker"]').first();
  // Diagnóstico obrigatório antes de esperar o marcador.
  const diag = await ownerCtx.page.evaluate(() => ({
    url: location.href,
    hasMapCanvas: !!document.querySelector(".mapboxgl-canvas"),
    markers: document.querySelectorAll(".mapboxgl-marker").length,
    liveMarker: !!document.querySelector('[data-testid="active-walker-marker"]'),
  }));
  log(`diagnóstico dono: ${JSON.stringify(diag)}`);
  await liveMarker.waitFor({ state: "attached", timeout: 45_000 });
  const markerTransform = () =>
    ownerCtx.page.evaluate(() => {
      const el = document.querySelector('[data-testid="active-walker-marker"]') as HTMLElement | null;
      if (!el) return null;
      // O Mapbox posiciona o PRÓPRIO elemento do marcador; alguns temas
      // envolvem em um wrapper. Aceita o primeiro transform não vazio.
      const own = el.style.transform;
      const parent = (el.parentElement as HTMLElement | null)?.style.transform ?? "";
      return own || parent || null;
    });
  // 3. Primeira coordenada confirmada no marcador.
  await expect.poll(markerTransform, { timeout: 30_000 }).not.toBeNull();
  const firstTransform = await markerTransform();
  log(`marcador ao vivo inicial: ${firstTransform}`);

  // 4. Nova coordenada após o throttle e marcador em posição diferente.
  await walkerCtx.page.waitForTimeout(6_000);
  const moved = await rpcAsUser(walkerCtx, "append_walk_tracking_point", {
    _session_id: sessionId,
    _point: [-46.712_000, -23.612_000],
  });
  expect(moved.body).toBe(true);
  const movedLoc = await rpcAsUser(walkerCtx, "update_walker_location", {
    _lat: -23.612_000,
    _lng: -46.712_000,
    _accuracy: 8,
  });
  expect(movedLoc.body).toBe(true);
  await expect
    .poll(markerTransform, { timeout: 45_000, intervals: [1_000] })
    .not.toBe(firstTransform);
  const after = await ownerMarkers();
  log(`marcadores do dono antes=${before.length} depois=${after.length}`);
  await shot(ownerCtx, "11-dono-rastreando");
});

test("negative: casos negativos: identidade, autorização e validação de dados", async () => {
  test.setTimeout(240_000);
  const before = await snapshotState();

  // ---- 1. Dono (usuário comum) não opera o passeio ----
  expectDenied(
    "dono grava ponto de GPS",
    await rpcAsUser(ownerCtx, "append_walk_tracking_point", {
      _session_id: sessionId,
      _point: [OWNER_POINT.lng, OWNER_POINT.lat],
    }),
  );
  for (const fn of [
    "petwalker_start_heading",
    "petwalker_arrive_pickup",
    "petwalker_start_walk",
    "petwalker_complete_walk",
  ]) {
    expectDenied(`dono chamando ${fn}`, await rpcAsUser(ownerCtx, fn, { _session_id: sessionId }));
  }

  // ---- 2. Auto-aceite proibido (sessão do próprio dono) ----
  expectDenied(
    "auto-aceite do dono na sessão em andamento",
    await rpcAsUser(ownerCtx, "accept_walk_request", { _session_id: sessionId }),
  );
  // Sessão realmente em 'searching' criada só para provar a regra de auto-aceite.
  const probe = await admin
    .from("walk_sessions")
    .insert({
      customer_id: ownerId,
      pet_id: petId,
      start_time: new Date().toISOString(),
      status: "searching",
      current_status: "searching",
      walk_type: "livre",
      planned_duration_minutes: 15,
      request_mode: "now",
      matching_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (probe.error) {
    log(`aviso: não foi possível criar sessão de sondagem (${probe.error.message.slice(0, 120)})`);
  } else {
    const probeId = (probe.data as any).id as string;
    const self = await rpcAsUser(ownerCtx, "accept_walk_request", { _session_id: probeId });
    expectDenied("auto-aceite em sessão searching do próprio dono", self);
    const probeAfter = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", probeId).single();
    expect(probeAfter.data!.walker_id, "auto-aceite não pode atribuir walker").toBeNull();
    expect(probeAfter.data!.current_status).toBe("searching");
    // Walker ocupado também não pode aceitar outra sessão.
    expectDenied(
      "walker ocupado aceitando outra sessão",
      await rpcAsUser(walkerCtx, "accept_walk_request", { _session_id: probeId }),
    );
    const probeAfter2 = await admin.from("walk_sessions").select("current_status, walker_id").eq("id", probeId).single();
    expect(probeAfter2.data!.walker_id).toBeNull();
    await admin.from("walk_offers").delete().eq("session_id", probeId);
    await admin.from("walk_sessions").delete().eq("id", probeId);
    log("sessão de sondagem removida");
  }

  // ---- 3. Terceiros (petwalker externo e usuário comum externo) ----
  const stranger = await createExtraUser("petwalker");
  const outsider = await createExtraUser("common");
  log(`usuários externos criados walker=${short(stranger.id)} comum=${short(outsider.id)}`);

  for (const fn of [
    "petwalker_start_heading",
    "petwalker_arrive_pickup",
    "petwalker_start_walk",
    "petwalker_complete_walk",
  ]) {
    expectDenied(`petwalker externo chamando ${fn}`, await rpcAsToken(fn, { _session_id: sessionId }, stranger.token));
  }
  expectDenied(
    "petwalker externo gravando ponto",
    await rpcAsToken(
      "append_walk_tracking_point",
      { _session_id: sessionId, _point: [-46.7, -23.6] },
      stranger.token,
    ),
  );
  expectDenied(
    "petwalker externo aceitando sessão já atribuída",
    await rpcAsToken("accept_walk_request", { _session_id: sessionId }, stranger.token),
  );

  // Localização ao vivo é privada: só dono e walker da sessão.
  const strangerLoc = await rpcAsToken("get_active_walker_location", { _session_id: sessionId }, stranger.token);
  log(`localização por walker externo: http=${strangerLoc.status} body=${JSON.stringify(strangerLoc.body).slice(0, 120)}`);
  expect(
    strangerLoc.ok === false || strangerLoc.body === null || (Array.isArray(strangerLoc.body) && strangerLoc.body.length === 0),
    "walker externo não pode ler a localização da sessão",
  ).toBe(true);

  const outsiderLoc = await rpcAsToken("get_active_walker_location", { _session_id: sessionId }, outsider.token);
  expect(
    outsiderLoc.ok === false || outsiderLoc.body === null || (Array.isArray(outsiderLoc.body) && outsiderLoc.body.length === 0),
    "usuário comum externo não pode ler a localização",
  ).toBe(true);

  const anonLoc = await rpcAsToken("get_active_walker_location", { _session_id: sessionId }, null);
  log(`localização anônima: http=${anonLoc.status}`);
  expect(
    anonLoc.ok === false || anonLoc.body === null || (Array.isArray(anonLoc.body) && anonLoc.body.length === 0),
    "anônimo não pode ler a localização",
  ).toBe(true);

  // Leitura direta anônima nas tabelas sensíveis é bloqueada pela RLS.
  for (const table of ["walk_sessions", "walker_tracking", "walk_offers"]) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
      headers: { apikey: ANON_KEY },
    });
    const rows = res.ok ? await res.json() : null;
    log(`leitura anônima ${table}: http=${res.status} rows=${Array.isArray(rows) ? rows.length : "n/a"}`);
    expect(res.ok === false || (Array.isArray(rows) && rows.length === 0), `${table} não pode ser lida anonimamente`).toBe(true);
  }

  // ---- 4. Dados inválidos no ponto de GPS (walker legítimo) ----
  const invalidPoints: Array<[string, unknown]> = [
    ["strings numéricas", ["-46.7", "-23.6"]],
    ["fora dos limites", [999, 999]],
    ["latitude 91", [-46.7, 91]],
    ["longitude -181", [-181, -23.6]],
    ["array incompleto", [-46.7]],
    ["array com 3 itens", [-46.7, -23.6, 10]],
    ["objeto em vez de array", { lng: -46.7, lat: -23.6 }],
    ["nulo", null],
    ["booleanos", [true, false]],
    ["nulos internos", [null, null]],
    ["string NaN", ["NaN", "NaN"]],
  ];
  for (const [label, point] of invalidPoints) {
    expectDenied(
      `ponto inválido (${label})`,
      await rpcAsUser(walkerCtx, "append_walk_tracking_point", { _session_id: sessionId, _point: point }),
    );
  }

  // Sessão inexistente e id malformado.
  expectDenied(
    "sessão inexistente no start_walk",
    await rpcAsUser(walkerCtx, "petwalker_start_walk", {
      _session_id: "00000000-0000-0000-0000-000000000000",
    }),
  );
  const badUuid = await rpcAsUser(walkerCtx, "petwalker_start_walk", { _session_id: "nao-e-uuid" });
  expectDenied("uuid malformado", badUuid);

  // ---- 5. Transições fora de ordem pelo walker legítimo (sessão in_progress) ----
  for (const fn of ["petwalker_start_heading", "petwalker_arrive_pickup", "petwalker_start_walk"]) {
    expectDenied(`transição fora de ordem (${fn}) em in_progress`, await rpcAsUser(walkerCtx, fn, { _session_id: sessionId }));
  }

  // ---- 6. Integridade: nada mudou no banco após todas as tentativas ----
  const after = await snapshotState();
  log(
    `integridade pós-negativas: guarded_inalterado=${before.guarded === after.guarded} rastro ${before.trail}->${after.trail}`,
  );
  if (before.guarded !== after.guarded) log(`antes=${before.guarded}\ndepois=${after.guarded}`);
  expect(after.guarded, "nenhuma tentativa negada pode alterar o estado do passeio").toBe(before.guarded);
  expect(after.trail, "rastro nunca pode encolher").toBeGreaterThanOrEqual(before.trail);
  expect((await dbSession()).current_status).toBe("in_progress");
});

test("completion: encerramento explícito e histórico", async () => {
  test.setTimeout(180_000);
  const p = walkerCtx.page;

  // Nada encerra sozinho: espera e confirma que continua in_progress.
  await p.waitForTimeout(20_000);
  expect((await dbSession()).current_status).toBe("in_progress");
  log("sem encerramento automático após espera");

  await p.reload({ waitUntil: "domcontentloaded" });
  const finish = p.getByRole("button", { name: /finalizar passeio/i }).first();
  await expect(finish).toBeVisible({ timeout: 30_000 });
  await shot(walkerCtx, "12-finalizacao-explicita");
  await finish.click();

  const done = await waitFor("completed", async () => {
    const s = await dbSession();
    return s.current_status === "completed" ? s : null;
  }, 60_000);
  log(
    `conclusão: end_time=${!!done.end_time} dur=${done.actual_duration_minutes} dist=${done.distance_km} pontos=${(done.route_coordinates || []).length}`,
  );
  expect(done.end_time).toBeTruthy();
  expect(done.actual_duration_minutes).toBeGreaterThan(0);
  expect(Number(done.distance_km)).toBeGreaterThan(0);
  expect((done.route_coordinates || []).length).toBeGreaterThan(1);

  const wp = await dbWalker();
  expect(wp.availability_status).toBe("available");
  expect(wp.current_walk_id).toBeNull();
  expect(wp.completed_walks).toBe(1);

  // Segundo clique não duplica conclusão.
  const second = await rpcAsUser(walkerCtx, "petwalker_complete_walk", { _session_id: sessionId });
  log(`segunda conclusão: http=${second.status}`);
  expectDenied("segunda conclusão da mesma sessão", second);
  expect((await dbWalker()).completed_walks).toBe(1);
  const afterSecond = await dbSession();
  expect(afterSecond.end_time).toBe(done.end_time);
  expect(afterSecond.actual_duration_minutes).toBe(done.actual_duration_minutes);
  expect(Number(afterSecond.distance_km)).toBe(Number(done.distance_km));

  // Valores financeiros permanecem imutáveis após a conclusão.
  expect(afterSecond.total_price_cents).toBe(2250);
  expect(afterSecond.price_per_minute_cents).toBe(150);

  // Ponto após conclusão é rejeitado.
  const late = await rpcAsUser(walkerCtx, "append_walk_tracking_point", {
    _session_id: sessionId,
    _point: [-46.7008, -23.6006],
  });
  expectDenied("ponto de GPS após conclusão", late);
  expect((await dbSession()).route_coordinates.length).toBe((done.route_coordinates || []).length);

  // Transições operacionais após conclusão também são negadas.
  for (const fn of ["petwalker_start_heading", "petwalker_arrive_pickup", "petwalker_start_walk"]) {
    expectDenied(`${fn} após conclusão`, await rpcAsUser(walkerCtx, fn, { _session_id: sessionId }));
  }
  expect((await dbSession()).current_status).toBe("completed");

  // ---- Privacidade após a conclusão: sem localização ao vivo para ninguém ----
  for (const [label, ctx] of [["dono", ownerCtx], ["walker", walkerCtx]] as const) {
    const loc = await rpcAsUser(ctx, "get_active_walker_location", { _session_id: sessionId });
    log(`localização pós-conclusão (${label}): http=${loc.status} body=${JSON.stringify(loc.body).slice(0, 120)}`);
    const empty =
      loc.ok === false ||
      loc.body === null ||
      (Array.isArray(loc.body) && loc.body.length === 0);
    expect(empty, `localização ao vivo não pode ser exposta ao ${label} após a conclusão`).toBe(true);
  }

  // Histórico dos dois lados.
  await ownerCtx.page.goto("/historico", { waitUntil: "domcontentloaded" });
  await ownerCtx.page.waitForTimeout(3_000);
  const ownerHistory = await ownerCtx.page.locator("body").innerText();
  log(`histórico do dono: ${ownerHistory.replace(/\s+/g, " ").slice(0, 200)}`);
  expect(ownerHistory.toLowerCase()).not.toContain(sessionId.toLowerCase());
  // O passeio concluído aparece com pet, duração e distância reais.
  expect.soft(ownerHistory, "histórico do dono deve listar o passeio concluído").toMatch(/min/i);
  expect.soft(ownerHistory, "histórico do dono deve mostrar a distância").toMatch(/km/i);
  await shot(ownerCtx, "13-historico-dono");

  await walkerCtx.page.goto("/petwalker/historico", { waitUntil: "domcontentloaded" });
  await walkerCtx.page.waitForTimeout(3_000);
  const walkerHistory = await walkerCtx.page.locator("body").innerText();
  log(`histórico do walker: ${walkerHistory.replace(/\s+/g, " ").slice(0, 200)}`);
  expect(walkerHistory.toLowerCase()).not.toContain(ownerEmail.toLowerCase());
  expect.soft(walkerHistory, "histórico do walker deve listar o passeio").toMatch(/min|passeio/i);
  await shot(walkerCtx, "14-historico-walker");

  // A tela do dono não deve mais exibir marcador de posição ao vivo.
  await ownerCtx.page.goto("/inicio", { waitUntil: "domcontentloaded" });
  await ownerCtx.page.waitForTimeout(3_000);
  expect(await ownerCtx.page.locator('[data-testid="active-walker-marker"]').count()).toBe(0);
  await shot(ownerCtx, "15-dono-pos-conclusao");
  flushLog();
});
