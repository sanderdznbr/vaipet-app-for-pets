import { test, expect } from '@playwright/test';
import { createAuthedContext } from './helpers/auth';
import { failClosedCleanup } from './helpers/cleanup';
import { createClient } from '@supabase/supabase-js';

// Load env vars manually for the node-side of the test if needed
// but since supabase-js is used in node here, we need the real keys.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const E2E_RUN_ID = `4.1-${Date.now()}`;
const TEST_OWNER = `owner-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

test.describe('Phase 4.1: Operational Flow (Displacement & PIN)', () => {
  test.setTimeout(120000);

  test.beforeAll(async () => {
    // Provisioning
    const { data: owner } = await supabase.auth.admin.createUser({
      email: TEST_OWNER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'pet_owner', e2e_test: E2E_RUN_ID }
    });

    const { data: walker } = await supabase.auth.admin.createUser({
      email: TEST_WALKER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'petwalker', e2e_test: E2E_RUN_ID }
    });

    // Create Profiles
    await supabase.from('profiles').insert([
      { id: owner.user!.id, full_name: 'E2E Owner', e2e_test: E2E_RUN_ID },
      { id: walker.user!.id, full_name: 'E2E Walker', e2e_test: E2E_RUN_ID }
    ]);

    // Walker eligibility
    await supabase.from('petwalker_profiles').insert({
      user_id: walker.user!.id,
      status: 'active',
      is_online: true,
      e2e_test: E2E_RUN_ID
    });

    // Create Pet
    const { data: pet } = await supabase.from('pets').insert({
      owner_id: owner.user!.id,
      name: 'E2E Rex',
      type: 'dog',
      breed: 'Labrador',
      weight: 25,
      e2e_test: E2E_RUN_ID
    }).select().single();

    // Create Accepted Session directly
    await supabase.from('walk_sessions').insert({
      user_id: owner.user!.id,
      walker_id: walker.user!.id,
      pet_id: pet.id,
      current_status: 'accepted',
      planned_duration_minutes: 30,
      total_price_cents: 4500,
      meeting_point_address: 'Rua E2E, 123',
      home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'now',
      e2e_test: E2E_RUN_ID
    });
  });

  test.afterAll(async () => {
    await failClosedCleanup(E2E_RUN_ID);
  });

  test('Operational displacement and PIN confirmation', async ({ browser }) => {
    const { data: walk } = await supabase.from('walk_sessions')
      .select('id')
      .eq('e2e_test', E2E_RUN_ID)
      .single();

    const { page: walkerPage } = await createAuthedContext(browser, TEST_WALKER, TEST_PASS);
    const { page: ownerPage } = await createAuthedContext(browser, TEST_OWNER, TEST_PASS);

    // 1. Walker: Start Heading
    console.log('[STEP 1] Walker starting displacement');
    await walkerPage.goto(`/petwalker/passeio/${walk.id}`);
    await walkerPage.click('text=Iniciar Deslocamento');
    await expect(walkerPage.locator('text=Cheguei no Local')).toBeVisible({ timeout: 15000 });

    // 2. Walker: Arrive at Pickup (GPS Mocked by Browser)
    console.log('[STEP 2] Walker arriving at pickup');
    await walkerPage.click('text=Cheguei no Local');
    await expect(walkerPage.locator('[data-testid="pickup-pin-input"]')).toBeVisible({ timeout: 15000 });

    // 3. Owner: Get PIN
    console.log('[STEP 3] Owner fetching PIN');
    await ownerPage.goto(`/petwalker/passeio/${walk.id}`);
    const pinText = await ownerPage.locator('span:has-text("PIN") + span, .text-accent').textContent();
    const pin = pinText?.replace(/\s/g, '').trim();
    expect(pin).toMatch(/^[0-9]{6}$/);
    console.log(`[INFO] PIN discovered: ${pin}`);

    // 4. Walker: Submit PIN
    console.log('[STEP 4] Walker submitting PIN');
    await walkerPage.fill('[data-testid="pickup-pin-input"]', pin!);
    await walkerPage.click('[data-testid="pickup-pin-submit"]');

    // 5. Verification: Walk In Progress
    console.log('[STEP 5] Verifying walk is in progress');
    await expect(walkerPage.locator('text=Finalização indisponível')).toBeVisible({ timeout: 15000 });
    
    const { data: finalWalk } = await supabase.from('walk_sessions')
      .select('current_status')
      .eq('id', walk.id)
      .single();
    expect(finalWalk?.current_status).toBe('in_progress');
  });
});
