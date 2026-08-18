import { test, expect } from '@playwright/test';
import { failClosedCleanup } from './helpers/cleanup';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const E2E_RUN_ID = `4.2-op-${Date.now()}`;
const TEST_OWNER = `owner-42-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-42-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

function parseWalkerLocationResponse(body: any) {
  if (!Array.isArray(body) || body.length < 1) throw new Error('Invalid response format');
  const row = body[0];
  if (typeof row.lat !== 'number' || typeof row.lng !== 'number' || !row.updated_at) {
    throw new Error('Invalid row structure');
  }
  return row;
}

async function waitForOwnerPollingPosition(page: any, target: { latitude: number, longitude: number }, timeout: number) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const response = await page.waitForResponse(
      (r: any) => r.url().includes('/rest/v1/rpc/get_active_walker_location') && r.request().method() === 'POST',
      { timeout: 10000 }
    );
    const body = await response.json();
    const row = parseWalkerLocationResponse(body);
    if (Math.abs(row.lat - target.latitude) < 0.001 && Math.abs(row.lng - target.longitude) < 0.001) {
      return row;
    }
  }
  throw new Error('Polling timed out');
}

test.describe('Phase 4.2: Operational Browser GPS Tracking', () => {
  test.setTimeout(240000);
  let ownerId: string, walkerId: string, sessionId: string;

  test.afterAll(async () => await failClosedCleanup(admin, [ownerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID));

  test.beforeAll(async () => {
    const o = await admin.auth.admin.createUser({ email: TEST_OWNER, password: TEST_PASS, email_confirm: true });
    ownerId = o.data.user!.id;
    const w = await admin.auth.admin.createUser({ email: TEST_WALKER, password: TEST_PASS, email_confirm: true });
    walkerId = w.data.user!.id;

    await admin.from('profiles').update({ onboarding_completed: true, role: 'user' }).eq('id', ownerId);
    await admin.from('profiles').update({ onboarding_completed: true, role: 'petwalker' }).eq('id', walkerId);
    await admin.from('user_roles').insert([{ user_id: ownerId, role: 'user' }, { user_id: walkerId, role: 'petwalker' }]);
    
    await admin.from('petwalker_profiles').upsert({ user_id: walkerId, approval_status: 'approved', profile_completed: true });
    const { data: pet } = await admin.from('pets').insert({ owner_id: ownerId, name: 'Dog' }).select().single();
    const { data: walk } = await admin.from('walk_sessions').insert({
      customer_id: ownerId, walker_id: walkerId, pet_id: pet!.id, status: 'in_progress', current_status: 'in_progress'
    }).select().single();
    sessionId = walk!.id;
  });

  test('GPS Operational Flow', async ({ browser }) => {
    const create = async (email: string, pos: any) => {
      const ctx = await browser.newContext({ geolocation: pos, permissions: ['geolocation'] });
      const p = await ctx.newPage();
      await p.goto('/auth'); await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', TEST_PASS);
      await p.click('button[type="submit"]'); await p.waitForURL('**/inicio**'); return { ctx, p };
    };

    const posA = { latitude: -23.5505, longitude: -46.6333 };
    const { ctx: walkerCtx, p: walkerPage } = await create(TEST_WALKER, posA);
    const { ctx: ownerCtx, p: ownerPage } = await create(TEST_OWNER, posA);

    // Pos A Tracking
    await walkerPage.goto(`/petwalker/passeio/${sessionId}`);
    const resA = await ownerPage.waitForResponse(r => r.url().includes('get_active_walker_location'));
    const dataA = parseWalkerLocationResponse(await resA.json());
    expect(dataA.lat).toBeCloseTo(posA.latitude, 3);

    // Pos B Tracking
    const posB = { latitude: -23.5500, longitude: -46.6330 };
    await walkerCtx.setGeolocation(posB);
    await waitForOwnerPollingPosition(ownerPage, posB, 60000);

    // Pos C Audit
    const { error: e1, data: sB } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionId).single();
    expect(e1).toBeNull();
    const routeLengthB = (sB?.route_coordinates as any[] || []).length;
    
    const posC = { latitude: -23.5495, longitude: -46.6327 };
    await walkerCtx.setGeolocation(posC);
    await waitForOwnerPollingPosition(ownerPage, posC, 60000);
    
    const { error: e2, data: sC } = await admin.from('walk_sessions').select('route_coordinates').eq('id', sessionId).single();
    expect(e2).toBeNull();
    const routeC = sC?.route_coordinates as any[][];
    expect(routeC.length).toBeGreaterThan(routeLengthB);
    const lastC = routeC[routeC.length - 1];
    expect(lastC[0]).toBeCloseTo(posC.longitude, 4);
    expect(lastC[1]).toBeCloseTo(posC.latitude, 4);
    
    await walkerCtx.close();
    await ownerCtx.close();
  });
});
