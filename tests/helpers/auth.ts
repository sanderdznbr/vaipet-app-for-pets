import { expect, type Browser, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

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
