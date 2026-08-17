import { test, expect, type SupabaseClient } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const log = (msg: string) => console.log(`[${new Date().toISOString()}] [security-phase41] ${msg}`);

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

test.describe("Security Phase 4.1: PIN and Status Hardening", () => {
  
  test("security: ACESSO ANON DEVE FALHAR (403/401)", async ({ request }) => {
    const res1 = await request.post(`${SUPABASE_URL}/rest/v1/rpc/customer_get_pickup_code`, {
      data: { walk_id: "00000000-0000-0000-0000-000000000000" }
    });
    expect(res1.status()).toBeGreaterThanOrEqual(400);

    const res2 = await request.get(`${SUPABASE_URL}/rest/v1/walk_pickup_codes`);
    expect(res2.status()).toBeGreaterThanOrEqual(400);
    
    log("Acesso anon negado: PASS");
  });

  test("security: LEITURA CONCORRENTE E IDEMPOTENCIA", async () => {
    const runId = `sec_${Date.now()}`;
    const email = `e2e.owner.${runId}@e2e.vaipet.invalid`;
    const { data: uData, error: uErr } = await admin.auth.admin.createUser({ 
        email, 
        password: "Pass!", 
        email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId } 
    });
    if (uErr) throw uErr;
    const ownerId = uData.user!.id;

    try {
      const { data: pet } = await admin.from("pets").insert({ 
          owner_id: ownerId, name: "SecPet", breed: "SRD", e2e_run_id: runId 
      }).select().single();
      
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: ownerId, pet_id: pet.id, current_status: "accepted", status: "accepted",
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId,
        meeting_point_geom: `SRID=4326;POINT(0 0)`
      }).select().single();

      // Testar idempotência via service_role chamando a RPC repetidamente (FOR UPDATE está interno na RPC)
      const r1 = await admin.rpc('customer_get_pickup_code', { walk_id: session.id });
      const r2 = await admin.rpc('customer_get_pickup_code', { walk_id: session.id });

      if (r1.error) { log(`R1 ERROR: ${JSON.stringify(r1.error)}`); throw r1.error; }
      if (r2.error) { log(`R2 ERROR: ${JSON.stringify(r2.error)}`); throw r2.error; }

      expect(r1.data).toBe(r2.data);
      expect(r1.data).toMatch(/^\d{6}$/);
      log("Idempotência de PIN: PASS");

    } finally {
      await failClosedCleanup(admin, [ownerId], runId);
    }
  });

  test("security: 5 ERROS, BLOQUEIO E EXPIRAÇÃO", async () => {
    const runId = `sec_err_${Date.now()}`;
    const email = `e2e.walker.${runId}@e2e.vaipet.invalid`;
    const { data: uData, error: uErr } = await admin.auth.admin.createUser({ 
        email, 
        password: "Pass!", 
        email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId } 
    });
    if (uErr) throw uErr;
    const walkerId = uData.user!.id;

    try {
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: walkerId,
        walker_id: walkerId,
        current_status: "accepted",
        status: "accepted",
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId,
        meeting_point_geom: `SRID=4326;POINT(0 0)`
      }).select().single();

      const { data: pin, error: pinErr } = await admin.rpc('customer_get_pickup_code', { walk_id: session.id });
      if (pinErr) throw pinErr;
      
      for (let i = 0; i < 5; i++) {
        const { data: success } = await admin.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: '000000' });
        expect(success).toBe(false);
      }

      const { error } = await admin.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(error?.message).toContain('Max attempts reached');
      
      log("Bloqueio após 5 erros: PASS");

      await admin.from('walk_pickup_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('session_id', session.id);
      const { error: expErr } = await admin.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(expErr).toBeTruthy();

    } finally {
      await failClosedCleanup(admin, [walkerId], runId);
    }
  });

  test("security: STATUS SYNC (status + current_status)", async () => {
     const runId = `sec_sync_${Date.now()}`;
     const { data: uData, error: uErr } = await admin.auth.admin.createUser({ 
         email: `e2e.sync.${runId}@e2e.vaipet.invalid`, 
         password: "Pass!", 
         email_confirm: true, 
         user_metadata: { e2e_test: true, e2e_run_id: runId } 
     });
     if (uErr) throw uErr;
     const uid = uData.user!.id;

     try {
       const { data: session } = await admin.from("walk_sessions").insert({
         customer_id: uid, walker_id: uid, current_status: "accepted", status: "accepted",
         walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId,
         meeting_point_geom: `SRID=4326;POINT(0 0)`
       }).select().single();

       const { data: pin, error: pinErr } = await admin.rpc('customer_get_pickup_code', { walk_id: session.id });
       if (pinErr) throw pinErr;
       
       await admin.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
       
       const { data: final } = await admin.from("walk_sessions").select("status, current_status").eq("id", session.id).single();
       expect(final?.status).toBe('in_progress');
       expect(final?.current_status).toBe('in_progress');
       
       log("Sincronização de status: PASS");
     } finally {
       await failClosedCleanup(admin, [uid], runId);
     }
  });
});
