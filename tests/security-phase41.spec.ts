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

/**
 * Helper para executar código como um usuário específico via transação Postgres.
 * Usamos a transação para setar localmente auth.uid() e permitir que o service_role
 * execute a lógica das RPCs simulando o contexto do usuário.
 */
async function rpcAsUser(client: SupabaseClient, userId: uuid, rpcName: string, args: any) {
  // Como as RPCs são SECURITY DEFINER, elas rodam com privilégios de quem as criou.
  // No entanto, as RPCs checam auth.uid() internamente. 
  // O service_role tem auth.uid() = null por padrão.
  // Para testes de unidade de RPC, costumamos usar uma transação que seta o UID.
  // Mas aqui, vamos tentar usar o client autenticado real para validar a segurança de ponta a ponta.
  const userClient = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false }
  });
  
  // Como não temos a senha em texto claro fácil, usamos o admin para gerar um link de login ou similar?
  // Simplificação: vamos usar o client admin e injetar o UID via um SET LOCAL temporário se a RPC fosse SECURITY INVOKER.
  // Dado que é DEFINER, precisamos que a sessão do Supabase esteja correta.
  
  // Alternativa: As RPCs do PetWalker usam auth.uid(). 
  // Vamos autenticar o client com o access_token do usuário criado.
  const { data: { session }, error: authErr } = await admin.auth.admin.generateLink({
    type: 'login',
    email: args._email_for_auth,
  });
  // ... Isso é complexo.
  
  // Vamos usar a estratégia de "Impersonação via Service Role" se possível, 
  // ou simplesmente logar com a senha conhecida.
}

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
    if (uErr) throw uErr;
    const ownerId = uData.user!.id;

    // Criar client autenticado
    const ownerClient = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false }
    });
    const { error: signInErr } = await ownerClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw signInErr;

    try {
      const { data: pet, error: petErr } = await admin.from("pets").insert({ 
          owner_id: ownerId, name: "SecPet", breed: "SRD"
      }).select().single();
      if (petErr) throw petErr;
      
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
      if (sessErr) throw sessErr;

      const r1 = await ownerClient.rpc('customer_get_pickup_code', { walk_id: session.id });
      const r2 = await ownerClient.rpc('customer_get_pickup_code', { walk_id: session.id });

      if (r1.error) { log(`R1 ERROR: ${r1.error.message}`); throw r1.error; }
      if (r2.error) { log(`R2 ERROR: ${r2.error.message}`); throw r2.error; }

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
    const password = "Pass123456!";
    const { data: uData, error: uErr } = await admin.auth.admin.createUser({ 
        email, 
        password, 
        email_confirm: true, 
        user_metadata: { e2e_test: true, e2e_run_id: runId } 
    });
    if (uErr) throw uErr;
    const walkerId = uData.user!.id;

    const walkerClient = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false }
    });
    const { error: signInErr } = await walkerClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw signInErr;

    try {
      const { data: pet, error: petErr } = await admin.from("pets").insert({ 
          owner_id: walkerId, name: "SecPetErr", breed: "SRD"
      }).select().single();
      if (petErr) throw petErr;

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
      if (sessErr) throw sessErr;

      // O walker não pode pegar o PIN do customer via RPC (checa auth.uid() = customer_id)
      // Mas para este teste, vamos pegar via admin para testar a tentativa de confirmação.
      const { data: pin, error: pinErr } = await admin.rpc('customer_get_pickup_code', { walk_id: session.id });
      if (pinErr) throw pinErr;
      
      for (let i = 0; i < 5; i++) {
        const { data: success, error: confErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: '000000' });
        expect(success).toBe(false);
      }

      const { error } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(error?.message).toContain('Max attempts reached');
      
      log("Bloqueio após 5 erros: PASS");

      await admin.from('walk_pickup_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('session_id', session.id);
      const { error: expErr } = await walkerClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
      expect(expErr?.message).toContain('Expired');

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
     if (uErr) throw uErr;
     const uid = uData.user!.id;

     const userClient = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY!, {
       auth: { persistSession: false }
     });
     const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
     if (signInErr) throw signInErr;

     try {
       const { data: pet, error: petErr } = await admin.from("pets").insert({ 
           owner_id: uid, name: "SecPetSync", breed: "SRD"
       }).select().single();
       if (petErr) throw petErr;

       const { data: session, error: sessErr } = await admin.from("walk_sessions").insert({
         customer_id: uid, 
         walker_id: uid, 
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
       if (sessErr) throw sessErr;

       const { data: pin, error: pinErr } = await admin.rpc('customer_get_pickup_code', { walk_id: session.id });
       if (pinErr) throw pinErr;
       
       const { data: success, error: confErr } = await userClient.rpc('petwalker_confirm_pickup', { walk_id: session.id, input_pin: pin });
       if (confErr) { log(`CONF_ERR: ${confErr.message}`); throw confErr; }
       expect(success).toBe(true);
       
       const { data: final } = await admin.from("walk_sessions").select("status, current_status").eq("id", session.id).single();
       expect(final?.status).toBe('in_progress');
       expect(final?.current_status).toBe('in_progress');
       
       log("Sincronização de status: PASS");
     } finally {
       await failClosedCleanup(admin, [uid], runId);
     }
  });
});
