import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for security tests');
}

// 1. Admin Client Exclusivo para Setup/Cleanup/Inspeção (Nunca SignIn)
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const E2E_RUN_ID = `4.1-sec-${Date.now()}`;
const TEST_OWNER = `owner-sec-${E2E_RUN_ID}@example.com`;
const TEST_WALKER = `walker-sec-${E2E_RUN_ID}@example.com`;
const TEST_OTHER = `other-sec-${E2E_RUN_ID}@example.com`;
const TEST_PASS = 'VaiPet@2026';

test.describe('Phase 4.1: Zero-Trust Security Validation (Comprehensive)', () => {
  let ownerId: string;
  let walkerId: string;
  let otherId: string;
  let sessionId: string;
  let petId: string;

  test.beforeAll(async () => {
    // 2. Setup Fail-Closed com verificação de erro em todas as etapas
    const users = await Promise.all([
      adminClient.auth.admin.createUser({ email: TEST_OWNER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: E2E_RUN_ID } }),
      adminClient.auth.admin.createUser({ email: TEST_WALKER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID } }),
      adminClient.auth.admin.createUser({ email: TEST_OTHER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID } })
    ]);

    for (const u of users) {
      if (u.error) throw new Error(`Setup Fail-Closed: Erro ao criar usuário: ${u.error.message}`);
      if (!u.data.user) throw new Error(`Setup Fail-Closed: Usuário não retornado após criação.`);
    }

    ownerId = users[0].data.user!.id;
    walkerId = users[1].data.user!.id;
    otherId = users[2].data.user!.id;

    const { error: profErr } = await adminClient.from('profiles').upsert([
      { id: ownerId, onboarding_completed: true, e2e_test: true },
      { id: walkerId, onboarding_completed: true, e2e_test: true },
      { id: otherId, onboarding_completed: true, e2e_test: true }
    ]);
    if (profErr) throw profErr;

    // Trigger handles 'user' role creation, skip manual insert for owner to avoid 23505
    const { error: roleErr } = await adminClient.from('user_roles').upsert([
      { user_id: walkerId, role: 'petwalker' },
      { user_id: otherId, role: 'petwalker' }
    ]);
    if (roleErr) throw roleErr;

    const { error: walkerErr } = await adminClient.from('petwalker_profiles').upsert([
      { user_id: walkerId, status: 'active', is_online: true, e2e_test: true },
      { user_id: otherId, status: 'active', is_online: true, e2e_test: true }
    ]);
    if (walkerErr) throw walkerErr;

    const { data: pet, error: petErr } = await adminClient.from('pets').insert({
      owner_id: ownerId,
      name: `Security Rex`,
      breed: 'Vira-lata',
      weight: 10,
      e2e_test: true
    }).select().single();
    if (petErr) throw petErr;
    petId = pet!.id;

    const { data: walk, error: walkErr } = await adminClient.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      current_status: 'accepted',
      status: 'accepted',
      planned_duration_minutes: 30,
      total_price_cents: 4500,
      home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'livre',
      request_mode: 'now',
      start_time: new Date().toISOString(),
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    if (walkErr) throw walkErr;
    sessionId = walk!.id;
  });

  test.afterAll(async () => {
    // 3. Cleanup Fail-Closed (Qualquer erro falha o teste)
    await failClosedCleanup(adminClient, [ownerId, walkerId, otherId], E2E_RUN_ID);
  });

  // Auxiliar para criar cliente autenticado sem mutar o admin
  const createClientForUser = async (email: string) => {
    const tempAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await tempAdmin.auth.signInWithPassword({ email, password: TEST_PASS });
    if (error) throw error;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${data.session?.access_token}` } }
    });
  };

  test('Public/Anon access denied (Zero-Trust)', async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    const results = await Promise.all([
      anonClient.rpc('customer_get_pickup_code', { _session_id: sessionId }),
      anonClient.rpc('petwalker_start_heading', { _session_id: sessionId }),
      anonClient.rpc('petwalker_arrive_pickup', { _session_id: sessionId, _lat: -23.55, _lng: -46.63 }),
      anonClient.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pickup_code: '123456' })
    ]);

    for (const r of results) {
      expect(r.error?.message).toMatch(/permission denied|does not exist/i);
    }
  });

  test('Multi-User Blocking: Other users cannot interfere', async () => {
    const otherClient = await createClientForUser(TEST_OTHER);

    // Other walker cannot get PIN
    const { data: pin, error: pinErr } = await otherClient.rpc('customer_get_pickup_code', { _session_id: sessionId });
    expect(pin).toBeNull();
    expect(pinErr?.message).toMatch(/Acesso negado/i);

    // Other walker cannot start heading
    const { data: start, error: startErr } = await otherClient.rpc('petwalker_start_heading', { _session_id: sessionId });
    expect(start).toBe(false);

    // Other walker cannot arrive at pickup
    const { error: arriveErr } = await otherClient.rpc('petwalker_arrive_pickup', {
      _session_id: sessionId,
      _lat: -23.5505,
      _lng: -46.6333,
      _accuracy: 10
    });
    expect(arriveErr?.message).toMatch(/Walker incorreto/i);

    // Another Walker's failed PIN attempts should not increment legitimate walker's count
    const { data: confirm, error: confirmErr } = await otherClient.rpc('petwalker_confirm_pickup', {
      _session_id: sessionId,
      _pickup_code: '999999'
    });
    expect(confirmErr?.message).toMatch(/Walker incorreto/i);

    const { data: attemptsAfterOther } = await adminClient.from('walk_pickup_codes').select('attempts').eq('session_id', sessionId).single();
    expect(attemptsAfterOther?.attempts || 0).toBe(0);
  });

  test('GPS Validation Hardened (limits, accuracy, proximity)', async () => {
    const walkerClient = await createClientForUser(TEST_WALKER);

    // Move to heading_to_pickup
    await walkerClient.rpc('petwalker_start_heading', { _session_id: sessionId });

    const scenarios = [
      { lat: -95, lng: -46, acc: 10, msg: /Latitude inválida/i },
      { lat: -23, lng: 190, acc: 10, msg: /Longitude inválida/i },
      { lat: -23, lng: -46, acc: -5, msg: /Precisão.*inválida/i },
      { lat: -23, lng: -46, acc: 250, msg: /Precisão.*insuficiente/i },
      { lat: -23.0, lng: -46.0, acc: 10, msg: /Muito longe/i } // Distant coordinate
    ];

    for (const s of scenarios) {
      const { error } = await walkerClient.rpc('petwalker_arrive_pickup', {
        _session_id: sessionId,
        _lat: s.lat,
        _lng: s.lng,
        _accuracy: s.acc
      });
      expect(error?.message).toMatch(s.msg);
    }
  });

  test('PIN Lifecycle Hardened: CSPRNG, Locks, Blocking and Replay Protection', async () => {
    const ownerClient = await createClientForUser(TEST_OWNER);
    const walkerClient = await createClientForUser(TEST_WALKER);

    // 1. PIN Format and Generation
    const { data: generatedPin, error: pinErr } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: sessionId });
    if (pinErr) throw pinErr;
    expect(generatedPin).toMatch(/^[0-9]{6}$/);

    // 2. Arrive at pickup
    const { error: arriveErr } = await walkerClient.rpc('petwalker_arrive_pickup', {
      _session_id: sessionId,
      _lat: -23.5505,
      _lng: -46.6333,
      _accuracy: 10
    });
    if (arriveErr) throw arriveErr;

    // 3. Failed attempts (Exactly 5)
    // Use a code guaranteed different from the generated one
    const wrongPin = generatedPin === '000000' ? '111111' : '000000';
    
    for (let i = 1; i <= 5; i++) {
      const { data: res } = await walkerClient.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pickup_code: wrongPin });
      expect(res).toBe(false);
      
      const { data: check } = await adminClient.from('walk_pickup_codes').select('attempts').eq('session_id', sessionId).single();
      expect(check?.attempts).toBe(i);
    }

    // 4. Sixth attempt blocked
    const { error: blockErr } = await walkerClient.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pickup_code: generatedPin });
    expect(blockErr?.message).toMatch(/bloqueado/i);

    // 5. Success Flow (New Session to reset attempts for success test)
    const { data: newWalk } = await adminClient.from('walk_sessions').insert({
      customer_id: ownerId, walker_id: walkerId, pet_id: petId, current_status: 'accepted', status: 'accepted',
      planned_duration_minutes: 30, total_price_cents: 4500, home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'livre', request_mode: 'now', e2e_test: true, e2e_run_id: E2E_RUN_ID
    }).select().single();
    const newSessionId = newWalk!.id;

    await walkerClient.rpc('petwalker_start_heading', { _session_id: newSessionId });
    const { data: newPin } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: newSessionId });
    await walkerClient.rpc('petwalker_arrive_pickup', { _session_id: newSessionId, _lat: -23.5505, _lng: -46.6333, _accuracy: 10 });
    
    const { data: success, error: successErr } = await walkerClient.rpc('petwalker_confirm_pickup', { _session_id: newSessionId, _pickup_code: newPin });
    if (successErr) throw successErr;
    expect(success).toBe(true);

    // 6. Verification: status = in_progress, pickup_confirmed_at filled, PIN deleted (Replay)
    const { data: session } = await adminClient.from('walk_sessions').select('*').eq('id', newSessionId).single();
    expect(session?.current_status).toBe('in_progress');
    expect(session?.pickup_confirmed_at).not.toBeNull();
    
    const { data: pinExists } = await adminClient.from('walk_pickup_codes').select('pin_hash').eq('session_id', newSessionId).single();
    expect(pinExists).toBeNull();

    // 7. Replay Protection
    const { error: replayErr } = await walkerClient.rpc('petwalker_confirm_pickup', { _session_id: newSessionId, _pickup_code: newPin });
    expect(replayErr?.message).toMatch(/PIN não gerado/i);
  });
});
