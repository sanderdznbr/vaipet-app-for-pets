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

test.describe("Phase 4.2 Patch 1D: GPS Tracking Final Reconciliation", () => {
  
  test("Security & Role Isolation", async () => {
    const runId = `gps_sec_${Date.now()}`;
    const password = "Pass123456!";
    const emailW1 = `walker1.${runId}@e2e.vaipet.invalid`;
    const emailW2 = `walker2.${runId}@e2e.vaipet.invalid`;
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

    // 3. Setup Owner
    const { data: uO } = await admin.auth.admin.createUser({ email: emailOwner, password, email_confirm: true, user_metadata: { signup_intent: 'pet_owner', e2e_test: true, e2e_run_id: runId } });
    const uidO = uO.user!.id;

    const clientW1 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientW1.auth.signInWithPassword({ email: emailW1, password });

    const clientW2 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await clientW2.auth.signInWithPassword({ email: emailW2, password });

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

      // A) Direct append_walk_tracking_point BLOCKED (42501)
      const { error: errDir } = await clientW1.rpc('append_walk_tracking_point', { _session_id: session!.id, _lng: 1, _lat: 1 });
      expect(errDir?.code).toBe('42501');

      // B) Owner BLOCKED from update_walker_location (42501)
      const { error: errOwner } = await clientOwner.rpc('update_walker_location', { _lat: 1, _lng: 1, _accuracy: 10, _captured_at: Date.now() });
      expect(errOwner?.code).toBe('42501');

      // C) Second Walker BLOCKED from affecting designated session
      await clientW2.rpc('update_walker_location', { _lat: 50, _lng: 50, _accuracy: 10, _captured_at: Date.now() });
      const { data: wCheck } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(wCheck?.route_coordinates).not.toContainEqual([50, 50]);

    } finally {
      await failClosedCleanup(admin, [uidW1, uidW2, uidO], runId);
    }
  });

  test("Logic: Trail Format, Rate Limit and Status Isolation", async () => {
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

      await admin.from('petwalker_profiles').update({ current_walk_id: session!.id }).eq('user_id', uidW);

      // 1. Trail Format: [] -> [[lng, lat]]
      const t1 = Date.now();
      await walker.rpc('update_walker_location', { _lat: 10, _lng: 20, _accuracy: 10, _captured_at: t1 });
      const { data: w1 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(w1?.route_coordinates).toEqual([[20, 10]]);

      // 2. Rate Limit Server-Side: Second point within 5s MUST fail to grow trail
      await walker.rpc('update_walker_location', { _lat: 11, _lng: 21, _accuracy: 10, _captured_at: t1 + 100 });
      const { data: w2 } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(w2?.route_coordinates).toEqual([[20, 10]]); // Still only 1 point

      // 3. Monotonicity: Old timestamp MUST return false
      const { data: resMono } = await walker.rpc('update_walker_location', { _lat: 12, _lng: 22, _accuracy: 10, _captured_at: t1 - 100 });
      expect(resMono).toBe(false);

      // 4. Status Isolation: Completed session MUST NOT grow trail
      await admin.from('walk_sessions').update({ current_status: 'completed' }).eq('id', session!.id);
      const trailBefore = JSON.stringify(w2?.route_coordinates);
      
      await walker.rpc('update_walker_location', { _lat: 13, _lng: 23, _accuracy: 10, _captured_at: t1 + 10000 });
      const { data: wFinal } = await admin.from('walk_sessions').select('route_coordinates').eq('id', session!.id).single();
      expect(JSON.stringify(wFinal?.route_coordinates)).toBe(trailBefore);

    } finally {
      await failClosedCleanup(admin, [uidW, uidO], runId);
    }
  });
});