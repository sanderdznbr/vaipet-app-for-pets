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

test.describe("Phase 4.2 Patch 1C: Hardened GPS Authority & Trials", () => {
  test("Security: update_walker_location requires petwalker role and inputs", async () => {
    const runId = `gps_sec_${Date.now()}`;
    const password = "Pass123456!";
    const emailNoRole = `norole.${runId}@e2e.vaipet.invalid`;

    // 1. Setup user with approved profile but NO role
    const { data: uNR } = await admin.auth.admin.createUser({ 
      email: emailNoRole, password, email_confirm: true, 
      user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } 
    });
    const uidNR = uNR.user!.id;
    await admin.from('profiles').upsert({ id: uidNR, full_name: 'No Role', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidNR, approval_status: 'approved', e2e_test: true });

    const clientNR = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientNR.auth.signInWithPassword({ email: emailNoRole, password });

    try {
      // Must fail with 42501 (Unauthorized: Role petwalker required)
      const { error: err1 } = await clientNR.rpc('update_walker_location', {
        _lat: 0, _lng: 0, _accuracy: 10, _captured_at: Date.now()
      });
      expect(err1?.code).toBe('42501');

      // Now add role and test mandatory inputs
      await admin.from('user_roles').upsert({ user_id: uidNR, role: 'petwalker' });
      
      const { error: errMandatory } = await clientNR.rpc('update_walker_location', {
        _lat: null, _lng: 0, _accuracy: 10, _captured_at: Date.now()
      });
      expect(errMandatory?.code).toBe('23502');

    } finally {
      await failClosedCleanup(admin, [uidNR], runId);
    }
  });

  test("Security: Direct append_walk_tracking_point is blocked for frontend", async () => {
    const runId = `gps_append_sec_${Date.now()}`;
    const password = "Pass123456!";
    const emailW = `walker.append.${runId}@e2e.vaipet.invalid`;

    const { data: uW } = await admin.auth.admin.createUser({ 
      email: emailW, password, email_confirm: true, 
      user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } 
    });
    const uidW = uW.user!.id;
    await admin.from('profiles').upsert({ id: uidW, full_name: 'W', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW, role: 'petwalker' });

    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email: emailW, password });

    try {
      // Must fail with 42501 (Permission denied on function)
      const { error } = await client.rpc('append_walk_tracking_point', {
        _session_id: '00000000-0000-0000-0000-000000000000',
        _point: [0, 0]
      });
      expect(error?.code).toBe('42501');
    } finally {
      await failClosedCleanup(admin, [uidW], runId);
    }
  });

  test("Logic: GPS Trials (Monotonicity, Trail and Status isolation)", async () => {
    const runId = `gps_logic_${Date.now()}`;
    const password = "Pass123456!";
    const emailW = `walker.trail.${runId}@e2e.vaipet.invalid`;
    const emailO = `owner.trail.${runId}@e2e.vaipet.invalid`;

    // Setup Walker
    const { data: uW } = await admin.auth.admin.createUser({ email: emailW, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
    const uidW = uW.user!.id;
    await admin.from('profiles').upsert({ id: uidW, full_name: 'W', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW, role: 'petwalker' });

    // Setup Owner
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

      // Ensure profile links to session
      await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW);

      // Verify profile is set
      const { data: prof } = await admin.from('petwalker_profiles').select('current_walk_id').eq('user_id', uidW).single();
      console.log('Profile current_walk_id:', prof?.current_walk_id);

      // 1. Valid update: trial grows
      const t1 = Date.now();
      const { data: res1, error: err1 } = await walker.rpc('update_walker_location', { _lat: 10.1, _lng: 20.1, _accuracy: 10, _captured_at: t1 });
      console.log('RPC Res:', res1, 'Error:', err1);
      
      const { data: w1 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      console.log('Route Coords:', JSON.stringify(w1?.route_coordinates));
      // Postgres returns jsonb arrays, which can have varying representation in JS
      const hasPoint = w1?.route_coordinates?.some((p: any) => 
        Array.isArray(p) && Math.abs(p[0] - 20.1) < 0.0001 && Math.abs(p[1] - 10.1) < 0.0001
      );
      expect(hasPoint).toBe(true);

      // 2. Monotonicity check
      const { data: resMono } = await walker.rpc('update_walker_location', { _lat: 11, _lng: 21, _accuracy: 10, _captured_at: t1 - 100 });
      expect(resMono).toBe(false);

      // 3. Completed Session isolation
      await admin.from('walk_sessions').update({ current_status: 'completed' }).eq('id', session!.id);
      
      const t2 = t1 + 1000;
      await walker.rpc('update_walker_location', { _lat: 12, _lng: 22, _accuracy: 10, _captured_at: t2 });
      
      const { data: wFinal } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(wFinal?.route_coordinates).not.toContainEqual([22, 12]);
      
      // walker_tracking check
      const { count: trackingCount } = await admin.from('walker_tracking').select('*', { count: 'exact', head: true }).eq('walk_session_id', session!.id).eq('captured_at', t2);
      expect(trackingCount).toBe(0);
      
    } finally {
      await failClosedCleanup(admin, [uidW, uidO], runId);
    }
  });
});
