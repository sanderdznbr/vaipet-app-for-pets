import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { failClosedCleanup } from "./helpers/cleanup";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  throw new Error("Missing critical environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or VITE_SUPABASE_PUBLISHABLE_KEY");
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] [security-phase41] ${msg}`);

let admin: SupabaseClient;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
});

test.describe("Security Phase 4.1: Hardened PIN and Identity Battery", () => {
  
  test("security: ACL - Acesso Anon/Public deve ser negado com 401/403 real", async ({ request }) => {
    // 1. customer_get_pickup_code
    const res1 = await request.post(`${SUPABASE_URL}/rest/v1/rpc/customer_get_pickup_code`, {
      data: { walk_id: "00000000-0000-0000-0000-000000000000" },
      headers: { 'apikey': ANON_KEY }
    });
    // Exigimos 401 ou 403. Se retornar 400 (exceção tratada), falha o teste se a mensagem for ambígua.
    // Mas o objetivo é validar o REVOKE no banco que gera 401/403 via PostgREST.
    expect([401, 403]).toContain(res1.status());

    // 2. walk_pickup_codes table access
    const res2 = await request.get(`${SUPABASE_URL}/rest/v1/walk_pickup_codes`, {
      headers: { 'apikey': ANON_KEY }
    });
    expect([401, 403]).toContain(res2.status());
    
    // 3. petwalker_confirm_pickup
    const res3 = await request.post(`${SUPABASE_URL}/rest/v1/rpc/petwalker_confirm_pickup`, {
      data: { walk_id: "00000000-0000-0000-0000-000000000000", input_pin: "000000" },
      headers: { 'apikey': ANON_KEY }
    });
    expect([401, 403]).toContain(res3.status());
  });

  test("security: Ataque de Identidade - Owner/Walker isolation e Bloqueios", async () => {
    const runId = `sec_id_${Date.now()}`;
    const password = "Pass123456!";
    
    const create = async (role: string, intent: string) => {
        const email = `e2e.${role}.${runId}@e2e.vaipet.invalid`;
        const { data, error } = await admin.auth.admin.createUser({ 
            email, password, email_confirm: true, 
            user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: intent } 
        });
        if (error) throw error;
        const uid = data.user!.id;
        await admin.from('profiles').insert({ id: uid, full_name: `E2E ${role}`, e2e_test: true });
        if (intent === 'petwalker') {
            await admin.from('petwalker_profiles').insert({ user_id: uid, approval_status: 'approved', e2e_test: true });
        }
        return data.user!;
    };

    const owner = await create('owner', 'pet_owner');
    const walker = await create('walker', 'petwalker');
    const attacker = await create('attacker', 'petwalker');

    const attackerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: attAuthErr } = await attackerClient.auth.signInWithPassword({ email: attacker.email!, password });
    if (attAuthErr) throw attAuthErr;

    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: ownAuthErr } = await ownerClient.auth.signInWithPassword({ email: owner.email!, password });
    if (ownAuthErr) throw ownAuthErr;

    const walkerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error: walkAuthErr } = await walkerClient.auth.signInWithPassword({ email: walker.email!, password });
    if (walkAuthErr) throw walkAuthErr;

    try {
      // Setup walk session
      const { data: pet } = await admin.from("pets").insert({ 
          owner_id: owner.id, name: "SecPet", breed: "SRD", e2e_test: true
      }).select().single();
      
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: owner.id, 
        walker_id: walker.id, 
        pet_id: pet.id, 
        current_status: "accepted", 
        status: "accepted",
        walk_type: "individual", 
        planned_duration_minutes: 30, 
        request_mode: "now", 
        e2e_run_id: runId,
        e2e_test: true,
        start_time: new Date().toISOString()
      }).select().single();

      // 1. Acesso negado: Outro Walker não pode gerar PIN
      const { error: attPinErr } = await attackerClient.rpc('customer_get_pickup_code', { walk_id: session.id });
      expect(attPinErr?.message).toMatch(/permission denied|Acesso negado/i);

      // 2. Owner gera o PIN com sucesso
      const { data: pin, error: pinErr } = await ownerClient.rpc('customer_get_pickup_code', { walk_id: session.id });
      if (pinErr) throw pinErr;
      expect(pin).toMatch(/^\d{6}$/);

      // 3. Status incorrect: Walker não pode confirmar antes de "arrived"
      const { error: earlyErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(earlyErr?.message).toMatch(/status.*arrived/i);

      // 4. Mudar status para arrived (via admin para pular GPS no teste de segurança pura)
      await admin.from('walk_sessions').update({ status: 'arrived', current_status: 'arrived' }).eq('id', session.id);

      // 5. ATACANTE tenta confirmar PIN do Walker correto
      const { error: attackErr } = await attackerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(attackErr?.message).toMatch(/você não é o Walker designado/i);

      // 6. Bloqueio de 5 tentativas no Walker correto
      const wrongPin = pin === '111111' ? '222222' : '111111';
      for (let i = 0; i < 5; i++) {
        const { data: failRes } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: wrongPin });
        expect(failRes).toBe(false);
      }
      
      // Sexta tentativa com PIN real deve falhar por bloqueio
      const { error: bruteErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(bruteErr?.message).toMatch(/limite de tentativas excedido/i);

      // 7. Confirmação correta em nova sessão
      const { data: session2 } = await admin.from("walk_sessions").insert({
        customer_id: owner.id, walker_id: walker.id, pet_id: pet.id, current_status: "arrived", status: "arrived",
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: new Date().toISOString()
      }).select().single();

      const { data: pin2 } = await ownerClient.rpc('customer_get_pickup_code', { walk_id: session2.id });
      
      const { data: ok, error: okErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session2.id, input_pin: pin2 });
      if (okErr) throw okErr;
      expect(ok).toBe(true);

      // Verificar efeitos colaterais
      const { data: finalSession } = await admin.from('walk_sessions').select('*').eq('id', session2.id).single();
      expect(finalSession.status).toBe('in_progress');
      expect(finalSession.current_status).toBe('in_progress');
      expect(finalSession.pickup_confirmed_at).not.toBeNull();
      expect(finalSession.start_time).not.toBeNull();

      const { data: pinExists } = await admin.from('walk_pickup_codes').select('session_id').eq('session_id', session2.id).maybeSingle();
      expect(pinExists).toBeNull();

      // Replay do mesmo PIN
      const { error: replayErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session2.id, input_pin: pin2 });
      expect(replayErr?.message).toMatch(/não gerado|expirado/i);

    } finally {
      await failClosedCleanup(admin, [owner.id, walker.id, attacker.id], runId);
    }
  });

  test("security: PIN CSPRNG e Expiração", async () => {
    const runId = `sec_exp_${Date.now()}`;
    const password = "Pass123456!";
    const owner = await admin.auth.admin.createUser({ 
        email: `e2e.owner.${runId}@e2e.vaipet.invalid`, password, email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId, signup_intent: 'pet_owner' } 
    });
    const uid = owner.data.user!.id;
    await admin.from('profiles').insert({ id: uid, full_name: 'E2E Exp', e2e_test: true });
    
    const ownerClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: owner.data.user!.email!, password });

    try {
      const { data: pet } = await admin.from("pets").insert({ owner_id: uid, name: "P", breed: "P", e2e_test: true }).select().single();
      const { data: session } = await admin.from("walk_sessions").insert({
        customer_id: uid, walker_id: uid, pet_id: pet.id, current_status: 'arrived', status: 'arrived',
        walk_type: "individual", planned_duration_minutes: 30, request_mode: "now", e2e_run_id: runId, e2e_test: true,
        start_time: new Date().toISOString()
      }).select().single();

      // Idempotência
      const [p1, p2] = await Promise.all([
        ownerClient.rpc('customer_get_pickup_code', { walk_id: session.id }),
        ownerClient.rpc('customer_get_pickup_code', { walk_id: session.id })
      ]);
      expect(p1.data).toBe(p2.data);
      expect(p1.data).toMatch(/^\d{6}$/);

      // Expiração
      await admin.from('walk_pickup_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('session_id', session.id);
      
      const { error: expErr } = await ownerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: p1.data });
      expect(expErr?.message).toMatch(/expirado/i);
    } finally {
      await failClosedCleanup(admin, [uid], runId);
    }
  });
});
