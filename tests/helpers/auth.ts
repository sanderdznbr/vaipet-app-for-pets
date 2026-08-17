import { test, expect, Browser } from '@playwright/test';

export async function createAuthedContext(browser: Browser, email: string, pass: string) {
  const context = await browser.newContext({
    geolocation: { latitude: -23.5505, longitude: -46.6333 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();

  await page.goto('/auth');
  
  // Login flow
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');

  // Wait for redirect to /inicio, /petwalker OR /onboarding
  await expect(page).toHaveURL(/.*(inicio|petwalker|onboarding)/, { timeout: 20000 });
  console.log(`[AUTH] Login successful for ${email}`);
  
  return { context, page };
}
