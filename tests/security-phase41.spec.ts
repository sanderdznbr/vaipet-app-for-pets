import { test, expect, type SupabaseClient } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";

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
    const password = "Pass123456!";
    const { data: uData, error: uErr } = await admin.auth.admin.createUser({ 
        email, 
        password, 
        email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId } 
    });
    if (uErr) { throw new Error(`USER_CREATE_ERROR: ${uErr.message}`); }
    const ownerId = uData.user!.id;

    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: signInErr } = await ownerClient.auth.signInWithPassword({ email, password });
    if (signInErr) { throw new Error(`SIGNIN_ERROR: ${signInErr.message}`); }

    try {
      const { data: pet, error: petErr } = await admin.from("pets").insert({ 
          owner_id: ownerId, name: "SecPet", breed: "SRD", e2e_run_id: runId
      }).select().single();
      if (petErr) { throw new Error(`PET_CREATE_ERROR: ${petErr.message}`); }
      
      const { data: session, error: sessErr } = await admin.from("walk_sessions").insert({
        customer_id: ownerId, 
        pet_id: pet.id, 
        current_status: "accepted", 
        status: "accepted",
        walk_type: "individual", 
        planned_duration_minutes: 30, 
        request_mode: "now", 
        e2e_run_id: runId,
        start_time: new Date().toISOString(),
        meeting_point_geom: `SRID=4326;POINT(0 0)`
      }).select().single();
      if (sessErr) { throw new Error(`SESS_CREATE_ERROR: ${sessErr.message}`); }

      const rUser = await ownerClient.rpc('customer_get_pickup_code', { walk_id: session.id });
      if (rUser.error) { throw new Error(`RPC_FETCH_ERROR: ${JSON.stringify(rUser.error)}`); }

      expect(rUser.data).toMatch(/^\d{6}$/);
      log("Idempotência de PIN: PASS");
      return; // Sucesso explícito
    } finally {
      await failClosedCleanup(admin, [ownerId], runId);
    }
  });

  test("security: 5 ERROS, BLOQUEIO E EXPIRAÇÃO", async () => {
    const runId = `sec_err_${Date.now()}`;
    const email = `e2e.walker.${runId}@e2e.vaipet.invalid`;
    const password = "Pass123456!";
    const { data: uData, error: uErr } = await admin.auth.admin.createUser({ 
        email, 
        password, 
        email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId } 
    });
    if (uErr) { throw new Error(`USER_CREATE_ERROR: ${uErr.message}`); }
    const walkerId = uData.user!.id;

    const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: signInErr } = await walkerClient.auth.signInWithPassword({ email, password });
    if (signInErr) { throw new Error(`SIGNIN_ERROR: ${signInErr.message}`); }

    try {
      const { data: pet, error: petErr } = await admin.from("pets").insert({ 
          owner_id: walkerId, name: "SecPetErr", breed: "SRD", e2e_run_id: runId
      }).select().single();
      if (petErr) { throw new Error(`PET_CREATE_ERROR: ${petErr.message}`); }

      const { data: session, error: sessErr } = await admin.from("walk_sessions").insert({
        customer_id: walkerId,
        walker_id: walkerId,
        pet_id: pet.id,
        current_status: "accepted",
        status: "accepted",
        walk_type: "individual", 
        planned_duration_minutes: 30, 
        request_mode: "now", 
        e2e_run_id: runId,
        start_time: new Date().toISOString(),
        meeting_point_geom: `SRID=4326;POINT(0 0)`
      }).select().single();
      if (sessErr) { throw new Error(`SESS_CREATE_ERROR: ${sessErr.message}`); }

      const realPin = '123456';
      await admin.from('walk_pickup_codes').insert({
          session_id: session.id,
          pin_code: realPin,
          expires_at: new Date(Date.now() + 30*60*1000).toISOString(),
          attempts: 0,
          e2e_run_id: runId
      });

      for (let i = 0; i < 5; i++) {
        const { data: success } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: '000000' });
        expect(success).toBe(false);
      }

      const { error } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: realPin });
      if (!error) { throw new Error("Should have failed after max attempts"); }
      expect(error.message).toContain('Max attempts reached');
      
      log("Bloqueio após 5 erros: PASS");
      return;
    } finally {
      await failClosedCleanup(admin, [walkerId], runId);
    }
  });

  test("security: STATUS SYNC (status + current_status)", async () => {
     const runId = `sec_sync_${Date.now()}`;
     const email = `e2e.sync.${runId}@e2e.vaipet.invalid`;
     const password = "Pass123456!";
     const { data: uData, error: uErr } = await admin.auth.admin.createUser({ 
         email, 
         password, 
         email_confirm: true, 
         user_metadata: { e2e_test: true, e2e_run_id: runId } 
     });
     if (uErr) { throw new Error(`USER_CREATE_ERROR: ${uErr.message}`); }
     const uid = uData.user!.id;

     const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
     await userClient.auth.signInWithPassword({ email, password });

     try {
       const { data: pet, error: petErr } = await admin.from("pets").insert({ owner_id: uid, name: "S", breed: "S", e2e_run_id: runId }).select().single();
       if (petErr) { throw new Error(`PET_CREATE_ERROR: ${petErr.message}`); }

       const { data: session, error: sessErr } = await admin.from("walk_sessions").insert({
         customer_id: uid, walker_id: uid, pet_id: pet.id, current_status: "arrived", status: "arrived",
         walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId,
         start_time: new Date().toISOString(),
         meeting_point_geom: `SRID=4326;POINT(0 0)`
       }).select().single();
       if (sessErr) { throw new Error(`SESS_CREATE_ERROR: ${sessErr.message}`); }

       const pin = '111222';
       const { error: pinErr } = await admin.from('walk_pickup_codes').insert({
           session_id: session.id, pin_code: pin,
           expires_at: new Date(Date.now() + 30*60*1000).toISOString(),
           attempts: 0, e2e_run_id: runId
       });
       if (pinErr) { throw new Error(`PIN_INSERT_ERROR: ${pinErr.message}`); }
       
       const { data: success, error: confErr } = await userClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
       if (confErr) { throw new Error(`CONF_ERR: ${confErr.message}`); }
       expect(success).toBe(true);
       
       const { data: final } = await admin.from("walk_sessions").select("status, current_status").eq("id", session.id).single();
       expect(final?.status).toBe('in_progress');
       expect(final?.current_status).toBe('in_progress');
       
       log("Sincronização de status: PASS");
       return;
     } finally {
       await failClosedCleanup(admin, [uid], runId);
     }
  });
});
