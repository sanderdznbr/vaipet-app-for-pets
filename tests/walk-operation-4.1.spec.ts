import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';
import { createAuthedContext } from './helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";


/**
 * PHASE 4.1 E2E: Displacement and Secure Pickup
 * Modular test starting from 'accepted' status.
 */

test.describe('Phase 4.1: Walk Operation (Pickup PIN)', () => {
  let ownerId: string;
  let walkerId: string;
  let otherWalkerId: string;
  let sessionId: string;
  let petId: string;
  const runId = `e2e-4.1-${Math.random().toString(36).slice(2, 7)}`;

  let admin: any;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });


    // Create Owner
    const ownerEmail = `owner-${runId}@test.com`;
    const { data: ownerAuth, error: ownerErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: 'password123',
      email_confirm: true,
      user_metadata: { e2e_test: true, e2e_run_id: runId, full_name: 'E2E Owner' }
    });
    if (ownerErr) throw ownerErr;
    ownerId = ownerAuth.user.id;

    // Create PetWalker
    const walkerEmail = `walker-${runId}@test.com`;
    const { data: walkerAuth, error: walkerErr } = await admin.auth.admin.createUser({
      email: walkerEmail,
      password: 'password123',
      email_confirm: true,
      user_metadata: { e2e_test: true, e2e_run_id: runId, full_name: 'E2E Walker' }
    });
    if (walkerErr) throw walkerErr;
    walkerId = walkerAuth.user.id;

    // Create Other Walker
    const otherEmail = `other-${runId}@test.com`;
    const { data: otherAuth } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: 'password123',
      email_confirm: true,
      user_metadata: { e2e_test: true, e2e_run_id: runId }
    });
    otherWalkerId = otherAuth.user.id;

    // Roles and Profiles
    await admin.from('user_roles').insert([
      { user_id: ownerId, role: 'user' },
      { user_id: walkerId, role: 'petwalker' },
      { user_id: otherWalkerId, role: 'petwalker' }
    ]);

    await admin.from('profiles').insert([
      { id: ownerId, full_name: 'E2E Owner', onboarding_completed: true },
      { id: walkerId, full_name: 'E2E Walker', onboarding_completed: true },
      { id: otherWalkerId, full_name: 'Other Walker', onboarding_completed: true }
    ]);

    await admin.from('petwalker_profiles').insert([
      { user_id: walkerId, status: 'verified', city: 'São Paulo', service_radius_meters: 5000 },
      { user_id: otherWalkerId, status: 'verified', city: 'São Paulo' }
    ]);

    // Create Pet
    const { data: pet, error: petErr } = await admin.from('pets').insert({
      owner_id: ownerId,
      name: 'TestDog',
      breed: 'E2E',
      weight: 10
    }).select();
    
    if (petErr) throw new Error(`[SETUP] Failed to create pet: \${petErr.message}`);
    if (!pet || pet.length === 0) throw new Error(`[SETUP] Pet creation returned empty data`);
    petId = pet[0].id;

    // Create Accepted Walk Session (Pre-condition)
    const { data: session } = await admin.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      current_status: 'accepted',
      planned_duration_minutes: 30,
      total_price_cents: 4500,
      meeting_point_address: 'Rua Teste, 123',
      home_location: { lng: -46.6333, lat: -23.5505 },
      meeting_point_geom: 'SRID=4326;POINT(-46.6333 -23.5505)'
    }).select().single();
    sessionId = session.id;
  });

  test.afterAll(async () => {
    await failClosedCleanup(admin, [ownerId, walkerId, otherWalkerId], runId);
  });

  test('Operation Flow: accepted -> in_progress via Secure PIN', async ({ browser }) => {
    const walkerCtx = await createAuthedContext(browser, `walker-${runId}@test.com`, 'password123');
    const ownerCtx = await createAuthedContext(browser, `owner-${runId}@test.com`, 'password123');
    
    const walkerPage = walkerCtx.page;
    const ownerPage = ownerCtx.page;

    // 1. PetWalker starts heading
    await test.step('petwalker-start-heading', async () => {
      await walkerPage.goto('/petwalker');
      await walkerPage.getByRole('button', { name: /Iniciar deslocamento/i }).click();
      
      // Wait for status sync
      await expect(walkerPage.locator('text=A caminho do pet')).toBeVisible({ timeout: 10000 });
      
      const { data } = await admin.from('walk_sessions').select('current_status, heading_started_at').eq('id', sessionId).single();
      expect(data.current_status).toBe('heading_to_pickup');
      expect(data.heading_started_at).not.toBeNull();
    });

    // 2. Proximity validation
    await test.step('petwalker-proximity-check', async () => {
      // Mock far location (using page.evaluate for geolocation mock is fine here as it mimics browser hardware)
      await walkerCtx.context.setGeolocation({ latitude: -23.6000, longitude: -46.7000 }); // ~10km away
      await walkerPage.getByRole('button', { name: /Cheguei ao local/i }).click();
      
      // Should fail/stay in same status (Error toast might appear)
      const { data: farData } = await admin.from('walk_sessions').select('current_status').eq('id', sessionId).single();
      expect(farData.current_status).toBe('heading_to_pickup');

      // Mock near location
      await walkerCtx.context.setGeolocation({ latitude: -23.5505, longitude: -46.6333 }); // exact
      await walkerPage.getByRole('button', { name: /Cheguei ao local/i }).click();
      
      await expect(walkerPage.locator('text=Validar PIN')).toBeVisible({ timeout: 10000 });
      const { data: nearData } = await admin.from('walk_sessions').select('current_status, arrived_at').eq('id', sessionId).single();
      expect(nearData.current_status).toBe('arrived');
      expect(nearData.arrived_at).not.toBeNull();
    });

    // 3. Owner gets PIN
    await test.step('owner-visualize-pin', async () => {
      await ownerPage.goto(`/historico/${sessionId}`);
      const pinLocator = ownerPage.locator('[data-testid="pickup-pin-display"]');
      await expect(pinLocator).toBeVisible({ timeout: 15000 });
      const pin = await pinLocator.innerText();
      expect(pin).toHaveLength(6);
      expect(pin).toMatch(/^[A-Z0-9]{6}$/);
    });

    // 4. PIN Validation
    await test.step('petwalker-pin-validation', async () => {
      const pin = await ownerPage.locator('[data-testid="pickup-pin-display"]').innerText();
      
      await walkerPage.getByRole('button', { name: /Validar PIN/i }).click();
      await expect(walkerPage).toHaveURL(new RegExp(`/petwalker/passeio/${sessionId}`));

      const inputs = walkerPage.locator('[data-testid="pickup-pin-input"]');
      
      // Wrong PIN
      await inputs.nth(0).fill('0');
      await inputs.nth(1).fill('0');
      await inputs.nth(2).fill('0');
      await inputs.nth(3).fill('0');
      await inputs.nth(4).fill('0');
      await inputs.nth(5).fill('0');
      await walkerPage.locator('[data-testid="pickup-pin-submit"]').click();
      
      await expect(walkerPage.locator('text=Código incorreto')).toBeVisible();

      // Correct PIN
      for (let i = 0; i < 6; i++) {
        await inputs.nth(i).fill(pin[i]);
      }
      await walkerPage.locator('[data-testid="pickup-pin-submit"]').click();

      // Check walk starts
      await expect(walkerPage.locator('text=Passeando')).toBeVisible({ timeout: 15000 });
      const { data } = await admin.from('walk_sessions').select('current_status, pickup_confirmed_at, start_time').eq('id', sessionId).single();
      expect(data.current_status).toBe('in_progress');
      expect(data.pickup_confirmed_at).not.toBeNull();
      expect(data.start_time).not.toBeNull();
    });

    // 5. Security: Replay and Direct Access blocking
    await test.step('security-checks', async () => {
      // Re-confirm should fail (PIN deleted)
      const { error: replayErr } = await admin.rpc('petwalker_confirm_pickup', { 
        _session_id: sessionId, 
        _pickup_code: '123456' 
      });
      expect(replayErr).not.toBeNull();

      // Direct petwalker_complete_walk bypass check
      const { error: completeErr } = await admin.rpc('petwalker_complete_walk', { 
        _session_id: sessionId 
      });
      // Should fail because it's in_progress, not returning (and authenticated execute revoked)
      expect(completeErr).not.toBeNull();
    });
  });
});
