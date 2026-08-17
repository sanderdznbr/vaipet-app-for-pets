import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const E2E_RUN_ID = `4.1-sec-${Date.now()}`;
const TEST_OWNER = `owner-sec-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-sec-${E2E_RUN_ID}@example.com`;
const TEST_OTHER = `other-sec-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

test.describe('Phase 4.1: Zero-Trust Security Validation', () => {
  let ownerId: string;
  let walkerId: string;
  let otherId: string;
  let sessionId: string;
  let petId: string;

  test.beforeAll(async () => {
    // 1. Setup Users
    const users = await Promise.all([
      supabaseAdmin.auth.admin.createUser({ email: TEST_OWNER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: E2E_RUN_ID } }),
      supabaseAdmin.auth.admin.createUser({ email: TEST_WALKER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID } }),
      supabaseAdmin.auth.admin.createUser({ email: TEST_OTHER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID } })
    ]);

    ownerId = users[0].data.user!.id;
    walkerId = users[1].data.user!.id;
    otherId = users[2].data.user!.id;

    // 2. Provision Profiles & Roles
    await supabaseAdmin.from('profiles').upsert([
      { id: ownerId, onboarding_completed: true, e2e_test: true },
      { id: walkerId, onboarding_completed: true, e2e_test: true },
      { id: otherId, onboarding_completed: true, e2e_test: true }
    ]);

    await supabaseAdmin.from('user_roles').insert([
      { user_id: ownerId, role: 'user' },
      { user_id: walkerId, role: 'petwalker' },
      { user_id: otherId, role: 'petwalker' }
    ]);

    await supabaseAdmin.from('petwalker_profiles').insert([
      { user_id: walkerId, status: 'active', is_online: true, e2e_test: true },
      { user_id: otherId, status: 'active', is_online: true, e2e_test: true }
    ]);

    const { data: pet, error: petErr } = await supabaseAdmin.from('pets').insert({
      owner_id: ownerId,
      name: `Security Rex`,
      e2e_test: true
    }).select().single();
    
    if (petErr) throw petErr;
    petId = pet!.id;

    const { data: walk, error: walkErr } = await supabaseAdmin.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      current_status: 'accepted',
      status: 'accepted',
      planned_duration_minutes: 30,
      total_price_cents: 4500,
      home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'now',
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    
    if (walkErr) throw walkErr;
    sessionId = walk!.id;
  });

  test.afterAll(async () => {
    await failClosedCleanup(supabaseAdmin, [ownerId, walkerId, otherId], E2E_RUN_ID);
  });

  test('Public/Anon access should be revoked', async () => {
    const { error } = await supabaseAnon.rpc('petwalker_confirm_pickup', {
      _session_id: sessionId,
      _pickup_code: '123456'
    });
    expect(error?.message).toMatch(/permission denied|does not exist/i);
  });

  test('Other walker cannot access PIN or update status', async () => {
    const { data: authData } = await supabaseAdmin.auth.signInWithPassword({
      email: TEST_OTHER,
      password: TEST_PASS
    });
    const supabaseOther = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } }
    });

    const { data: pin } = await supabaseOther.rpc('customer_get_pickup_code', { _session_id: sessionId });
    expect(pin).toBeNull();

    const { error: arriveErr } = await supabaseOther.rpc('petwalker_arrive_pickup', {
      _session_id: sessionId,
      _lat: -23.5505,
      _lng: -46.6333,
      _accuracy: 10
    });
    expect(arriveErr?.message).toMatch(/Somente o Walker designado|Não autorizado/i);
  });

  test('GPS validation hardening', async () => {
    const { data: authData } = await supabaseAdmin.auth.signInWithPassword({
      email: TEST_WALKER,
      password: TEST_PASS
    });
    const supabaseWalker = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } }
    });

    await supabaseAdmin.from('walk_sessions').update({ current_status: 'heading_to_pickup' }).eq('id', sessionId);

    const { error: distErr } = await supabaseWalker.rpc('petwalker_arrive_pickup', {
      _session_id: sessionId,
      _lat: 0,
      _lng: 0,
      _accuracy: 10
    });
    expect(distErr?.message).toMatch(/Walker muito distante/i);

    const { error: accErr } = await supabaseWalker.rpc('petwalker_arrive_pickup', {
      _session_id: sessionId,
      _lat: -23.5505,
      _lng: -46.6333,
      _accuracy: 250
    });
    expect(accErr?.message).toMatch(/Precisão GPS insuficiente/i);
  });

  test('PIN Lifecycle: Attempts, Format, and Blocking', async () => {
    const { data: authData } = await supabaseAdmin.auth.signInWithPassword({
      email: TEST_WALKER,
      password: TEST_PASS
    });
    const supabaseWalker = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } }
    });

    await supabaseAdmin.from('walk_sessions').update({ current_status: 'arrived' }).eq('id', sessionId);

    const { error: fmtErr } = await supabaseWalker.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pickup_code: '123' });
    expect(fmtErr?.message).toMatch(/PIN deve ter exatamente 6 dígitos/i);

    for (let i = 1; i <= 5; i++) {
      const { data: res } = await supabaseWalker.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pickup_code: '000000' });
      expect(res).toBe(false);
      
      const { data: attempts } = await supabaseAdmin.from('walk_pickup_codes').select('attempts').eq('session_id', sessionId).single();
      expect(attempts?.attempts).toBe(i);
    }

    const { error: blockErr } = await supabaseWalker.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pickup_code: '000000' });
    expect(blockErr?.message).toMatch(/bloqueado por excesso de tentativas/i);
  });
});
