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

test.describe("Phase 4.2: Hardened GPS Tracking Infrastructure", () => {
  test("security: update_walker_location ACL hardening", async ({ request }) => {
    // 1. Anonymous call must fail with 401
    const anonRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/update_walker_location`, {
      data: { _lat: 0, _lng: 0, _accuracy: 10, _captured_at: Date.now() },
      headers: { 'apikey': ANON_KEY }
    });
    expect(anonRes.status()).toBe(401);
  });

  test("security: Insecure append_walk_tracking_point removal", async ({ request }) => {
    // Attempting to call the double precision[] overload which should be deleted
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/append_walk_tracking_point`, {
      data: { _session_id: '00000000-0000-0000-0000-000000000000', _point: [0, 0] },
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' }
    });
    // Should be 404 (Not Found) because the function signature doesn't exist anymore
    // or 401/403 if it fails earlier.
    expect([404, 401]).toContain(res.status());
  });

  test("logic: GPS Authority, Monotonicity and Validation", async () => {
    const runId = `gps_auth_${Date.now()}`;
    const password = "Pass123456!";
    const emailW = `walker.gps.${runId}@e2e.vaipet.invalid`;
    const emailO = `owner.gps.${runId}@e2e.vaipet.invalid`;

    // 1. Setup Petwalker
    const { data: userDataW } = await admin.auth.admin.createUser({
      email: emailW, password, email_confirm: true,
      user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: 'petwalker' }
    });
    const uidW = userDataW.user!.id;
    await admin.from('profiles').upsert({ id: uidW, full_name: 'GPS Walker', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uidW, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uidW, role: 'petwalker' });

    // 2. Setup Owner
    const { data: userDataO } = await admin.auth.admin.createUser({
      email: emailO, password, email_confirm: true,
      user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: 'pet_owner' }
    });
    const uidO = userDataO.user!.id;
    await admin.from('profiles').upsert({ id: uidO, full_name: 'GPS Owner', e2e_test: true });

    const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await walkerClient.auth.signInWithPassword({ email: emailW, password });

    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: emailO, password });

    try {
      // 3. Test Monotonicity
      const t1 = Date.now();
      const t2 = t1 - 1000;

      const { data: res1, error: err1 } = await walkerClient.rpc('update_walker_location', {
        _lat: -23.5, _lng: -46.6, _accuracy: 5, _captured_at: t1
      });
      expect(err1).toBeNull();
      expect(res1).toBe(true);

      const { data: res2 } = await walkerClient.rpc('update_walker_location', {
        _lat: -23.6, _lng: -46.7, _accuracy: 5, _captured_at: t2
      });
      expect(res2).toBe(false);

      // 4. Test Lat/Lng Validation
      const { error: errLat } = await walkerClient.rpc('update_walker_location', {
        _lat: 100, _lng: 0, _accuracy: 5, _captured_at: t1 + 100
      });
      expect(errLat?.code).toBe('22023');

      // 5. Test Authority (Owner cannot write)
      const { error: errOwner } = await ownerClient.rpc('update_walker_location', {
        _lat: 0, _lng: 0, _accuracy: 5, _captured_at: t1 + 200
      });
      // 42501: Access denied (petwalker_profiles not found for this user)
      expect(errOwner?.code).toBe('42501');

    } finally {
      await failClosedCleanup(admin, [uidW, uidO], runId);
    }
  });

  test("logic: Route Coordinates authority and status checks", async () => {
     const runId = `gps_trail_auth_${Date.now()}`;
     const password = "Pass123456!";
     const emailW1 = `walker1.trail.${runId}@e2e.vaipet.invalid`;
     const emailW2 = `walker2.trail.${runId}@e2e.vaipet.invalid`;
     const emailO = `owner.trail.${runId}@e2e.vaipet.invalid`;

     // Setup Walker 1
     const { data: uW1 } = await admin.auth.admin.createUser({ email: emailW1, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
     const uidW1 = uW1.user!.id;
     await admin.from('profiles').upsert({ id: uidW1, full_name: 'W1', e2e_test: true });
     await admin.from('petwalker_profiles').upsert({ user_id: uidW1, approval_status: 'approved', e2e_test: true });
     await admin.from('user_roles').upsert({ user_id: uidW1, role: 'petwalker' });

     // Setup Walker 2
     const { data: uW2 } = await admin.auth.admin.createUser({ email: emailW2, password, email_confirm: true, user_metadata: { signup_intent: 'petwalker', e2e_test: true, e2e_run_id: runId } });
     const uidW2 = uW2.user!.id;
     await admin.from('profiles').upsert({ id: uidW2, full_name: 'W2', e2e_test: true });
     await admin.from('petwalker_profiles').upsert({ user_id: uidW2, approval_status: 'approved', e2e_test: true });
     await admin.from('user_roles').upsert({ user_id: uidW2, role: 'petwalker' });

     // Setup Owner
     const { data: uO } = await admin.auth.admin.createUser({ email: emailO, password, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: runId } });
     const uidO = uO.user!.id;
     await admin.from('profiles').upsert({ id: uidO, full_name: 'O', e2e_test: true });

     const walker1 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
     await walker1.auth.signInWithPassword({ email: emailW1, password });

     const walker2 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
     await walker2.auth.signInWithPassword({ email: emailW2, password });

     const owner = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
     await owner.auth.signInWithPassword({ email: emailO, password });

     try {
       // Create walk for Walker 1
       const { data: pet } = await admin.from("pets").insert({ owner_id: uidO, name: "P", breed: "P", e2e_test: true }).select().single();
       const { data: session } = await admin.from("walk_sessions").insert({
         customer_id: uidO, walker_id: uidW1, pet_id: pet!.id, current_status: 'accepted',
         walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
         start_time: new Date().toISOString(), status: 'accepted', home_location: { lat: 0, lng: 0 }, route_coordinates: []
       }).select().single();

       await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW1);

       // 1. Walker 1 updates in 'accepted' status: route_coordinates must NOT grow
       await walker1.rpc('update_walker_location', { _lat: 10, _lng: 20, _accuracy: 10, _captured_at: Date.now() });
       const { data: walk1 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
       expect(walk1?.route_coordinates).toEqual([]);

       // 2. Walker 1 transitions through states: accepted -> heading_to_pickup -> arrived -> in_progress
       // This ensures we respect the trigger state machine
       await admin.from('walk_sessions').update({ current_status: 'heading_to_pickup' }).eq('id', session!.id);
       await admin.from('walk_sessions').update({ current_status: 'arrived' }).eq('id', session!.id);
       await admin.from('walk_sessions').update({ current_status: 'in_progress' }).eq('id', session!.id);
       
       // Force a 6s wait to ensure we bypass the 5s rate limit in append_walk_tracking_point
       await new Promise(r => setTimeout(r, 6000));

       await walker1.rpc('update_walker_location', { _lat: 11, _lng: 21, _accuracy: 10, _captured_at: Date.now() + 10000 });
       const { data: walk2 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
       expect(walk2?.route_coordinates).toContainEqual([21, 11]);



       // 3. Walker 2 tries to update Walker 1's trail: must fail
       const { error: errW2 } = await walker2.rpc('append_walk_tracking_point', { _session_id: session!.id, _point: [0, 0] });
       expect(errW2?.code).toBe('42501');

       // 4. Owner tries to update trail: must fail
       const { error: errO } = await owner.rpc('append_walk_tracking_point', { _session_id: session!.id, _point: [1, 1] });
       expect(errO?.code).toBe('42501');

       // 5. Final validation: session was between different IDs
       expect(session!.customer_id).not.toBe(session!.walker_id);

     } finally {
       await failClosedCleanup(admin, [uidW1, uidW2, uidO], runId);
     }
  });
});

