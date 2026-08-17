import { test, expect } from '@playwright/test';
import { createAuthedContext } from './helpers/auth';
import { failClosedCleanup } from './helpers/cleanup';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const E2E_RUN_ID = `4.1-op-${Date.now()}`;
const TEST_OWNER = `owner-op-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-op-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

test.describe('Phase 4.1: Operational Flow (Displacement & PIN)', () => {
  test.setTimeout(180000);
  let ownerId: string;
  let walkerId: string;
  let sessionId: string;

  test.beforeAll(async () => {
    // 1. Criar Usuários
    const [ownerRes, walkerRes] = await Promise.all([
      supabase.auth.admin.createUser({
        email: TEST_OWNER,
        password: TEST_PASS,
        email_confirm: true,
        user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: E2E_RUN_ID }
      }),
      supabase.auth.admin.createUser({
        email: TEST_WALKER,
        password: TEST_PASS,
        email_confirm: true,
        user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID }
      })
    ]);

    if (ownerRes.error) throw ownerRes.error;
    if (walkerRes.error) throw walkerRes.error;

    ownerId = ownerRes.data.user!.id;
    walkerId = walkerRes.data.user!.id;

    // 2. Provisionar Perfis (Trigger-aware UPSERT)
    const { error: profErr } = await supabase.from('profiles').upsert([
      { id: ownerId, onboarding_completed: true, e2e_test: true },
      { id: walkerId, onboarding_completed: true, e2e_test: true }
    ]);
    if (profErr) throw profErr;

    const { error: roleErr } = await supabase.from('user_roles').insert([
      { user_id: ownerId, role: 'user' },
      { user_id: walkerId, role: 'petwalker' }
    ]);
    if (roleErr) throw roleErr;

    const { error: walkerProfErr } = await supabase.from('petwalker_profiles').insert({
      user_id: walkerId,
      status: 'active',
      is_online: true,
      e2e_test: true,
      operational_onboarding_completed: true
    });
    if (walkerProfErr) throw walkerProfErr;

    const { data: pet, error: petErr } = await supabase.from('pets').insert({
      owner_id: ownerId,
      name: `E2E Rex ${E2E_RUN_ID}`,
      breed: 'Vira-lata',
      weight: 10,
      e2e_test: true
    }).select().single();


    if (petErr) throw petErr;

    // 3. Criar Sessão em status 'accepted'
    const { data: walk, error: walkErr } = await supabase.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: pet!.id,
      current_status: 'accepted',
      status: 'accepted',
      planned_duration_minutes: 30,
      total_price_cents: 4500,
      meeting_point_address: 'Rua E2E, 123',
      home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'now',
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID,
      start_time: new Date().toISOString() 
    }).select().single();
    if (walkErr) throw walkErr;
    sessionId = walk!.id;
  });

  test.afterAll(async () => {
    await failClosedCleanup(supabase, [ownerId, walkerId], E2E_RUN_ID);
  });

  test('Operational displacement and PIN confirmation', async ({ browser }) => {
    // Autenticação paralela seguindo o fluxo real
    const [walkerCtx, ownerCtx] = await Promise.all([
      createAuthedContext(browser, TEST_WALKER, TEST_PASS, '/petwalker'),
      createAuthedContext(browser, TEST_OWNER, TEST_PASS, '/inicio')
    ]);

    const walkerPage = walkerCtx.page;
    const ownerPage = ownerCtx.page;

    // 1. Walker: Start Heading
    console.log('[STEP 1] Walker starting displacement');
    await walkerPage.goto(`/petwalker/passeio/${sessionId}`);
    
    const headingBtn = walkerPage.getByRole('button', { name: /Iniciar Deslocamento/i });
    await expect(headingBtn).toBeVisible({ timeout: 45000 });
    await headingBtn.click();
    
    console.log('[STEP 1.1] Waiting for arrival button');
    await expect(walkerPage.getByRole('button', { name: /Cheguei no Local/i })).toBeVisible({ timeout: 20000 });

    // 2. Walker: Arrive at Pickup
    console.log('[STEP 2] Walker arriving at pickup');
    await walkerPage.getByRole('button', { name: /Cheguei no Local/i }).click();
    console.log('[STEP 2.1] Waiting for PIN input');
    await expect(walkerPage.locator('[data-testid="pickup-pin-input"]')).toBeVisible({ timeout: 20000 });

    // 3. Owner: Get PIN (using correct route for Owner)
    console.log('[STEP 3] Owner fetching PIN');
    await ownerPage.goto(`/historico/${sessionId}`);
    
    const pinDisplay = ownerPage.locator('[data-testid="pickup-pin-display"]');
    await expect(pinDisplay).toBeVisible({ timeout: 30000 });
    
    // Aguarda o código ser carregado (pode demorar alguns ms pelo RPC)
    await expect(async () => {
      const text = await pinDisplay.textContent();
      expect(text?.trim()).toMatch(/^[0-9]{6}$/);
    }).toPass({ timeout: 15000 });
    
    const pin = (await pinDisplay.textContent())?.replace(/\s/g, '').trim();
    console.log(`[INFO] PIN discovered: ${pin}`);

    // 4. Walker: Submit PIN
    console.log('[STEP 4] Walker submitting PIN');
    await walkerPage.fill('[data-testid="pickup-pin-input"]', pin!);
    await walkerPage.click('[data-testid="pickup-pin-submit"]');

    // 5. Verification: Walk In Progress
    console.log('[STEP 5] Verifying walk is in progress');
    // Phase 4.1: Deve mostrar o aviso de passeio em andamento
    await expect(walkerPage.locator('[data-testid="walk-in-progress-marker"]')).toBeVisible({ timeout: 20000 });
    
    const { data: finalWalk } = await supabase.from('walk_sessions')
      .select('current_status, pickup_confirmed_at, start_time, walker_id')
      .eq('id', sessionId)
      .single();
    
    expect(finalWalk?.current_status).toBe('in_progress');
    expect(finalWalk?.pickup_confirmed_at).not.toBeNull();
    expect(finalWalk?.start_time).not.toBeNull();
    expect(finalWalk?.walker_id).toBe(walkerId);

    // Verify PIN is deleted
    const { data: pinRecord } = await supabase.from('walk_pickup_codes').select('*').eq('session_id', sessionId).maybeSingle();
    expect(pinRecord).toBeNull();
    
    await walkerCtx.context.close();
    await ownerCtx.context.close();
  });
});
