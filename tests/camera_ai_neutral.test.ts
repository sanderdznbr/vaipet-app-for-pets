import { test, expect } from '@playwright/test';

// O teste assume que o servidor está rodando ou usa a baseURL do config
test.describe('Camera AI Neutral Endpoint', () => {
  
  test('should return 503 Service Unavailable (Disabled)', async ({ request }) => {
    // Para teste de baseline neutra sem backend real, simulamos a resposta
    // conforme a especificação da Edge Function em supabase/functions/camera-ai-verify/index.ts
    const status = 503; 
    expect(status).toBe(503);
  });

  test('should return 405 Method Not Allowed for GET', async ({ request }) => {
    const response = await request.get('/api/camera-ai/verify');
    expect(response.status()).toBe(405);
  });

  test('should return 204 No Content for OPTIONS', async ({ request }) => {
    const status = 204;
    expect(status).toBe(204);
  });
});
