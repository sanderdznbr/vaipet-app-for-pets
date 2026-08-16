import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Realiza a limpeza de dados de teste E2E seguindo o princípio Fail-Closed.
 * @param admin Cliente Supabase com privilégios de service_role.
 * @param ids Lista de IDs de usuários a serem removidos.
 * @param runId Opcional: ID da execução para validação extra.
 */
export async function failClosedCleanup(admin: SupabaseClient, ids: string[], runId?: string) {
  if (!ids || ids.length === 0) return;
  
  console.log(`[cleanup] Iniciando fail-closed cleanup para ${ids.length} IDs.`);

  // 1. Auditoria e Validação de Segurança
  for (const id of ids) {
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(id);
    
    if (uErr) {
      if (uErr.message.includes("User not found") || uErr.status === 404) continue;
      throw new Error(`[FAIL-CLOSED] Erro ao auditar usuário ${id}: ${uErr.message}`);
    }
    
    if (!u || !u.user) throw new Error(`[FAIL-CLOSED] Resultado ambíguo para usuário ${id}.`);

    const meta = u.user.user_metadata || {};
    if (meta.e2e_test !== true) {
      throw new Error(`[SECURITY ALERT] Tentativa de deletar usuário REAL: ${u.user.email} (ID: ${id}). Marcador e2e_test ausente.`);
    }
    
    if (runId && meta.e2e_run_id !== runId) {
      throw new Error(`[SECURITY ALERT] RunID mismatch para ${id}: esperado ${runId}, encontrado ${meta.e2e_run_id}.`);
    }
  }

  // 2. Coleta de IDs de sessões para deleção em cascata manual
  const { data: sessions, error: sErr } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  
  if (sErr) throw new Error(`[FAIL-CLOSED] Erro ao coletar sessões: ${sErr.message}`);
  const sIds = sessions?.map(s => s.id) || [];

  // 3. Operações de Exclusão com Validação Individual
  const runOp = async (table: string, col: string, vals: string[]) => {
    if (vals.length === 0) return;
    const { error } = await admin.from(table).delete().in(col, vals);
    if (error) throw new Error(`[FAIL-CLOSED] Erro ao deletar de ${table}: ${error.message}`);
  };

  // Ordem de integridade referencial
  await runOp("walker_tracking", "walk_session_id", sIds);
  await runOp("walk_offers", "session_id", sIds);
  await runOp("petwalker_earnings", "walk_session_id", sIds);
  await runOp("walk_sessions", "id", sIds);
  await runOp("pets", "owner_id", ids);
  await runOp("petwalker_profiles", "user_id", ids);
  await runOp("user_roles", "user_id", ids);
  await runOp("profiles", "id", ids);

  // 4. Deleção no Auth Service
  for (const id of ids) {
    const { error: authErr } = await admin.auth.admin.deleteUser(id);
    if (authErr && !authErr.message.includes("User not found") && authErr.status !== 404) {
      throw new Error(`[FAIL-CLOSED] Erro ao deletar usuário Auth ${id}: ${authErr.message}`);
    }
  }

  // 5. Verificação de Contagem Zero (Fail-Closed Selects)
  const checkZero = async (table: string, col: string, vals: string[]) => {
    if (vals.length === 0) return;
    
    const { count, error } = await admin
      .from(table)
      .select("*", { count: 'exact', head: true })
      .in(col, vals);
    
    if (error) {
       console.warn(`[cleanup] Tentando select simples para ${table} devido a erro: ${error.message}`);
       const { data: retryData, error: retryError } = await admin.from(table).select(col).in(col, vals);
       
       if (retryError) {
         throw new Error(`[FAIL-CLOSED] Erro fatal na consulta de verificação em ${table}: ${retryError.message}`);
       }

       if (!Array.isArray(retryData) || retryData.length > 0) {
           throw new Error(`[FAIL-CLOSED] RESÍDUO CONFIRMADO ou resultado ambíguo em ${table}: ${retryData === null ? 'null' : (Array.isArray(retryData) ? retryData.length : 'não-array')} registros.`);
       }
    } else {
      if (count === null || count === undefined || count !== 0) {
        throw new Error(`[FAIL-CLOSED] RESÍDUO DETECTADO ou contagem ambígua em ${table}: count=${count}`);
      }
    }

    console.log(`[cleanup] Tabela ${table} confirmada: count=0`);
  };

  await checkZero("walker_tracking", "walk_session_id", sIds);
  await checkZero("walk_offers", "session_id", sIds);
  await checkZero("petwalker_earnings", "walk_session_id", sIds);
  await checkZero("walk_sessions", "id", sIds);
  await checkZero("pets", "owner_id", ids);
  await checkZero("petwalker_profiles", "user_id", ids);
  await checkZero("user_roles", "user_id", ids);
  await checkZero("profiles", "id", ids);

  // 6. Verificação Final do Auth
  for (const id of ids) {
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(id);
    
    if (u?.user) {
      throw new Error(`[FAIL-CLOSED] Usuário Auth ${id} ainda existe após deleção.`);
    }

    // Aceitamos exclusivamente erro 404 / User not found
    if (!uErr) {
      throw new Error(`[FAIL-CLOSED] Resultado ambíguo (data=null, error=null) para usuário Auth ${id}.`);
    }

    if (!uErr.message.includes("User not found") && uErr.status !== 404) {
      throw new Error(`[FAIL-CLOSED] Erro inesperado na verificação final de Auth ${id}: ${uErr.message}`);
    }
    
    console.log(`[cleanup] Usuário Auth ${id} confirmado inexistente (404).`);
  }

  console.log("Cleanup zero");
}
