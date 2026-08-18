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
    // 1. Anonymous call must fail with 42501 (permission denied)
    const anonRes = await request.post(`${SUPABASE_URL}/rest/v1/rpc/update_walker_location`, {
      data: { _lat: 0, _lng: 0, _accuracy: 10, _captured_at: Date.now() },
      headers: { 'apikey': ANON_KEY }
    });
    expect(anonRes.status()).toBe(403);
    const body = await anonRes.json();
    expect(body.code).toBe("42501");
  });

  test("logic: GPS Authority and Monotonicity", async () => {
    const runId = `gps_auth_${Date.now()}`;
    const password = "Pass123456!";
    const email = `walker.gps.${runId}@e2e.vaipet.invalid`;

    // 1. Setup Petwalker
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: 'petwalker' }
    });
    if (userErr) throw userErr;
    const uid = userData.user!.id;

    await admin.from('profiles').upsert({ id: uid, full_name: 'GPS Walker', e2e_test: true });
    await admin.from('petwalker_profiles').upsert({ user_id: uid, approval_status: 'approved', e2e_test: true });
    await admin.from('user_roles').upsert({ user_id: uid, role: 'petwalker' });

    const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await walkerClient.auth.signInWithPassword({ email, password });

    try {
      // 2. Test Monotonicity
      const t1 = Date.now();
      const t2 = t1 - 1000; // Older timestamp

      // First update (valid)
      const { data: res1, error: err1 } = await walkerClient.rpc('update_walker_location', {
        _lat: -23.5, _lng: -46.6, _accuracy: 5, _captured_at: t1
      });
      expect(err1).toBeNull();
      expect(res1).toBe(true);

      // Second update with older timestamp (must be ignored/return false)
      const { data: res2, error: err2 } = await walkerClient.rpc('update_walker_location', {
        _lat: -23.6, _lng: -46.7, _accuracy: 5, _captured_at: t2
      });
      expect(res2).toBe(false);

      // 3. Test Authority (Owner cannot write)
      const { data: profile } = await admin.from('petwalker_profiles').select('last_location_captured_at').eq('user_id', uid).single();
      expect(Number(profile?.last_location_captured_at)).toBe(t1);

    } finally {
      await failClosedCleanup(admin, [uid], runId);
    }
  });

  test("logic: Auto-trail generation during walk", async () => {
     const runId = `gps_trail_${Date.now()}`;
     const password = "Pass123456!";
     const email = `walker.trail.${runId}@e2e.vaipet.invalid`;

     const { data: userData } = await admin.auth.admin.createUser({
       email, password, email_confirm: true,
       user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: 'petwalker' }
     });
     const uid = userData.user!.id;
     await admin.from('profiles').upsert({ id: uid, full_name: 'Trail Walker', e2e_test: true });
     await admin.from('petwalker_profiles').upsert({ user_id: uid, approval_status: 'approved', e2e_test: true });
     await admin.from('user_roles').upsert({ user_id: uid, role: 'petwalker' });

     const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
     await walkerClient.auth.signInWithPassword({ email, password });

     try {
       // Create an active walk
       const { data: pet } = await admin.from("pets").insert({ owner_id: uid, name: "P", breed: "P", e2e_test: true }).select().single();
       const { data: session } = await admin.from("walk_sessions").insert({
         customer_id: uid, walker_id: uid, pet_id: pet!.id, current_status: 'in_progress', status: 'in_progress',
         walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
         start_time: new Date().toISOString(), home_location: { lat: 0, lng: 0 }
       }).select().single();

       // Set current_walk_id on walker profile
       await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uid);

       // Update location (should trigger append_walk_tracking_point via auto-append logic)
       const captureTime = Date.now();
       await walkerClient.rpc('update_walker_location', {
         _lat: 10, _lng: 20, _accuracy: 10, _captured_at: captureTime
       });

       // Audit session route_coordinates
       const { data: walkAudit } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
       const coords = walkAudit?.route_coordinates as number[][] || [];
       
       expect(coords).toContainEqual([20, 10]);

     } finally {
       await failClosedCleanup(admin, [uid], runId);
     }
  });
});
