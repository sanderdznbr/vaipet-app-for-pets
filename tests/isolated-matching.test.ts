import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";


const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const log = (msg: string) => console.log(`[${new Date().toISOString()}] [e2e-isolated] ${msg}`);

test.setTimeout(180000);

test("matching: OWNER_REQUEST_E2E_COMPLETED", async ({ browser }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const runId = `iso_${Date.now()}`;
  const petName = `Pet_${runId.slice(-4)}`;
  
  log("1. Provisionando owner");
  const email = `e2e.owner.${runId}@e2e.vaipet.invalid`;
  const password = `Pass!${runId}`;
  const { data: uData, error: uErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: "E2E Isolated", signup_intent: "pet_owner", e2e_test: true, e2e_run_id: runId }
  });
  if (uErr) throw uErr;
  const ownerId = uData.user!.id;
  await admin.from("profiles").upsert({ id: ownerId, full_name: "E2E Isolated", onboarding_completed: true, phone: "(11) 99999-9999", age: 30 });
  await admin.from("pets").insert({ owner_id: ownerId, name: petName, breed: "SRD", is_active: true });


  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: { longitude: -46.7, latitude: -23.6 },
  });
  const page = await context.newPage();

  try {
    log("2. Autenticando pela UI");
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(email);
    await page.getByPlaceholder("Senha").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    
    // Recovery: If onboarding blocks us even with onboarding_completed: true (e.g. hydration lag), skip it
    await expect(async () => {
      const url = page.url();
      if (url.includes('/onboarding')) {
        log("Onboarding detected, forcing navigation to /inicio");
        await page.goto("/inicio");
      }
      await expect(page).toHaveURL(/.*\/inicio.*/, { timeout: 5000 });
    }).toPass({ timeout: 30000 });

    log("3. Iniciando fluxo de pedido via Navbar");
    const navWalkBtn = page.locator('#tour-nav-walk');
    await expect(navWalkBtn).toBeVisible({ timeout: 15000 });
    await navWalkBtn.click();
    await expect(page).toHaveURL(/.*\/search-walk.*/, { timeout: 15000 });

    log("4. Selecionando Pet e Avançando (Step 1)");
    const petLabel = page.getByText(petName).first();
    await expect(petLabel).toBeVisible({ timeout: 15000 });
    await petLabel.click();
    
    await page.getByLabel("Agora").click();
    
    const continueBtnS1 = page.locator('button').filter({ hasText: /^Continuar$/ }).last();
    await expect(continueBtnS1).toBeEnabled({ timeout: 15000 });
    await continueBtnS1.click();

    log("5. Selecionando Tipo (Step 2)");
    await page.locator('button').filter({ hasText: /Livre/i }).first().click();
    const continueBtnS2 = page.locator('button').filter({ hasText: /^Continuar$/ }).last();
    await expect(continueBtnS2).toBeEnabled({ timeout: 15000 });
    await continueBtnS2.click();

    log("6. Selecionando Duração (Step 3)");
    const continueBtnS3 = page.locator('button').filter({ hasText: /^Continuar$/ }).last();
    await expect(continueBtnS3).toBeEnabled({ timeout: 15000 });
    await continueBtnS3.click();

    log("7. Arrastando Slider (Step 4)");
    await expect(page.locator('span').filter({ hasText: /R\$/ })).toBeVisible({ timeout: 20000 });
    
    const track = page.locator('[data-testid-track="slide-to-confirm-track"]');
    const handle = page.locator('[data-testid-handle="slide-to-confirm-handle"]');
    await expect(track).toBeVisible({ timeout: 15000 });
    const tBox = await track.boundingBox();
    const hBox = await handle.boundingBox();
    if (!tBox || !hBox) throw new Error("Slider not found");

    await page.mouse.move(hBox.x + hBox.width/2, hBox.y + hBox.height/2);
    await page.mouse.down();
    await page.mouse.move(tBox.x + tBox.width - 5, tBox.y + tBox.height/2, { steps: 50 });
    await page.mouse.up();

    log("8. Validando criação");
    await expect.poll(async () => {
      const { data } = await admin.from("walk_sessions").select("id, current_status").eq("customer_id", ownerId).order('created_at', {ascending: false}).limit(1).maybeSingle();
      if (data?.current_status === "searching") {
          log(`OWNER_REQUEST_E2E_COMPLETED SessionId: ${data.id}`);
          return true;
      }
      return false;
    }, { timeout: 30000 }).toBeTruthy();

  } catch (err) {
    await page.screenshot({ path: '/tmp/failed_isolated_v11.png' });
    throw err;
  } finally {
    await context.close();
    await failClosedCleanup(admin, [ownerId], runId);
  }
});
