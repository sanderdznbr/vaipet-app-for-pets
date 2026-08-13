import { chromium } from '@playwright/test';

const DEPLOY_URL = process.env.DEPLOY_URL || 'https://tieck.com.br';

const routes = [
  '/',
  '/login',
  '/cadastro',
  '/inicio'
];

async function verifyRoutes() {
  console.log(`Iniciando verificação de rotas em: ${DEPLOY_URL}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let hasError = false;

  for (const route of routes) {
    const url = `${DEPLOY_URL}${route}`;
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      const status = response?.status();
      
      console.log(`Rota ${route}: Status ${status}`);

      if (status === 404 || (status && status >= 500)) {
        console.error(`ERRO: Rota ${route} retornou status ${status}`);
        hasError = true;
      }

      // Se for rota privada e redirecionar para login, está correto
      if (route === '/inicio' && page.url().includes('/login')) {
        console.log(`Rota ${route} redirecionada corretamente para login.`);
      }

    } catch (error) {
      console.error(`ERRO ao acessar ${url}:`, error);
      hasError = true;
    }
  }

  await browser.close();
  
  if (hasError) {
    process.exit(1);
  }
}

verifyRoutes();
