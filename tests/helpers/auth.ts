import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Creates an authenticated context for E2E tests by performing real UI login.
 */
export async function createAuthedContext(browser: any, email: string, pass: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1800 }
  });
  const page = await context.newPage();

  console.log(`[AUTH] Logging in as ${email}...`);
  await page.goto('http://localhost:8080/auth');
  
  // Wait for auth form
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');

  // Wait for redirect to /inicio or /petwalker
  await expect(page).toHaveURL(/.*(inicio|petwalker)/, { timeout: 20000 });
  console.log(`[AUTH] Login successful for ${email}`);
  
  return { context, page };
}
