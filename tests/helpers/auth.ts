import { expect, type Browser, type BrowserContext } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function createAuthedContext(browser: Browser, email: string, pass: string, coords?: { lng: number; lat: number }) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ["geolocation"],
    geolocation: coords ? { longitude: coords.lng, latitude: coords.lat } : undefined,
    locale: "pt-BR",
  });
  
  const page = await context.newPage();
  await page.goto("/auth");
  await page.getByPlaceholder("E-mail").fill(email);
  await page.getByPlaceholder("Senha").fill(pass);
  await page.getByRole("button", { name: /^Entrar$/i }).click();
  
  // Aguarda o redirecionamento para fora da tela de login
  await expect(page).not.toHaveURL(/.*\/auth.*/, { timeout: 45000 });
  
  return { context, page };
}
