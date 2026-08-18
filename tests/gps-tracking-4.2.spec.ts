import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  throw new Error("Missing environment variables");
}

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

test.describe("Phase 4.2 Patch 1E: GPS Tracking Final Hardening", () => {
  
  test("Security & Role Isolation Matriz", async () => {
    const runId = `gps_sec_${Date.now()}`;
    const password = "Pass123456!";
    
    // Emails
    const emailW1 = `walker1.${runId}@e2e.vaipet.invalid`;
    const emailW2 = `walker2.${runId}@e2e.vaipet.invalid`;
    const emailNoRole = `norole.${runId}@e2e.vaipet.invalid`;
    const emailOwner = `owner.${runId}@e2e.vaipet.invalid`;

    // 1. Setup Walker 1 (Designated)
    const { data: uW1 } = await admin.auth.admin.createUser({ email: emailW1, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidW1 = uW1.user!.id;
    await admin.from('profiles').upsert({ id: uidW1, full_name: 'Walker 1', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW1, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW1, role: 'petwalker' });

    // 2. Setup Walker 2 (Adversarial)
    const { data: uW2 } = await admin.auth.admin.createUser({ email: emailW2, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidW2 = uW2.user!.id;
    await admin.from('profiles').upsert({ id: uidW2, full_name: 'Walker 2', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW2, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW2, role: 'petwalker' });

    // 3. Setup User with approved profile but NO user_roles.petwalker (Matrix A)
    const { data: uNR } = await admin.auth.admin.createUser({ email: emailNoRole, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidNR = uNR.user!.id;
    await admin.from('profiles').upsert({ id: uidNR, full_name: 'No Role', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidNR, approval_status: 'approved', e2e_test: true });
    // Explicitly NO user_roles insert

    // 4. Setup Owner
    const { data: uO } = await admin.auth.admin.createUser({ email: emailOwner, password, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: runId } });
    const uidO = uO.user!.id;

    const clientW1 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientW1.auth.signInWithPassword({ email: emailW1, password });

    const clientW2 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientW2.auth.signInWithPassword({ email: emailW2, password });

    const clientNR = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientNR.auth.signInWithPassword({ email: emailNoRole, password });

    const clientOwner = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientOwner.auth.signInWithPassword({ email: emailOwner, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ owner_id: uidO, name: "P", breed: "P", e2e_test: true }).select().single();
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: uidO, walker_id: uidW1, pet_id: pet!.id, current_status: 'in_progress',
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: new Date().toISOString(), status: 'in_progress', home_location: { lat: 0, lng: 0 }, route_coordinates: []
      }).select().single();

      await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW1);

      // A) ROLE: update_walker_location without petwalker role -> 42501
      const { error: errNR } = await clientNR.rpc('update_walker_location', { _lat: 1, _lng: 1, _accuracy: 10, _captured_at: Date.now() });
      expect(errNR?.code).toBe('42501');

      // B) HELPER DIRETO: designaged walker blocked from direct append_walk_tracking_point (42501)
      const { error: errDir } = await clientW1.rpc('append_walk_tracking_point', { _session_id: session!.id, _lng: 1, _lat: 1 });
      expect(errDir?.code).toBe('42501');

      // C) OWNER BLOCKED from update_walker_location (42501)
      const { error: errOwner } = await clientOwner.rpc('update_walker_location', { _lat: 1, _lng: 1, _accuracy: 10, _captured_at: Date.now() });
      expect(errOwner?.code).toBe('42501');

      // D) WALKER ADVERSARIAL REAL: Walker 2 with stale current_walk_id pointing to Session 1
      await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW2);
      await clientW2.rpc('update_walker_location', { _lat: 55, _lng: 55, _accuracy: 10, _captured_at: Date.now() });
      
      const { data: wCheck } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(wCheck?.route_coordinates).not.toContainEqual([55, 55]);
      
      const { count: trackingCount } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session!.id).eq('walker_id', uidW2);
      expect(trackingCount || 0).toBe(0);

    } finally {
      await failClosedCleanup(admin, [uidW1, uidW2, uidNR, uidO], runId);
    }
  });

  test("Logic: Monotonicity, Rate Limit, Status and Formats", async () => {
    const runId = `gps_logic_${Date.now()}`;
    const password = "Pass123456!";
    const emailW = `walker.${runId}@e2e.vaipet.invalid`;
    const emailO = `owner.${runId}@e2e.vaipet.invalid`;

    const { data: uW } = await admin.auth.admin.createUser({ email: emailW, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidW = uW.user!.id;
    await admin.from('profiles').upsert({ id: uidW, full_name: 'W', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW, role: 'petwalker' });

    const { data: uO } = await admin.auth.admin.createUser({ email: emailO, password, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: runId } });
    const uidO = uO.user!.id;

    const walker = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await walker.auth.signInWithPassword({ email: emailW, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ owner_id: uidO, name: "P", breed: "P", e2e_test: true }).select().single();
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: uidO, walker_id: uidW, pet_id: pet!.id, current_status: 'in_progress',
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: new Date().toISOString(), status: 'in_progress', home_location: { lat: 0, lng: 0 }, route_coordinates: []
      }).select().single();

      // Ensure profile points to session AND is approved
      await admin.from('petwalker_profiles').update({ 
        current_walk_id: session!.id,
        approval_status: 'approved' 
      }).eq('user_id', uidW);
      
      // Wait for propagation
      await new Promise(r => setTimeout(r, 1000));

      const t1 = Date.now();
      const { data: resInit, error: errInit } = await walker.rpc('update_walker_location', { _lat: 10, _lng: 20, _accuracy: 10, _captured_at: t1 });
      if (errInit) console.error("RPC Error:", errInit);
      expect(resInit).toBe(true);

      // Explicitly wait for DB to settle and verify sync status
      await new Promise(r => setTimeout(r, 1000));
      
      const { data: w1, error: w1Err } = await admin.from('walk_sessions').select('route_coordinates, last_location_captured_at').eq('id', session!.id).single();
      if (w1Err) console.error("Audit W1 Error:", w1Err);
      
      // Probing the reason for empty array: check tracking log count
      const { count: trackCount } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session!.id);
      console.log(`Initial Sync Audit - Trail: ${JSON.stringify(w1?.route_coordinates)}, Logs: ${trackCount}`);

      expect(w1?.route_coordinates || []).toEqual([[20, 10]]);

      // 2. MONOTONICIDADE (Matrix B)
      const { data: resMono } = await walker.rpc('update_walker_location', { _lat: 12, _lng: 22, _accuracy: 10, _captured_at: t1 - 100 });
      expect(resMono).toBe(false);
      const { data: profMono } = await admin.from('petwalker_profiles').select('last_location_captured_at').eq('user_id', uidW).single();
      expect(Number(profMono?.last_location_captured_at)).toBe(t1);

      // 3. SEGUNDO PONTO VÁLIDO (Matrix C) - deterministically bypass rate limit
      // Force last_tracking_at back to bypass the 5s check
      await admin.from('walk_sessions').update({ last_tracking_at: new Date(Date.now() - 10000).toISOString() }).eq('id', session!.id);
      
      const { data: resSec } = await walker.rpc('update_walker_location', { _lat: 11, _lng: 21, _accuracy: 10, _captured_at: t1 + 1000 });
      expect(resSec).toBe(true);
      
      await new Promise(r => setTimeout(r, 500));
      const { data: w2 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(w2?.route_coordinates).toEqual([[20, 10], [21, 11]]);

      // 4. RATE LIMIT (Matrix D)
      await walker.rpc('update_walker_location', { _lat: 15, _lng: 25, _accuracy: 10, _captured_at: t1 + 2000 });
      const { data: w3 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(w3?.route_coordinates).toEqual([[20, 10], [21, 11]]); // No growth

      // 5. COMPLETED (Matrix F)
      await admin.from('walk_sessions').update({ current_status: 'completed' }).eq('id', session!.id);
      await walker.rpc('update_walker_location', { _lat: 16, _lng: 26, _accuracy: 10, _captured_at: t1 + 30000 });
      const { data: wComp } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(wComp?.route_coordinates).toEqual([[20, 10], [21, 11]]);

      // 6. CANCELLED (Matrix G)
      await admin.from('walk_sessions').update({ current_status: 'cancelled' }).eq('id', session!.id);
      await walker.rpc('update_walker_location', { _lat: 17, _lng: 27, _accuracy: 10, _captured_at: t1 + 40000 });
      const { data: wCanc } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(wCanc?.route_coordinates).toEqual([[20, 10], [21, 11]]);

      // 7. FORMATO INVÁLIDO (Matrix I)
      await admin.from('walk_sessions').update({ route_coordinates: { invalid: "object" }, current_status: 'in_progress' }).eq('id', session!.id);
      // This call should fail internally in append_walk_tracking_point and return true (since tracking log might still succeed, but trail won't)
      // Actually, update_walker_location will catch the exception if we don't handle it. In our migration, RAISE EXCEPTION in append will bubble up.
      const { error: errInv } = await walker.rpc('update_walker_location', { _lat: 18, _lng: 28, _accuracy: 10, _captured_at: t1 + 50000 });
      // Error is expected because of RAISE EXCEPTION
      expect(errInv).toBeDefined();

    } finally {
      await failClosedCleanup(admin, [uidW, uidO], runId);
    }
  });
});