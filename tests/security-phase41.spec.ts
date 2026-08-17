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

test.describe("Security Phase 4.1: Hardened PIN and Identity Battery", () => {
  
  test("security: ACL - Acesso Anon/Public deve ser negado", async ({ request }) => {
    const res1 = await request.post(`${SUPABASE_URL}/rest/v1/rpc/customer_get_pickup_code`, {
      data: { _session_id: "00000000-0000-0000-0000-000000000000" },
      headers: { 'apikey': ANON_KEY }
    });
    expect(res1.status()).toBe(403); // Revoke from public

    const res2 = await request.get(`${SUPABASE_URL}/rest/v1/walk_pickup_codes`, {
      headers: { 'apikey': ANON_KEY }
    });
    expect(res2.status()).toBe(403);
    
    log("ACL Hardening: PASS");
  });

  test("security: Ataque de Identidade - Walker errado não pode confirmar", async () => {
    const runId = `sec_id_${Date.now()}`;
    const password = "Pass123456!";
    
    // Criar Owner, Walker Legítimo e Atacante
    const create = async (role: string) => {
        const email = `e2e.${role}.${runId}@e2e.vaipet.invalid`;
        const { data } = await admin.auth.admin.createUser({ 
            email, password, email_confirm: true, 
            user_metadata: { e2e_test: true, e2e_run_id: runId } 
        });
        return data.user!;
    };

    const owner = await create('owner');
    const walker = await create('walker');
    const attacker = await create('attacker');

    const attackerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await attackerClient.auth.signInWithPassword({ email: attacker.email!, password });

    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: owner.email!, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ 
          owner_id: owner.id, name: "SecPet", breed: "SRD", e2e_run_id: runId 
      }).select().single();
      
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: owner.id, 
        walker_id: walker.id, // Walker legítimo é o 'walker'
        pet_id: pet.id, 
        current_status: "arrived", 
        status: "arrived",
        walk_type: "individual", 
        planned_duration_minutes: 30, 
        request_mode: "now", 
        e2e_run_id: runId,
        start_time: new Date().toISOString(),
        meeting_point_geom: `SRID=4326;POINT(0 0)`
      }).select().single();

      // Owner gera o PIN
      const { data: pin } = await ownerClient.rpc('customer_get_pickup_code', { _session_id: session.id });
      expect(pin).toMatch(/^\d{6}$/);

      // ATACANTE tenta confirmar
      const { error: attackErr } = await attackerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(attackErr?.message).toContain('você não é o Walker designado');

      log("Ataque de Identidade interceptado: PASS");
    } finally {
      await failClosedCleanup(admin, [owner.id, walker.id, attacker.id], runId);
    }
  });

  test("security: Concorrência e Expiração", async () => {
    const runId = `sec_exp_${Date.now()}`;
    const email = `e2e.owner.${runId}@e2e.vaipet.invalid`;
    const password = "Pass123456!";
    const { data: uData } = await admin.auth.admin.createUser({ 
        email, password, email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId } 
    });
    const owner = uData.user!;

    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ 
          owner_id: owner.id, name: "P", breed: "P", e2e_run_id: runId 
      }).select().single();
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: owner.id, pet_id: pet.id, current_status: "accepted", status: "accepted",
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId,
        start_time: new Date().toISOString(),
        meeting_point_geom: `SRID=4326;POINT(0 0)`
      }).select().single();

      // Teste de Idempotência em paralelo
      const [pin1, pin2] = await Promise.all([
        ownerClient.rpc('customer_get_pickup_code', { _session_id: session.id }),
        ownerClient.rpc('customer_get_pickup_code', { _session_id: session.id })
      ]);
      expect(pin1.data).toBe(pin2.data);
      expect(pin1.data).toMatch(/^\d{6}$/);
      log("Idempotência CSPRNG: PASS");

      // Forçar expiração via Admin
      await admin.from('walk_pickup_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('session_id', session.id);
      
      const { error: expErr } = await ownerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin1.data });
      expect(expErr?.message).toContain('expirado');
      log("Validação de Expiração: PASS");

    } finally {
      await failClosedCleanup(admin, [owner.id], runId);
    }
  });

  test("security: Bloqueio de Força Bruta (5 tentativas)", async () => {
    const runId = `sec_brute_${Date.now()}`;
    const email = `e2e.walker.${runId}@e2e.vaipet.invalid`;
    const password = "Pass123456!";
    const { data: uData } = await admin.auth.admin.createUser({ 
        email, password, email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId } 
    });
    const walker = uData.user!;

    const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await walkerClient.auth.signInWithPassword({ email, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ owner_id: walker.id, name: "P", breed: "P", e2e_run_id: runId }).select().single();
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: walker.id, walker_id: walker.id, pet_id: pet.id, current_status: "arrived", status: "arrived",
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId,
        start_time: new Date().toISOString(), meeting_point_geom: `SRID=4326;POINT(0 0)`
      }).select().single();

      const realPin = '999999';
      await admin.from('walk_pickup_codes').insert({
          session_id: session.id, pin_code: realPin,
          expires_at: new Date(Date.now() + 300000).toISOString(), attempts: 0, e2e_run_id: runId
      });

      // 5 erros
      for (let i = 0; i < 5; i++) {
        const { data } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: '000000' });
        expect(data).toBe(false);
      }

      // Sexta tentativa com PIN correto deve falhar
      const { error } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: realPin });
      expect(error?.message).toContain('limite de tentativas excedido');
      
      log("Bloqueio de 5 tentativas: PASS");
    } finally {
      await failClosedCleanup(admin, [walker.id], runId);
    }
  });
});
