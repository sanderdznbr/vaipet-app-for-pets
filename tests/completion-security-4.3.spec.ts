import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const E2E_RUN_ID = `4.3-security-${Date.now()}`;

test.describe('Phase 4.3: Completion Security Hardening', () => {
  let ownerId: string;
  let wrongOwnerId: string;
  let walkerId: string;
  let sessionId: string;
  let petId: string;

  test.beforeAll(async () => {
    // 1. Setup Users
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

      // Clean existing roles first to avoid collision
      await admin.from('user_roles').delete().eq('user_id', uid);

      const { error: rErr } = await admin.from('user_roles').insert([
        { user_id: uid, role: 'user' },
        ...(intent === 'petwalker' ? [{ user_id: uid, role: 'petwalker' }] : [])
      ]);
      if (rErr) throw rErr;

      return uid;
    };

    try {
      ownerId = await create(`owner-${E2E_RUN_ID}@test.com`, 'pet_owner');
      wrongOwnerId = await create(`wrong-${E2E_RUN_ID}@test.com`, 'pet_owner');
      walkerId = await create(`walker-${E2E_RUN_ID}@test.com`, 'petwalker');

      // 2. Walker Profile
      const { error: wpErr } = await admin.from('petwalker_profiles').upsert({
        user_id: walkerId,
        approval_status: 'approved',
        profile_completed: true,
        availability_status: 'busy',
        e2e_test: true
      });
      if (wpErr) throw wpErr;

      // 3. Pet
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

      // 4. Session Setup (Starting at in_progress)
      const { data: session, error: sErr } = await admin.from('walk_sessions').insert({
        customer_id: ownerId,
        walker_id: walkerId,
        pet_id: petId,
        status: 'in_progress',
        current_status: 'in_progress',
        walk_type: 'livre',
        start_time: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
        planned_duration_minutes: 60, // Multiple of 15


        e2e_test: true,
        e2e_run_id: E2E_RUN_ID
      }).select().single();
      if (sErr) throw sErr;
      sessionId = session.id;

      // 5. Add tracking points
      const { error: tErr } = await admin.from('walker_tracking').insert([
        { walk_session_id: sessionId, walker_id: walkerId, location: 'POINT(-46.6333 -23.5505)', accuracy: 10 },
        { walk_session_id: sessionId, walker_id: walkerId, location: 'POINT(-46.6343 -23.5515)', accuracy: 10 }
      ]);
      if (tErr) throw tErr;
    } catch (e) {
      console.error('Setup failed:', e);
      // Cleanup what was created
      await failClosedCleanup(admin, [ownerId, wrongOwnerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID);
      throw e;
    }
  });

  test.afterAll(async () => {
    await failClosedCleanup(admin, [ownerId, wrongOwnerId, walkerId].filter(Boolean) as string[], E2E_RUN_ID);
  });


  const getClient = (uid: string) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });

  test('Authority: Only Owner can request return', async () => {
    const walkerClient = getClient(walkerId);
    const wrongClient = getClient(wrongOwnerId);
    const ownerClient = getClient(ownerId);

    // Login for JWT
    await walkerClient.auth.signInWithPassword({ email: `walker-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });
    await wrongClient.auth.signInWithPassword({ email: `wrong-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });
    await ownerClient.auth.signInWithPassword({ email: `owner-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });

    // C. Walker blocked
    const resWalker = await walkerClient.rpc('customer_request_return', { _session_id: sessionId });
    expect(resWalker.error).not.toBeNull();
    expect(resWalker.error?.code).toBe('42501');

    // B. Wrong Owner blocked
    const resWrong = await wrongClient.rpc('customer_request_return', { _session_id: sessionId });
    expect(resWrong.error).not.toBeNull();
    expect(resWrong.error?.code).toBe('42501');

    // A. Correct Owner success
    const resOwner = await ownerClient.rpc('customer_request_return', { _session_id: sessionId });
    expect(resOwner.error).toBeNull();
    expect(resOwner.data).toBe(true);

    // D. Replay check
    const resReplay = await ownerClient.rpc('customer_request_return', { _session_id: sessionId });
    expect(resReplay.data).toBe(false); // Already 'returning'
  });

  test('Authority: Only Owner can confirm arrival', async () => {
    const walkerClient = getClient(walkerId);
    const ownerClient = getClient(ownerId);
    
    await walkerClient.auth.signInWithPassword({ email: `walker-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });
    await ownerClient.auth.signInWithPassword({ email: `owner-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });

    // H. Walker blocked
    const resWalker = await walkerClient.rpc('customer_confirm_arrival', { _session_id: sessionId });
    expect(resWalker.error).not.toBeNull();
    expect(resWalker.error?.code).toBe('42501');

    // F. confirm before returning state (session is now 'returning' from previous test, so we need a new session or check logic)
    // We already moved to 'returning' in the previous test. If we try to confirm it should work.

    // E. Correct Owner success + K. Completion Audit
    const resOwner = await ownerClient.rpc('customer_confirm_arrival', { _session_id: sessionId });
    expect(resOwner.error).toBeNull();
    expect(resOwner.data).toBe(true);

    // Verify Completion
    const { data: finalSession, error: fsErr } = await admin.from('walk_sessions').select('*').eq('id', sessionId).single();
    expect(fsErr).toBeNull();
    expect(finalSession.status).toBe('completed');
    expect(finalSession.current_status).toBe('completed');
    expect(finalSession.end_time).not.toBeNull();
    expect(finalSession.actual_duration_minutes).toBeGreaterThanOrEqual(60); // 1 hour ago
    expect(finalSession.distance_km).toBeGreaterThan(0);

    // Check Walker released
    const { data: walkerProf, error: wpErr } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', walkerId).single();
    expect(wpErr).toBeNull();
    expect(walkerProf.current_walk_id).toBeNull();

    // I. Replay false
    const resReplay = await ownerClient.rpc('customer_confirm_arrival', { _session_id: sessionId });
    expect(resReplay.data).toBe(false);
  });

  test('Security: petwalker_complete_walk is blocked for authenticated', async () => {
    const walkerClient = getClient(walkerId);
    await walkerClient.auth.signInWithPassword({ email: `walker-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });

    // J. petwalker_complete_walk revoked
    const res = await walkerClient.rpc('petwalker_complete_walk', { _session_id: sessionId });
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe('42501');
  });

  test('Post-completion tracking lockdown', async () => {
    // M. new update_walker_location for completed session
    // Since petwalker_profiles.current_walk_id is NULL, update_walker_location won't insert tracking.
    
    // Check initial counts
    const { count: countBefore } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionId);

    // Simulate update call via service role (since current_walk_id is null, it should skip insert)
    // Actually, update_walker_location uses current_walk_id from petwalker_profiles.
    // If we call it for a walker who just finished, current_walk_id is NULL.
    
    const walkerClient = getClient(walkerId);
    await walkerClient.auth.signInWithPassword({ email: `walker-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });
    
    await walkerClient.rpc('update_walker_location', { _lat: -23.5525, _lng: -46.6353, _accuracy: 10 });
    
    const { count: countAfter } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', sessionId);
    expect(countAfter).toBe(countBefore);
  });

  test('Concurrency: dual confirmation', async () => {
    // Setup new session in returning state
    const { data: newSession, error: sErr } = await admin.from('walk_sessions').insert({
      customer_id: ownerId,
      walker_id: walkerId,
      pet_id: petId,
      status: 'returning',
      current_status: 'returning',
      walk_type: 'livre',
      planned_duration_minutes: 60,
      start_time: new Date(Date.now() - 3600000 * 2).toISOString(),
      e2e_test: true,
      e2e_run_id: E2E_RUN_ID
    }).select().single();
    if (sErr) throw sErr;

    
    const ownerClient = getClient(ownerId);
    await ownerClient.auth.signInWithPassword({ email: `owner-${E2E_RUN_ID}@test.com`, password: 'VaiPet@2026' });

    // N. Concurrency test
    const [res1, res2] = await Promise.all([
      ownerClient.rpc('customer_confirm_arrival', { _session_id: newSession.id }),
      ownerClient.rpc('customer_confirm_arrival', { _session_id: newSession.id })
    ]);

    const results = [res1.data, res2.data];
    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});

function now() { return new Date(); }
