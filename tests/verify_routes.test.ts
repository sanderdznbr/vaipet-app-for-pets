import { test, expect } from '@playwright/test';

const DEPLOY_URL = process.env.DEPLOY_URL || 'https://tieck.com.br';

const routes = [
  '/',
  '/login',
  '/cadastro',
  '/inicio'
];

test.describe('Route Verification', () => {
  for (const route of routes) {
    test(`Verify route ${route}`, async ({ page }) => {
      const url = `${DEPLOY_URL}${route}`;
      console.log(`Testando: ${url}`);
      
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      const status = response?.status();
      
      expect(status).not.toBe(404);
      if (status) {
        expect(status).toBeLessThan(500);
      }

      // Se redirecionar de /inicio para /login, está correto
      if (route === '/inicio' && page.url().includes('/login')) {
        console.log(`Rota ${route} redirecionada para login.`);
      }
    });
  }
});
