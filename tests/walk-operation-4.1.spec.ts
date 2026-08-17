import { test, expect } from '@playwright/test';
import { createAuthedContext } from './helpers/auth';
import { failClosedCleanup } from './helpers/cleanup';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const E2E_RUN_ID = `4.1-${Date.now()}`;
const TEST_OWNER = `owner-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

test.describe('Phase 4.1: Operational Flow (Displacement & PIN)', () => {
  test.setTimeout(150000);

  test.beforeAll(async () => {
    // 1. Criar Usuários
    const { data: owner, error: ownerErr } = await supabase.auth.admin.createUser({
      email: TEST_OWNER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'pet_owner', e2e_test: E2E_RUN_ID }
    });
    if (ownerErr) throw ownerErr;

    const { data: walker, error: walkerErr } = await supabase.auth.admin.createUser({
      email: TEST_WALKER,
      password: TEST_PASS,
      email_confirm: true,
      user_metadata: { signup_intent: 'petwalker', e2e_test: E2E_RUN_ID }
    });
    if (walkerErr) throw walkerErr;

    // 2. Provisionar Perfis para pular onboarding
    await supabase.from('profiles').insert([
      { 
        id: owner.user!.id, 
        full_name: 'E2E Owner', 
        e2e_test: E2E_RUN_ID,
        onboarding_completed: true,
        phone: '11999999999',
        birth_date: '1990-01-01'
      },
      { 
        id: walker.user!.id, 
        full_name: 'E2E Walker', 
        e2e_test: E2E_RUN_ID,
        onboarding_completed: true,
        phone: '11888888888',
        birth_date: '1990-01-01'
      }
    ]);

    await supabase.from('user_roles').insert([
      { user_id: owner.user!.id, role: 'user' },
      { user_id: walker.user!.id, role: 'petwalker' }
    ]);

    await supabase.from('petwalker_profiles').insert({
      user_id: walker.user!.id,
      status: 'active',
      is_online: true,
      e2e_test: E2E_RUN_ID,
      operational_onboarding_completed: true
    });

    const { data: pet } = await supabase.from('pets').insert({
      owner_id: owner.user!.id,
      name: `E2E Rex ${E2E_RUN_ID}`,
      breed: 'Labrador',
      weight: 25
    }).select().single();

    // 3. Criar Sessão em status 'accepted'
    await supabase.from('walk_sessions').insert({
      customer_id: owner.user!.id,
      walker_id: walker.user!.id,
      pet_id: pet!.id,
      current_status: 'accepted',
      status: 'accepted',
      planned_duration_minutes: 30,
      total_price_cents: 4500,
      meeting_point_address: 'Rua E2E, 123',
      home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'now',
      walker_name: E2E_RUN_ID,
      start_time: new Date().toISOString() 
    });
  });

  test.afterAll(async () => {
    await failClosedCleanup(supabase, [], E2E_RUN_ID);
  });

  test('Operational displacement and PIN confirmation', async ({ browser }) => {
    const { data: walk } = await supabase.from('walk_sessions')
      .select('id')
      .eq('walker_name', E2E_RUN_ID)
      .single();

    const { page: walkerPage } = await createAuthedContext(browser, TEST_WALKER, TEST_PASS);
    const { page: ownerPage } = await createAuthedContext(browser, TEST_OWNER, TEST_PASS);

    // 1. Walker: Start Heading
    console.log('[STEP 1] Walker starting displacement');
    await walkerPage.goto(`/petwalker/passeio/${walk!.id}`);
    
    // Usar data-testid ou seletor mais resiliente
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

    // 3. Owner: Get PIN
    console.log('[STEP 3] Owner fetching PIN');
    await ownerPage.goto(`/petwalker/passeio/${walk!.id}`);
    
    // Usar o data-testid que adicionamos
    const pinDisplay = ownerPage.locator('[data-testid="pickup-pin-display"]');
    await expect(pinDisplay).toBeVisible({ timeout: 30000 });
    await expect(pinDisplay).not.toHaveText(/------/);
    
    const pin = (await pinDisplay.textContent())?.replace(/\s/g, '').trim();
    console.log(`[INFO] PIN discovered: ${pin}`);
    expect(pin).toMatch(/^[0-9]{6}$/);

    // 4. Walker: Submit PIN
    console.log('[STEP 4] Walker submitting PIN');
    await walkerPage.fill('[data-testid="pickup-pin-input"]', pin!);
    await walkerPage.click('[data-testid="pickup-pin-submit"]');

    // 5. Verification: Walk In Progress
    console.log('[STEP 5] Verifying walk is in progress');
    // Quando em progresso, o botão de finalização deve aparecer (mesmo que desabilitado por segurança na Phase 4.1)
    await expect(walkerPage.getByRole('button', { name: /Finalizar Passeio/i })).toBeVisible({ timeout: 20000 });
    
    const { data: finalWalk } = await supabase.from('walk_sessions')
      .select('current_status')
      .eq('id', walk!.id)
      .single();
    expect(finalWalk?.current_status).toBe('in_progress');
  });
});
