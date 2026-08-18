import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const E2E_RUN_ID = `4.3-security-${Date.now()}`;

// 5. LOGIN FAIL-CLOSED Helper
async function getAuthenticatedClient(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: 'VaiPet@2026'
  });
  if (error) throw error;
  if (!data.session) throw new Error(`Failed to establish session for ${email}`);
  return client;
}

test.describe('Phase 4.3: Completion Security Hardening', () => {
  let ownerId: string;
  let wrongOwnerId: string;
  let walkerId: string;
  let petId: string;
  let ownerEmail: string;
  let wrongOwnerEmail: string;
  let walkerEmail: string;

  test.describe.configure({
    mode: 'serial',
    retries: 0
  });

  test.beforeAll(async () => {
    const create = async (email: string, intent: string) => {
      const res = await admin.auth.admin.createUser({
        email,
        password: 'VaiPet@2026',
        email_confirm: true,
        user_metadata: { signup_intent: intent, e2e_test: true, e2e_run_id: E2E_RUN_ID }
      });
      if (res.error) throw res.error;
      const uid = res.data.user!.id;
      
      const { error: pErr } = await admin.from('profiles').update({
        onboarding_completed: true,
        e2e_test: true,
        signup_intent: intent,
        role: intent === 'petwalker' ? 'petwalker' : 'user'
      }).eq('id', uid);
      if (pErr) throw pErr;

      await admin.from('user_roles').delete().eq('user_id', uid);
      const { error: rErr } = await admin.from('user_roles').insert([
        { user_id: uid, role: 'user' },
        ...(intent === 'petwalker' ? [{ user_id: uid, role: 'petwalker' }] : [])
      ]);
      if (rErr) throw rErr;

      return uid;
    };

    ownerEmail = `owner-${E2E_RUN_ID}@test.com`;
    wrongOwnerEmail = `wrong-${E2E_RUN_ID}@test.com`;
    walkerEmail = `walker-${E2E_RUN_ID}@test.com`;

    ownerId = await create(ownerEmail, 'pet_owner');
    wrongOwnerId = await create(wrongOwnerEmail, 'pet_owner');
    walkerId = await create(walkerEmail, 'petwalker');

    const { error: wpErr } = await admin.from('petwalker_profiles').upsert({
      user_id: walkerId,
      approval_status: 'approved',
      profile_completed: true,
      availability_status: 'busy',
      e2e_test: true
    });
    if (wpErr) throw wpErr;

    const { data: pet, error: petErr } = await admin.from('pets').insert({
      owner_id: ownerId,
      name: 'E2E Security Pet',
      breed: 'Vira-lata',
      weight: 10,
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    if (petErr) throw petErr;
    petId = pet.id;
  });

  test.afterAll(async () => {
    await failClosedCleanup(admin, [ownerId, wrongOwnerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID);
  });

  async function createSession(status: string) {
    const { data, error } = await admin.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      status: status,
      current_status: status,
      walk_type: 'livre',
      start_time: new Date(Date.now() - 3600000 * 2).toISOString(),
      planned_duration_minutes: 60,
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    if (error) throw error;
    return data;
  }

  // 7. TESTE COMPLETO DE AUTORIDADE
  test('A. Owner correto: in_progress -> customer_request_return', async () => {
    const session = await createSession('in_progress');
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await ownerClient.rpc('customer_request_return', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    
    const { data: updated } = await admin.from('walk_sessions').select('current_status').eq('id', session.id).single();
    expect(updated.current_status).toBe('returning');
  });

  test('B. Wrong Owner: request_return -> 42501', async () => {
    const session = await createSession('in_progress');
    const wrongClient = await getAuthenticatedClient(wrongOwnerEmail);
    const { error } = await wrongClient.rpc('customer_request_return', { _session_id: session.id });
    expect(error?.code).toBe('42501');
    
    const { data: updated } = await admin.from('walk_sessions').select('current_status').eq('id', session.id).single();
    expect(updated.current_status).toBe('in_progress');
  });

  test('C. Walker: request_return -> 42501', async () => {
    const session = await createSession('in_progress');
    const walkerClient = await getAuthenticatedClient(walkerEmail);
    const { error } = await walkerClient.rpc('customer_request_return', { _session_id: session.id });
    expect(error?.code).toBe('42501');
    
    const { data: updated } = await admin.from('walk_sessions').select('current_status').eq('id', session.id).single();
    expect(updated.current_status).toBe('in_progress');
  });

  test('D. Replay request_return: first true, second false', async () => {
    const session = await createSession('in_progress');
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    
    const res1 = await ownerClient.rpc('customer_request_return', { _session_id: session.id });
    expect(res1.data).toBe(true);
    
    const res2 = await ownerClient.rpc('customer_request_return', { _session_id: session.id });
    expect(res2.data).toBe(false);
  });

  test('E. Owner correto: returning -> customer_confirm_arrival', async () => {
    const session = await createSession('returning');
    
    // 6. current_walk_id — PROVA REAL
    await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);
    const { data: before } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(before.current_walk_id).toBe(session.id);

    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    
    // 8. COMPLETION AUDIT
    const { data: updated } = await admin.from('walk_sessions').select('*').eq('id', session.id).single();
    expect(updated.current_status).toBe('completed');
    expect(updated.status).toBe('completed');
    expect(updated.end_time).not.toBeNull();
    expect(updated.actual_duration_minutes).toBeGreaterThanOrEqual(1);
    expect(updated.distance_km).toBe(0); // No tracking points inserted for this session

    const { data: after } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(after.current_walk_id).toBeNull();
  });

  test('F. CONFIRM BEFORE RETURNING REAL', async () => {
    const session = await createSession('in_progress');
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const { data, error } = await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(false);
    
    const { data: updated } = await admin.from('walk_sessions').select('current_status').eq('id', session.id).single();
    expect(updated.current_status).toBe('in_progress');
  });

  test('G. WRONG OWNER CONFIRM -> 42501', async () => {
    const session = await createSession('returning');
    const wrongClient = await getAuthenticatedClient(wrongOwnerEmail);
    const { error } = await wrongClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error?.code).toBe('42501');
    
    const { data: updated } = await admin.from('walk_sessions').select('current_status').eq('id', session.id).single();
    expect(updated.current_status).toBe('returning');
  });

  test('H. WALKER CONFIRM -> 42501', async () => {
    const session = await createSession('returning');
    const walkerClient = await getAuthenticatedClient(walkerEmail);
    const { error } = await walkerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(error?.code).toBe('42501');
    
    const { data: updated } = await admin.from('walk_sessions').select('current_status').eq('id', session.id).single();
    expect(updated.current_status).toBe('returning');
  });

  test('I. Replay confirm: first true, second false', async () => {
    const session = await createSession('returning');
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    
    const res1 = await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(res1.data).toBe(true);
    
    const res2 = await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(res2.data).toBe(false);
  });

  test('J. petwalker_complete_walk: security check', async () => {
    const session = await createSession('returning');
    const walkerClient = await getAuthenticatedClient(walkerEmail);
    
    const { error } = await walkerClient.rpc('petwalker_complete_walk', { _session_id: session.id });
    expect(error?.code).toBe('42501');

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const resAnon = await anonClient.rpc('petwalker_complete_walk', { _session_id: session.id });
    expect(resAnon.error?.code).toBe('42501');
  });

  test('3. DISTÂNCIA — CONTRATO EXPLÍCITO (0, 1, 2+ points)', async () => {
    const ownerClient = await getAuthenticatedClient(ownerEmail);

    // 0 points
    const s0 = await createSession('returning');
    await ownerClient.rpc('customer_confirm_arrival', { _session_id: s0.id });
    const { data: d0 } = await admin.from('walk_sessions').select('distance_km').eq('id', s0.id).single();
    expect(d0.distance_km).toBe(0);

    // 1 point
    const s1 = await createSession('returning');
    await admin.from('walker_tracking').insert({ walk_session_id: s1.id, walker_id: walkerId, location: 'POINT(-46.6333 -23.5505)' });
    await ownerClient.rpc('customer_confirm_arrival', { _session_id: s1.id });
    const { data: d1 } = await admin.from('walk_sessions').select('distance_km').eq('id', s1.id).single();
    expect(d1.distance_km).toBe(0);

    // 2 points
    const s2 = await createSession('returning');
    await admin.from('walker_tracking').insert([
      { walk_session_id: s2.id, walker_id: walkerId, location: 'POINT(-46.6333 -23.5505)' },
      { walk_session_id: s2.id, walker_id: walkerId, location: 'POINT(-46.6343 -23.5515)' }
    ]);
    await ownerClient.rpc('customer_confirm_arrival', { _session_id: s2.id });
    const { data: d2 } = await admin.from('walk_sessions').select('distance_km').eq('id', s2.id).single();
    expect(d2.distance_km).toBeGreaterThan(0);
  });

  test('9. TRACKING FREEZE REAL', async () => {
    const session = await createSession('returning');
    await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);
    
    // Add valid tracking
    await admin.from('walker_tracking').insert({ walk_session_id: session.id, walker_id: walkerId, location: 'POINT(-46.6333 -23.5505)' });
    
    const { count: countBefore } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session.id);
    const { data: sessionBefore } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session.id).single();

    const ownerClient = await getAuthenticatedClient(ownerEmail);
    await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });

    // Confirm frozen
    const walkerClient = await getAuthenticatedClient(walkerEmail);
    // update_walker_location depends on current_walk_id in profile. We proved it is NULL above.
    await walkerClient.rpc('update_walker_location', { _lat: -23.5525, _lng: -46.6353, _accuracy: 10, _captured_at: Date.now() });

    const { count: countAfter } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session.id);
    const { data: sessionAfter } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session.id).single();

    expect(countAfter).toBe(countBefore);
    expect(sessionAfter.route_coordinates).toEqual(sessionBefore.route_coordinates);
  });

  test('10. CONCORRÊNCIA: dual confirmation', async () => {
    const session = await createSession('returning');
    await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);

    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const [res1, res2] = await Promise.all([
      ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id }),
      ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id })
    ]);

    const results = [res1.data, res2.data];
    expect(results).toContain(true);
    expect(results).toContain(false);
    
    const { data: updated } = await admin.from('walk_sessions').select('*').eq('id', session.id).single();
    expect(updated.current_status).toBe('completed');
    expect(updated.status).toBe('completed');
    expect(updated.end_time).not.toBeNull();
    
    const { data: walker } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(walker.current_walk_id).toBeNull();
  });

  test('1. STATE MACHINE — CORRIGIR BYPASS status/current_status', async () => {
    const session = await createSession('in_progress');
    
    // Attempt bypass via status='completed' directly
    const { error } = await admin.from('walk_sessions').update({ status: 'completed' }).eq('id', session.id);
    // Trigger fn_validate_walk_status_transition_v5 will raise exception
    expect(error).not.toBeNull();
    
    const { data: check } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(check.current_status).toBe('in_progress');
    expect(check.status).toBe('in_progress');
  });
});