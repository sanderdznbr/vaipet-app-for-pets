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

test.describe('Phase 4.3: Completion Security Hardening (Patch 1B)', () => {
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

      const { error: delErr } = await admin.from('user_roles').delete().eq('user_id', uid);
      if (delErr) throw delErr;
      
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

  test('1. UPDATE CONFLITANTE: status != current_status -> Fail-closed', async () => {
    const session = await createSession('in_progress');
    
    // Attempt divergent update
    const { error } = await admin.from('walk_sessions').update({ 
      current_status: 'returning', 
      status: 'completed' 
    }).eq('id', session.id);
    
    expect(error).not.toBeNull();
    
    const { data: check, error: checkErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    if (checkErr) throw checkErr;
    expect(check.status).toBe('in_progress');
    expect(check.current_status).toBe('in_progress');
    
    // Provar cenário válido
    const { error: validErr } = await admin.from('walk_sessions').update({
      status: 'returning',
      current_status: 'returning'
    }).eq('id', session.id);
    expect(validErr).toBeNull();
    
    const { data: validCheck, error: vCheckErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    if (vCheckErr) throw vCheckErr;
    expect(validCheck.status).toBe('returning');
    expect(validCheck.current_status).toBe('returning');
  });

  test('4-6. TRACKING FREEZE E RELEASE: Prova Real', async () => {
    const session = await createSession('returning');
    
    const { error: upErr } = await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);
    if (upErr) throw upErr;
    
    const { data: profBefore, error: pbErr } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    if (pbErr) throw pbErr;
    expect(profBefore.current_walk_id).toBe(session.id);

    const walkerClient = await getAuthenticatedClient(walkerEmail);
    
    // RPC Canônica para produzir o ponto
    const capturedAt = Date.now();
    const { data: locData, error: locErr } = await walkerClient.rpc('update_walker_location', {
      _lat: -23.5505,
      _lng: -46.6333,
      _accuracy: 10,
      _captured_at: capturedAt
    });
    expect(locErr).toBeNull();
    expect(locData).toBe(true);
    
    const { data: sessionBefore, error: sbErr } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session.id).single();
    if (sbErr) throw sbErr;
    expect(Array.isArray(sessionBefore.route_coordinates)).toBe(true);
    expect(sessionBefore.route_coordinates.length).toBeGreaterThan(0);
    
    const { count: countBefore, error: cbErr } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session.id);
    if (cbErr) throw cbErr;
    expect(countBefore).toBeGreaterThan(0);

    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const { data: confirmData, error: confirmErr } = await ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id });
    expect(confirmErr).toBeNull();
    expect(confirmData).toBe(true);
    
    const { data: sessionAfterConfirm, error: sacErr } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    if (sacErr) throw sacErr;
    expect(sessionAfterConfirm.status).toBe('completed');
    
    const { data: profAfter, error: paErr } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    if (paErr) throw paErr;
    expect(profAfter.current_walk_id).toBeNull();

    // GPS DEPOIS DE COMPLETED
    const { data: postData, error: postErr } = await walkerClient.rpc('update_walker_location', {
      _lat: -23.5515,
      _lng: -46.6343,
      _accuracy: 10,
      _captured_at: capturedAt + 10000
    });
    expect(postErr).toBeNull();
    expect(postData).toBe(true);
    
    const { data: sessionFinal, error: sfErr } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session.id).single();
    if (sfErr) throw sfErr;
    const { count: countFinal, error: cfErr } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session.id);
    if (cfErr) throw cfErr;
    
    expect(countFinal).toBe(countBefore);
    expect(sessionFinal.route_coordinates).toEqual(sessionBefore.route_coordinates);
  });

  test('9. CONCORRÊNCIA: exactly 1 true, 1 false', async () => {
    const session = await createSession('returning');
    await admin.from('petwalker_profiles').update({ current_walk_id: session.id }).eq('user_id', walkerId);
    
    const { data: checkProf } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(checkProf.current_walk_id).toBe(session.id);

    const ownerClient = await getAuthenticatedClient(ownerEmail);
    const [res1, res2] = await Promise.all([
      ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id }),
      ownerClient.rpc('customer_confirm_arrival', { _session_id: session.id })
    ]);

    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();
    
    const results = [res1.data, res2.data];
    expect(results.filter(v => v === true)).toHaveLength(1);
    expect(results.filter(v => v === false)).toHaveLength(1);
    
    const { data: updated } = await admin.from('walk_sessions').select('status, end_time').eq('id', session.id).single();
    expect(updated.status).toBe('completed');
    expect(updated.end_time).not.toBeNull();
    
    const { data: walker } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(walker.current_walk_id).toBeNull();
  });

  test('10. SERVICE ROLE SAFETY: in_progress -> completed blocked', async () => {
    const session = await createSession('in_progress');
    
    const { data, error } = await admin.rpc('petwalker_complete_walk', { _session_id: session.id });
    expect(error).toBeNull();
    expect(data).toBe(false);
    
    const { data: check } = await admin.from('walk_sessions').select('status, current_status').eq('id', session.id).single();
    expect(check.status).toBe('in_progress');
    expect(check.current_status).toBe('in_progress');
  });

  test('8. DISTANCE CONTRACT: fail-closed validation', async () => {
    const ownerClient = await getAuthenticatedClient(ownerEmail);
    
    const s2 = await createSession('returning');
    const { error: i1 } = await admin.from('walker_tracking').insert({ walk_session_id: s2.id, walker_id: walkerId, location: 'POINT(-46.6333 -23.5505)' });
    expect(i1).toBeNull();
    const { error: i2 } = await admin.from('walker_tracking').insert({ walk_session_id: s2.id, walker_id: walkerId, location: 'POINT(-46.6343 -23.5515)' });
    expect(i2).toBeNull();
    
    const { data, error } = await ownerClient.rpc('customer_confirm_arrival', { _session_id: s2.id });
    expect(error).toBeNull();
    expect(data).toBe(true);
    
    const { data: dist } = await admin.from('walk_sessions').select('distance_km').eq('id', s2.id).single();
    expect(dist.distance_km).toBeGreaterThan(0);
  });
});