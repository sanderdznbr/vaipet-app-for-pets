import { test, expect, type SupabaseClient } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

/**
 * E2E PHASE 4.1 — DESLOCAMENTO E RETIRADA SEGURA
 * Fluxo: accepted -> heading_to_pickup -> arrived -> pin_validation -> in_progress
 */

test.setTimeout(300000);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const log = (msg: string) => console.log(`[${new Date().toISOString()}] [e2e-4.1] ${msg}`);

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

async function provisionUser(runId: string, kind: "pet_owner" | "petwalker") {
  const email = `e2e.4.1.${kind}.${runId}.${Math.random().toString(36).slice(2, 6)}@e2e.vaipet.invalid`;
  const password = `Pass!${Math.random().toString(36).slice(2, 10)}`;
  
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `E2E 4.1 ${kind}`, signup_intent: kind, e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw error;
  const id = data.user!.id;
  
  await admin.from("profiles").upsert({ id, full_name: `E2E 4.1 ${kind}`, onboarding_completed: true, phone: "(11) 96666-6666", age: 32 });
  
  if (kind === "petwalker") {
    await admin.from("user_roles").insert({ user_id: id, role: "petwalker" });
    await admin.from("petwalker_profiles").upsert({
      user_id: id, approval_status: "approved", profile_completed: true, availability_status: "available",
      is_accepting_requests: true, price_30_minutes: 2250, experience_years: 2, service_radius_km: 10,
      last_known_location: `SRID=4326;POINT(-46.7009 -23.6004)`
    });
  } else {
    // Need a pet for the owner
    await admin.from("pets").insert({
      owner_id: id,
      name: "Rex E2E",
      type: "dog",
      breed: "Labrador",
      weight_kg: 25,
      e2e_test: true
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
  return { context, page };
}

test("Phase 4.1: displacement and secure PIN pickup flow", async ({ browser }) => {
  const runId = Math.random().toString(36).slice(2, 10);
  log(`Iniciando teste runId=${runId}`);

  const [owner, walker] = await Promise.all([
    provisionUser(runId, "pet_owner"),
    provisionUser(runId, "petwalker"),
  ]);

  const ownerCoords = { lng: -46.7011, lat: -23.6001 };
  const walkerCoords = { lng: -46.7009, lat: -23.6004 }; 

  const { page: ownerPage } = await createAuthedContext(browser, owner, ownerCoords);
  const { page: walkerPage } = await createAuthedContext(browser, walker, walkerCoords);

  try {
    // 1. Owner requests walk
    log("1. Cliente solicitando passeio");
    await ownerPage.goto("/inicio");
    await ownerPage.waitForLoadState('networkidle');
    
    // Check if pet selection card is already there
    const petCard = ownerPage.getByTestId("pet-selection-card").first();
    const walkBtn = ownerPage.getByRole("button", { name: 'Passeio', exact: true });
    
    if (await walkBtn.isVisible()) {
      await walkBtn.click();
      await ownerPage.waitForTimeout(1000); // Aguarda animação do bottom sheet
      const agoraBtn = ownerPage.getByRole("button", { name: /Agora/i });
      await agoraBtn.click({ timeout: 15000 });
    }

    await petCard.click({ timeout: 20000 });
    await ownerPage.click('button:has-text("Confirmar Pet")', { timeout: 10000 });
    await ownerPage.click('button:has-text("30 min")', { timeout: 10000 });
    
    const slider = ownerPage.getByTestId("slider-confirm-handle");
    const track = ownerPage.getByTestId("slider-confirm-track");
    await slider.waitFor({ state: 'visible' });
    const box = await track.boundingBox();
    if (!box) throw new Error("Slider not found");
    await ownerPage.mouse.move(box.x + 20, box.y + box.height / 2);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 15 });
    await ownerPage.mouse.up();
    await expect(ownerPage.getByText(/Procurando/i)).toBeVisible({ timeout: 20000 });

    // 2. Walker accepts
    log("2. PetWalker aceitando");
    await walkerPage.goto("/petwalker/painel");
    await walkerPage.click('button:has-text("Ficar Online")', { timeout: 10000 });
    const acceptBtn = walkerPage.getByTestId("walker-accept-button");
    await expect(acceptBtn).toBeVisible({ timeout: 45000 });
    await acceptBtn.click();
    await expect(walkerPage.getByText(/Passeio confirmado/i)).toBeVisible({ timeout: 20000 });

    // 3. Walker starts heading
    log("3. PetWalker iniciando deslocamento");
    await walkerPage.click('button:has-text("Iniciar deslocamento")', { timeout: 10000 });
    await expect(walkerPage.getByText(/Deslocamento/i)).toBeVisible({ timeout: 20000 });
    
    // Verify DB state
    const { data: session } = await admin.from("walk_sessions").select("id, current_status, heading_started_at").eq("petwalker_id", walker.id).single();
    expect(session.current_status).toBe("heading_to_pickup");
    expect(session.heading_started_at).not.toBeNull();

    // 4. Walker arrives (proximity check)
    log("4. PetWalker chegando (proximity check)");
    await walkerPage.click('button:has-text("Cheguei ao local")', { timeout: 10000 });
    await expect(walkerPage.getByText(/Validar PIN/i)).toBeVisible({ timeout: 20000 });

    // 5. Owner gets PIN
    log("5. Cliente obtendo PIN");
    await ownerPage.goto(`/passeio/${session.id}`);
    await expect(ownerPage.getByText(/Código de Retirada/i)).toBeVisible({ timeout: 20000 });
    const pinElement = ownerPage.getByTestId("pickup-pin-display");
    const pin = await pinElement.innerText();
    expect(pin).toMatch(/^\d{6}$/);

    // 6. Walker validates PIN
    log("6. PetWalker validando PIN");
    await walkerPage.click('button:has-text("Validar PIN")', { timeout: 10000 });
    const inputs = walkerPage.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(pin[i]);
    }
    await walkerPage.click('button:has-text("Confirmar e iniciar passeio")');
    
    // 7. Verification: Walk in progress
    log("7. Verificando início do passeio");
    await expect(walkerPage.getByText(/Ao Vivo/i)).toBeVisible({ timeout: 30000 });
    
    const { data: finalSession } = await admin.from("walk_sessions").select("current_status, pickup_confirmed_at").eq("petwalker_id", walker.id).single();
    expect(finalSession.current_status).toBe("in_progress");
    expect(finalSession.pickup_confirmed_at).not.toBeNull();

  } finally {
    log("Limpando dados E2E");
    await failClosedCleanup(admin, [owner.id, walker.id], runId);
  }
});
