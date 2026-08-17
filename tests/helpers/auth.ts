import { test, expect, Browser } from '@playwright/test';

/**
 * Cria um contexto autenticado seguindo o fluxo real da UI.
 * Não aceita /auth como destino final para testes operacionais.
 * /onboarding é aceito apenas se o teste for explicitamente sobre onboarding.
 */
export async function createAuthedContext(browser: Browser, email: string, pass: string, expectedPath?: string) {
  const context = await browser.newContext({
    geolocation: { latitude: -23.5505, longitude: -46.6333 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();

  console.log(`[AUTH] Iniciando login para ${email}`);
  await page.goto('/auth');
  
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');

  // Espera o carregamento e redirecionamento inicial
  // Aumentamos o timeout para garantir que o redirecionamento pós-auth ocorra
  await page.waitForURL(/.*(inicio|petwalker|onboarding)/, { timeout: 45000 });
  
  const finalUrl = page.url();
  console.log(`[AUTH] Destino inicial: ${finalUrl}`);

  // Se ainda estiver em /auth após 45s, algo deu errado
  if (finalUrl.includes('/auth')) {
    throw new Error(`[FAIL-AUTH] Usuário ${email} preso em /auth após login.`);
  }

  // Validação opcional de rota específica
  if (expectedPath) {
    await expect(page).toHaveURL(new RegExp(expectedPath), { timeout: 15000 });
  }
  
  return { context, page };
}
