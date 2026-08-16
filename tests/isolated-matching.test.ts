import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const log = (msg: string) => console.log(`[${new Date().toISOString()}] [e2e-isolated] ${msg}`);

test.setTimeout(180000);

test("matching: cenário curto de pedido isolado", async ({ browser }) => {
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
  await admin.from("profiles").upsert({ id: ownerId, full_name: "E2E Isolated", onboarding_completed: true });
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
    await expect(page).toHaveURL(/.*\/inicio.*/, { timeout: 30000 });

    log("3. Iniciando fluxo de pedido");
    await page.locator('#tour-start-walk').click({ force: true });
    
    log("4. Selecionando Pet");
    // Vamos usar text content direto para achar o botão que envolve o nome.
    const petText = page.getByText(petName, { exact: false });
    await expect(petText).toBeVisible({ timeout: 15000 });
    
    // O container clicável
    const petContainer = page.locator('button').filter({ has: petText }).first();
    
    log("4.1 Clicando via clique real e retry");
    await expect.poll(async () => {
        await petContainer.click({ force: true });
        const continueBtn = page.locator('button').filter({ hasText: /Continuar/i }).last();
        const text = await continueBtn.innerText();
        return !text.includes('Selecione');
    }, { timeout: 30000, message: "Seleção do pet ativada" }).toBeTruthy();
    
    await page.locator('button').filter({ hasText: /Continuar/i }).last().click({ force: true });

    log("5. Selecionando Tipo");
    const typeBtn = page.locator('button').filter({ hasText: /Livre/i }).first();
    await typeBtn.click({ force: true });
    await page.locator('button').filter({ hasText: /Continuar/i }).last().click({ force: true });

    log("6. Selecionando Duração");
    await page.locator('button').filter({ hasText: /Continuar/i }).last().click({ force: true });

    log("7. Arrastando Slider");
    // O SlideToConfirm deve estar visível e ter o quote carregado.
    const track = page.locator('[data-testid-track="slide-to-confirm-track"]');
    const handle = page.locator('[data-testid-handle="slide-to-confirm-handle"]');
    
    // Aguardar o quote (o preço deve aparecer no resumo acima do slider)
    log("7.1 Aguardando quote/preço");
    await expect(page.locator('span').filter({ hasText: /R\$/ })).toBeVisible({ timeout: 15000 });
    
    await expect(track).toBeVisible({ timeout: 15000 });
    const tBox = await track.boundingBox();
    const hBox = await handle.boundingBox();
    if (!tBox || !hBox) throw new Error("Slider not found");

    log("7.2 Realizando arrasto");
    await page.mouse.move(hBox.x + hBox.width/2, hBox.y + hBox.height/2);
    await page.mouse.down();
    // Arrastamos com passos menores e aguardamos o final
    await page.mouse.move(tBox.x + tBox.width - 5, tBox.y + tBox.height/2, { steps: 50 });
    await page.mouse.up();

    log("8. Validando criação");
    let sessId = "";
    await expect.poll(async () => {
      const { data } = await admin.from("walk_sessions").select("id, current_status").eq("customer_id", ownerId).order('created_at', {ascending: false}).limit(1).maybeSingle();
      if (data) {
          sessId = data.id;
          log(`Session encontrada: ${sessId} Status: ${data.current_status}`);
      }
      return data?.current_status === "searching";
    }, { timeout: 30000, message: "Status da sessão deve ser searching" }).toBeTruthy();

    log(`MATCHING_E2E_COMPLETED SessionId: ${sessId}`);
  } catch (err) {
    await page.screenshot({ path: '/tmp/failed_isolated_v5.png' });
    throw err;
  } finally {
    await context.close();
    await admin.from("walk_sessions").delete().eq("customer_id", ownerId);
    await admin.from("pets").delete().eq("owner_id", ownerId);
    await admin.from("profiles").delete().eq("id", ownerId);
    await admin.auth.admin.deleteUser(ownerId);
    log("Cleanup zero finalizado");
  }
});
