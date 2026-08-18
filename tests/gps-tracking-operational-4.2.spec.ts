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

      // Auditar walker_tracking e route_coordinates
      const { data: trail, error: trailErr } = await admin.from('walk_sessions')
        .select('route_coordinates')
        .eq('id', sessionId)
        .single();
      expect(trailErr).toBeNull();
      expect(Array.isArray(trail?.route_coordinates)).toBe(true);
      expect(trail?.route_coordinates.length).toBeGreaterThanOrEqual(1);

      const { count: trackingCount, error: countErr } = await admin.from('walker_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('walk_session_id', sessionId);
      expect(countErr).toBeNull();
      expect(trackingCount).toBeGreaterThanOrEqual(1);

      // 4. OWNER — CONSUMO REAL
      await ownerPage.goto(`/search-walk?resume=${sessionId}`);
      const marker = ownerPage.locator('[data-testid="active-walker-marker"]');
      await expect(marker).toBeVisible({ timeout: 30000 });

      // Registrar posição inicial do marcador
      const initialTransform = await marker.evaluate(el => (el as HTMLElement).style.transform);

      // 5. MOVIMENTO REAL DO WALKER
      // Posição B (~50m de diferença)
      const posB = { latitude: -23.5500, longitude: -46.6330 };
      await walkerCtx.setGeolocation(posB);

      // Respeitar throttle de 10s + processamento
      await expect.poll(async () => {
        const { count } = await admin.from('walker_tracking')
          .select('*', { count: 'exact', head: true })
          .eq('walk_session_id', sessionId);
        return count || 0;
      }, {
        message: 'Waiting for movement persistence (Pos B)',
        timeout: 45000,
        intervals: [5000]
      }).toBeGreaterThan(trackingCount!);

      // Auditoria Posição B
      const { data: auditB } = await admin.from('petwalker_profiles')
        .select('last_known_location, last_location_captured_at')
        .eq('user_id', walkerId)
        .single();
      expect(auditB?.last_known_location).toBeDefined();

      const { data: sessionB } = await admin.from('walk_sessions')
        .select('route_coordinates')
        .eq('id', sessionId)
        .single();
      const coords = sessionB?.route_coordinates as any[][];
      const lastPoint = coords[coords.length - 1];
      expect(lastPoint).toHaveLength(2); // [lng, lat]
      expect(lastPoint[0]).toBeCloseTo(posB.longitude, 4);
      expect(lastPoint[1]).toBeCloseTo(posB.latitude, 4);

      // 6. OWNER RECEBE A POSIÇÃO B
      // Esperar marker se mover
      await expect.poll(async () => {
        const currentTransform = await marker.evaluate(el => (el as HTMLElement).style.transform);
        return currentTransform !== initialTransform;
      }, {
        message: 'Waiting for owner UI to reflect movement',
        timeout: 30000
      }).toBe(true);

      // 7. REFRESH / REOPEN
      await ownerPage.reload();
      await expect(ownerPage.locator('[data-testid="active-walker-marker"]')).toBeVisible({ timeout: 30000 });
      
      const transformAfterReload = await marker.evaluate(el => (el as HTMLElement).style.transform);
      expect(transformAfterReload).not.toBe(initialTransform);

      // 8. TERCEIRO MOVIMENTO APÓS RELOAD
      const posC = { latitude: -23.5495, longitude: -46.6327 };
      await walkerCtx.setGeolocation(posC);

      const currentTrackingCount = (await admin.from('walker_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('walk_session_id', sessionId)).count || 0;

      await expect.poll(async () => {
        const { count } = await admin.from('walker_tracking')
          .select('*', { count: 'exact', head: true })
          .eq('walk_session_id', sessionId);
        return count || 0;
      }, {
        message: 'Waiting for movement persistence (Pos C)',
        timeout: 45000,
        intervals: [5000]
      }).toBeGreaterThan(currentTrackingCount);

      await expect.poll(async () => {
        const finalTransform = await marker.evaluate(el => (el as HTMLElement).style.transform);
        return finalTransform !== transformAfterReload;
      }, {
        message: 'Waiting for owner UI to reflect movement C',
        timeout: 30000
      }).toBe(true);

    } finally {
      await walkerCtx.close();
      await ownerCtx.close();
    }
  });
});
