import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

test("setup: sessão persiste após reload de rota protegida", async ({ browser }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  
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
    await page.goto("/auth");
    await page.getByPlaceholder("E-mail").fill(email);
    await page.getByPlaceholder("Senha").fill(password);
    await page.getByRole("button", { name: /^Entrar$/i }).click();

    await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 30000 });
    
    console.log("[e2e] Autenticado. Executando reload...");
    await page.reload({ waitUntil: "domcontentloaded" });
    
    console.log(`[e2e] URL após reload: ${page.url()}`);
    
    // VERIFICAÇÃO CRÍTICA: Se a URL for /auth, a persistência falhou (reprodução do bug)
    if (page.url().includes("/auth")) {
        console.log("[e2e] REPRODUZIDO: Redirecionado para /auth após reload.");
        // Falhamos o teste para confirmar a reprodução
        expect(page.url()).not.toContain("/auth");
    }

    await expect(page).toHaveURL(/.*\/inicio.*/, { timeout: 10000 });
    console.log("[e2e] Persistência confirmada (Bug não reproduzido ou intermitente).");
  } finally {
    await context.close();
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});
