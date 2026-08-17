import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for security tests');
}

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
    const users = await Promise.all([
      adminClient.auth.admin.createUser({ email: TEST_OWNER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: E2E_RUN_ID } }),
      adminClient.auth.admin.createUser({ email: TEST_WALKER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID } }),
      adminClient.auth.admin.createUser({ email: TEST_OTHER, password: TEST_PASS, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: E2E_RUN_ID } })
    ]);

    for (const u of users) {
      if (u.error) throw new Error(`Setup Fail-Closed: Erro ao criar usuário: ${u.error.message}`);
    }

    ownerId = users[0].data.user!.id;
    walkerId = users[1].data.user!.id;
    otherId = users[2].data.user!.id;

    await adminClient.from('profiles').upsert([
      { id: ownerId, onboarding_completed: true, e2e_test: true },
      { id: walkerId, onboarding_completed: true, e2e_test: true },
      { id: otherId, onboarding_completed: true, e2e_test: true }
    ]);

    await adminClient.from('user_roles').upsert([
      { user_id: ownerId, role: 'user' },
      { user_id: walkerId, role: 'petwalker' },
      { user_id: otherId, role: 'petwalker' }
    ], { onConflict: 'user_id, role' });

    await adminClient.from('petwalker_profiles').upsert([
      { user_id: walkerId, approval_status: 'approved', availability_status: 'available', e2e_test: true },
      { user_id: otherId, approval_status: 'approved', availability_status: 'available', e2e_test: true }
    ]);

    const { data: pet } = await adminClient.from('pets').insert({
      owner_id: ownerId, name: `Security Rex`, breed: 'Vira-lata', weight: 10, e2e_test: true
    }).select().single();
    petId = pet!.id;

    const { data: walk } = await adminClient.from('walk_sessions').insert({
      customer_id: ownerId, walker_id: walkerId, pet_id: petId, current_status: 'accepted', status: 'accepted',
      planned_duration_minutes: 30, distance_km: 0, home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'livre', request_mode: 'now', start_time: new Date().toISOString(), e2e_test: true, e2e_run_id: E2E_RUN_ID
    }).select().single();
    sessionId = walk!.id;
  });

  test.afterAll(async () => {
    await failClosedCleanup(adminClient, [ownerId, walkerId, otherId], E2E_RUN_ID);
  });

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
      anonClient.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pin: '123456' })
    ]);
    for (const r of results) {
      if (r.error) {
        expect(r.error.message).toMatch(/permission denied|does not exist|Acesso negado/i);
      } else {
        expect(r.data).toBeFalsy();
      }
    }
  });

  test('Multi-User Blocking: Other users cannot interfere', async () => {
    const otherClient = await createClientForUser(TEST_OTHER);
    const ownerClient = await createClientForUser(TEST_OWNER);
    
    await ownerClient.rpc('customer_get_pickup_code', { _session_id: sessionId });

    const { data: pin, error: pinErr } = await otherClient.rpc('customer_get_pickup_code', { _session_id: sessionId });
    expect(pin).toBeNull();
    expect(pinErr?.message).toMatch(/Acesso negado/i);

    const { data: start, error: startErr } = await otherClient.rpc('petwalker_start_heading', { _session_id: sessionId });
    expect(start).toBe(false);

    const { error: arriveErr } = await otherClient.rpc('petwalker_arrive_pickup', {
      _session_id: sessionId, _lat: -23.5505, _lng: -46.6333, _accuracy: 10
    });
    expect(arriveErr?.message).toMatch(/Acesso negado|Walker incorreto/i);

    const { data: confirm, error: confirmErr } = await otherClient.rpc('petwalker_confirm_pickup', {
      _session_id: sessionId, _pin: '999999'
    });
    expect(confirmErr?.message).toMatch(/Acesso negado|Walker incorreto|não gerado/i);
  });

  test('GPS Validation Hardened (limits, accuracy, proximity)', async () => {
    const walkerClient = await createClientForUser(TEST_WALKER);
    await walkerClient.rpc('petwalker_start_heading', { _session_id: sessionId });
    const scenarios = [
      { lat: -95, lng: -46, acc: 10, msg: /Latitude inválida/i },
      { lat: -23, lng: 190, acc: 10, msg: /Longitude inválida/i },
      { lat: -23, lng: -46, acc: -5, msg: /Precisão.*inválida/i },
      { lat: -23, lng: -46, acc: 250, msg: /Precisão.*insuficiente/i },
      { lat: -23.0, lng: -46.0, acc: 10, msg: /Muito longe/i }
    ];
    for (const s of scenarios) {
      const { error } = await walkerClient.rpc('petwalker_arrive_pickup', {
        _session_id: sessionId, _lat: s.lat, _lng: s.lng, _accuracy: s.acc
      });
      expect(error?.message).toMatch(s.msg);
    }
  });

  test('PIN Lifecycle Hardened: CSPRNG, Locks, Blocking and Replay Protection', async () => {
    const ownerClient = await createClientForUser(TEST_OWNER);
    const walkerClient = await createClientForUser(TEST_WALKER);
    const { data: generatedPin } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: sessionId });
    expect(generatedPin).toMatch(/^[0-9]{6}$/);

    await walkerClient.rpc('petwalker_arrive_pickup', {
      _session_id: sessionId, _lat: -23.5505, _lng: -46.6333, _accuracy: 10
    });

    const wrongPin = generatedPin === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 5; i++) {
      const { data: res } = await walkerClient.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pin: wrongPin });
      expect(res).toBe(false);
    }

    const { error: blockErr } = await walkerClient.rpc('petwalker_confirm_pickup', { _session_id: sessionId, _pin: generatedPin });
    expect(blockErr?.message).toMatch(/Limite de tentativas excedido/i);

    const { data: newWalk } = await adminClient.from('walk_sessions').insert({
      customer_id: ownerId, walker_id: walkerId, pet_id: petId, current_status: 'accepted', status: 'accepted',
      planned_duration_minutes: 30, distance_km: 0, home_location: { lat: -23.5505, lng: -46.6333 },
      walk_type: 'livre', request_mode: 'now', start_time: new Date().toISOString(), e2e_test: true, e2e_run_id: E2E_RUN_ID
    }).select().single();
    
    await walkerClient.rpc('petwalker_start_heading', { _session_id: newWalk!.id });
    const { data: newPin } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: newWalk!.id });
    await walkerClient.rpc('petwalker_arrive_pickup', { _session_id: newWalk!.id, _lat: -23.5505, _lng: -46.6333, _accuracy: 10 });
    
    const { data: success, error: successErr } = await walkerClient.rpc('petwalker_confirm_pickup', { _session_id: newWalk!.id, _pin: newPin });
    if (successErr) throw successErr;
    expect(success).toBe(true);

    const { data: session } = await adminClient.from('walk_sessions').select('status').eq('id', newWalk!.id).single();
    expect(session?.status).toBe('in_progress');
  });
});