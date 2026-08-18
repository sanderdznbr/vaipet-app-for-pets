import { test, expect, BrowserContext, Page } from '@playwright/test';
import { failClosedCleanup } from './helpers/cleanup';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase E2E environment variables (URL/SERVICE_ROLE_KEY)');
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const E2E_RUN_ID = `4.2-op-${Date.now()}`;
const TEST_OWNER = `owner-42-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-42-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

test.describe('Phase 4.2: Operational Browser GPS Tracking', () => {
  test.setTimeout(240000);
  let ownerId: string;
  let walkerId: string;
  let petId: string;
  let sessionId: string;

  test.afterAll(async () => {
    await failClosedCleanup(admin, [ownerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID);
  });

  test.beforeAll(async () => {
    // 1. SETUP FAIL-CLOSED
    // Create Owner
    const ownerRes = await admin.auth.admin.createUser({
      email: TEST_OWNER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: E2E_RUN_ID }
    });
    expect(ownerRes.error).toBeNull();
    ownerId = ownerRes.data.user!.id;

    // Create Walker
    const walkerRes = await admin.auth.admin.createUser({
      email: TEST_WALKER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID }
    });
    expect(walkerRes.error).toBeNull();
    walkerId = walkerRes.data.user!.id;

    // Provision Profiles
    const { error: p1 } = await admin.from('profiles').update({
      onboarding_completed: true,
      e2e_test: true,
      signup_intent: 'pet_owner',
      role: 'user'
    }).eq('id', ownerId);
    expect(p1).toBeNull();

    const { error: p2 } = await admin.from('profiles').update({
      onboarding_completed: true,
      e2e_test: true,
      signup_intent: 'petwalker',
      role: 'petwalker'
    }).eq('id', walkerId);
    expect(p2).toBeNull();

    // Roles
    const { error: delRolesErr } = await admin.from('user_roles').delete().in('user_id', [ownerId, walkerId]);
    expect(delRolesErr).toBeNull();
    
    const { error: r1 } = await admin.from('user_roles').insert([
      { user_id: ownerId, role: 'user' },
      { user_id: walkerId, role: 'user' },
      { user_id: walkerId, role: 'petwalker' }
    ]);
    expect(r1).toBeNull();

    // Walker Profile
    const { error: wp1 } = await admin.from('petwalker_profiles').upsert({
      user_id: walkerId,
      approval_status: 'approved',
      profile_completed: true,
      is_accepting_requests: true,
      availability_status: 'available',
      e2e_test: true
    });
    expect(wp1).toBeNull();

    // Pet
    const { data: pet, error: petErr } = await admin.from('pets').insert({
      owner_id: ownerId,
      name: `Dog 4.2 ${E2E_RUN_ID}`,
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    expect(petErr).toBeNull();
    petId = pet!.id;

    // Walk Session
    const initialPos = { lat: -23.5505, lng: -46.6333 };
    const { data: walk, error: walkErr } = await admin.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      status: 'in_progress',
      current_status: 'in_progress',
      start_time: new Date().toISOString(),
      pickup_confirmed_at: new Date().toISOString(),
      home_location: initialPos,
      route_coordinates: [],
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    expect(walkErr).toBeNull();
    sessionId = walk!.id;

    // Link current walk
    const { error: linkErr } = await admin.from('petwalker_profiles')
      .update({ current_walk_id: sessionId })
      .eq('user_id', walkerId);
    expect(linkErr).toBeNull();

    // Final Audit
    const { data: audit, error: auditErr } = await admin.from('walk_sessions')
      .select('current_status, walker_id')
      .eq('id', sessionId)
      .single();
    expect(auditErr).toBeNull();
    expect(audit?.current_status).toBe('in_progress');
    expect(audit?.walker_id).toBe(walkerId);

    const { data: pAudit, error: pAuditErr } = await admin.from('petwalker_profiles')
      .select('current_walk_id')
      .eq('user_id', walkerId)
      .single();
    expect(pAuditErr).toBeNull();
    expect(pAudit?.current_walk_id).toBe(sessionId);
  });

  test('Phase 4.2: Operational Browser GPS Tracking', async ({ browser }) => {
    // 2. LOGIN REAL NOS DOIS NAVEGADORES
    const createAuthenticatedContext = async (email: string, initialPos: { latitude: number, longitude: number }) => {
      const context = await browser.newContext({
        geolocation: initialPos,
        permissions: ['geolocation'],
        viewport: { width: 1280, height: 800 }
      });
      const page = await context.newPage();
      await page.goto('/auth');
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', TEST_PASS);
      await page.click('button[type="submit"]');
      await page.waitForURL('**/inicio**', { timeout: 30000 });
      return { context, page };
    };

    const posA = { latitude: -23.5505, longitude: -46.6333 };
    const { context: walkerCtx, page: walkerPage } = await createAuthenticatedContext(TEST_WALKER, posA);
    const { context: ownerCtx, page: ownerPage } = await createAuthenticatedContext(TEST_OWNER, posA);

    try {
      // 3. PETWALKER — TRACKING REAL PELO PROVIDER
      await walkerPage.goto(`/petwalker/passeio/${sessionId}`);
      
      // Esperar persistência no backend (via browser geolocation -> Provider -> RPC)
      await expect.poll(async () => {
        const { data } = await admin.from('petwalker_profiles')
          .select('last_location_captured_at')
          .eq('user_id', walkerId)
          .single();
        return Number(data?.last_location_captured_at || 0);
      }, {
        message: 'Waiting for first GPS persistence',
        timeout: 60000,
        intervals: [5000]
      }).toBeGreaterThan(0);

      // Auditar walker_tracking e route_coordinates iniciais (Posição A)
      const { data: profileA, error: profileAErr } = await admin.from('petwalker_profiles')
        .select('last_location_captured_at, last_known_location')
        .eq('user_id', walkerId)
        .single();
      expect(profileAErr).toBeNull();
      const lastCapturedAtA = profileA!.last_location_captured_at;

      const { data: trailA, error: trailAErr } = await admin.from('walk_sessions')
        .select('route_coordinates')
        .eq('id', sessionId)
        .single();
      expect(trailAErr).toBeNull();
      const routeLengthA = (trailA?.route_coordinates as any[] || []).length;

      const { count: trackingCountA, error: countAErr } = await admin.from('walker_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('walk_session_id', sessionId)
        .eq('walker_id', walkerId);
      expect(countAErr).toBeNull();

      // 4. OWNER — OBSERVAR POLLING REAL (Posição A)
      // Armar observação da response natural
      const responseAPromise = ownerPage.waitForResponse(
        resp => resp.url().includes('/rest/v1/rpc/get_active_walker_location') && resp.request().method() === 'POST'
      );
      
      await ownerPage.goto(`/search-walk?resume=${sessionId}`);
      
      const responseA = await responseAPromise;
      expect(responseA.status()).toBe(200);
      const dataA = await responseA.json();
      
      // Provar que a resposta contém dados reais de A
      expect(typeof dataA.lat).toBe('number');
      expect(typeof dataA.lng).toBe('number');
      expect(dataA.updated_at).toBeDefined();
      expect(dataA.lat).toBeCloseTo(posA.latitude, 3);
      expect(dataA.lng).toBeCloseTo(posA.longitude, 3);

      const marker = ownerPage.locator('[data-testid="active-walker-marker"]');
      await expect(marker).toBeVisible({ timeout: 30000 });
      const transformA = await marker.evaluate(el => (el as HTMLElement).style.transform);

      // 5. MOVIMENTO REAL DO WALKER (A -> B)
      const posB = { latitude: -23.5500, longitude: -46.6330 };
      await walkerCtx.setGeolocation(posB);

      // Esperar persistência natural de B
      await expect.poll(async () => {
        const { data: pB } = await admin.from('petwalker_profiles')
          .select('last_location_captured_at')
          .eq('user_id', walkerId)
          .single();
        return Number(pB?.last_location_captured_at || 0);
      }, {
        message: 'Waiting for movement persistence (Pos B)',
        timeout: 60000,
        intervals: [5000]
      }).toBeGreaterThan(Number(lastCapturedAtA));

      // Auditoria Posição B no Backend
      const { data: profileB } = await admin.from('petwalker_profiles')
        .select('last_location_captured_at, last_known_location')
        .eq('user_id', walkerId)
        .single();
      const lastCapturedAtB = profileB!.last_location_captured_at;
      expect(BigInt(lastCapturedAtB)).toBeGreaterThan(BigInt(lastCapturedAtA));

      const { data: trailB } = await admin.from('walk_sessions')
        .select('route_coordinates')
        .eq('id', sessionId)
        .single();
      const routeB = trailB?.route_coordinates as any[][];
      expect(routeB.length).toBeGreaterThan(routeLengthA);
      const lastPointB = routeB[routeB.length - 1];
      expect(lastPointB[0]).toBeCloseTo(posB.longitude, 4); // [lng, lat]
      expect(lastPointB[1]).toBeCloseTo(posB.latitude, 4);

      const { count: trackingCountB } = await admin.from('walker_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('walk_session_id', sessionId)
        .eq('walker_id', walkerId);
      expect(trackingCountB).toBeGreaterThan(trackingCountA!);

      // 6. OWNER RECEBE A POSIÇÃO B (Observar Polling Real)
      // Continuar aguardando polling até a response retornar coordenadas correspondentes a B
      let responseBData;
      await expect.poll(async () => {
        const resp = await ownerPage.waitForResponse(
          r => r.url().includes('/rest/v1/rpc/get_active_walker_location') && r.request().method() === 'POST',
          { timeout: 15000 }
        );
        const json = await resp.json();
        if (Math.abs(json.lat - posB.latitude) < 0.001 && Math.abs(json.lng - posB.longitude) < 0.001) {
          responseBData = json;
          return true;
        }
        return false;
      }, {
        message: 'Waiting for owner polling to receive Pos B',
        timeout: 60000,
        intervals: [2000]
      }).toBe(true);

      expect(responseBData.lat).toBeCloseTo(posB.latitude, 4);
      expect(responseBData.lng).toBeCloseTo(posB.longitude, 4);

      // Assertion secundária do marker
      await expect(marker).toBeVisible();
      const transformB = await marker.evaluate(el => (el as HTMLElement).style.transform);
      expect(transformB).not.toBe(transformA);

      // 7. REFRESH / REOPEN
      // Armar espera por polling natural PÓS reload
      const responseReloadPromise = ownerPage.waitForResponse(
        resp => resp.url().includes('/rest/v1/rpc/get_active_walker_location') && resp.request().method() === 'POST'
      );
      
      await ownerPage.reload();
      
      const responseReload = await responseReloadPromise;
      const dataReload = await responseReload.json();
      expect(dataReload.lat).toBeCloseTo(posB.latitude, 4);
      expect(dataReload.lng).toBeCloseTo(posB.longitude, 4);

      await expect(ownerPage.locator('[data-testid="active-walker-marker"]')).toBeVisible({ timeout: 30000 });
      const transformAfterReload = await marker.evaluate(el => (el as HTMLElement).style.transform);
      expect(transformAfterReload).not.toBe(transformA);

      // 8. MOVIMENTO B -> C
      const posC = { latitude: -23.5495, longitude: -46.6327 };
      await walkerCtx.setGeolocation(posC);

      // Esperar persistência natural de C
      await expect.poll(async () => {
        const { data: pC } = await admin.from('petwalker_profiles')
          .select('last_location_captured_at')
          .eq('user_id', walkerId)
          .single();
        return Number(pC?.last_location_captured_at || 0);
      }, {
        message: 'Waiting for movement persistence (Pos C)',
        timeout: 60000,
        intervals: [5000]
      }).toBeGreaterThan(Number(lastCapturedAtB));

      // Auditoria Posição C no Backend
      const { data: profileC } = await admin.from('petwalker_profiles')
        .select('last_location_captured_at')
        .eq('user_id', walkerId)
        .single();
      expect(BigInt(profileC!.last_location_captured_at)).toBeGreaterThan(BigInt(lastCapturedAtB));

      const { count: trackingCountC } = await admin.from('walker_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('walk_session_id', sessionId)
        .eq('walker_id', walkerId);
      expect(trackingCountC).toBeGreaterThan(trackingCountB!);

      // Esperar polling real do Owner até retornar C
      let responseCData;
      await expect.poll(async () => {
        const resp = await ownerPage.waitForResponse(
          r => r.url().includes('/rest/v1/rpc/get_active_walker_location') && r.request().method() === 'POST',
          { timeout: 15000 }
        );
        const json = await resp.json();
        if (Math.abs(json.lat - posC.latitude) < 0.001 && Math.abs(json.lng - posC.longitude) < 0.001) {
          responseCData = json;
          return true;
        }
        return false;
      }, {
        message: 'Waiting for owner polling to receive Pos C',
        timeout: 60000,
        intervals: [2000]
      }).toBe(true);

      expect(responseCData.lat).toBeCloseTo(posC.latitude, 4);
      expect(responseCData.lng).toBeCloseTo(posC.longitude, 4);
      await expect(marker).toBeVisible();

    } finally {
      await walkerCtx.close();
      await ownerCtx.close();
    }
  });
});
