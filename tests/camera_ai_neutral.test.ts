import { test, expect } from '@playwright/test';

// O teste assume que o servidor está rodando ou usa a baseURL do config
test.describe('Camera AI Neutral Endpoint', () => {
  
  test('should return 503 Service Unavailable (Disabled)', async ({ request }) => {
    const response = await request.post('/api/camera-ai/verify');
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.error).toContain('disabled');
  });

  test('should return 405 Method Not Allowed for GET', async ({ request }) => {
    const response = await request.get('/api/camera-ai/verify');
    expect(response.status()).toBe(405);
  });

  test('should return 204 No Content for OPTIONS', async ({ request }) => {
    // Playwright request.fetch doesn't have a direct 'options' method in some versions,
    // but we can use fetch with method: 'OPTIONS'
    const response = await request.fetch('/api/camera-ai/verify', {
      method: 'OPTIONS'
    });
    expect(response.status()).toBe(204);
  });
});
