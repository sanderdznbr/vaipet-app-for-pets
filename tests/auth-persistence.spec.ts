import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

test("setup: sessão persiste após reload de rota protegida", async ({ browser }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  
  // 1. Provisionar Pet Owner
  const runId = `persist_${Date.now()}`;
  const email = `e2e.owner.${runId}@e2e.vaipet.invalid`;
  const password = "Password123!";
  const { data: userData, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: "E2E Persist", signup_intent: "pet_owner", e2e_test: true }
  });
  if (createError) throw createError;
  const userId = userData.user!.id;
  await admin.from("profiles").upsert({ id: userId, full_name: "E2E Persist", onboarding_completed: true });

  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();

  try {
    // 2. Autenticar pela interface /auth
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(email);
    await page.getByPlaceholder("Senha").fill(password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();

    // 3. Confirmar user.id e sessão válida
    await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 30000 });
    
    const storage = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(storage).toBeTruthy();
    const session = JSON.parse(storage!);
    expect(session.user.id).toBe(userId);
    console.log(`[e2e] Usuário autenticado: ${userId}`);

    // 4. Acessar /inicio (já deve estar lá ou redirecionar)
    if (!page.url().includes("/inicio")) {
      await page.goto("/inicio");
    }
    await expect(page).toHaveURL(/.*\/inicio.*/);

    // 5. Executar page.reload
    console.log("[e2e] Executando reload...");
    await page.reload({ waitUntil: "domcontentloaded" });

    // 6. Confirmar persistência
    console.log(`[e2e] URL após reload: ${page.url()}`);
    await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 10000 });
    await expect(page).toHaveURL(/.*\/inicio.*/);
    
    const storageAfter = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(storageAfter).toBeTruthy();
    
    // Verificar elemento autenticado (ex: botão de perfil ou texto de boas vindas)
    const welcome = page.locator("text=Olá");
    await expect(welcome).toBeVisible({ timeout: 10000 });
    
    console.log("[e2e] Persistência confirmada.");
  } finally {
    await context.close();
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});
