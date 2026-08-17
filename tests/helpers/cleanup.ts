import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fail-closed cleanup rigoroso para ambientes E2E.
 * Garante que NENHUM dado de teste permaneça e que apenas dados E2E sejam tocados.
 */
export async function failClosedCleanup(supabase: SupabaseClient, userIds: string[], runId: string) {
  if (!runId) throw new Error(JSON.stringify({ error: 'runId_missing', context: 'failClosedCleanup' }));
  
  console.log(`[cleanup] Iniciando auditoria para runId: ${runId}`);

  // 1. Validar usuários antes de qualquer ação
  const verifiedIds: string[] = [];
  for (const id of userIds) {
    const { data: user, error } = await supabase.auth.admin.getUserById(id);
    if (error) {
       if (error.status === 404) continue;
       throw new Error(JSON.stringify({ error: 'user_fetch_failed', id, details: error }));
    }
    
    const isE2E = user?.user?.user_metadata?.e2e_test === true;
    const isRightRun = user?.user?.user_metadata?.e2e_run_id === runId;
    
    if (isE2E && isRightRun) {
      verifiedIds.push(id);
    } else {
      throw new Error(JSON.stringify({ 
        error: 'security_violation', 
        message: 'Tentativa de deletar usuário não-E2E ou de outro run',
        id,
        metadata: user?.user?.user_metadata
      }));
    }
  }

  // 2. Ordem de deleção (Filhos -> Pais)
  const tables = [
    { name: 'walk_pickup_codes', col: 'session_id', isWalkRelated: true },
    { name: 'walker_tracking', col: 'session_id', isWalkRelated: true },
    { name: 'walk_offers', col: 'session_id', isWalkRelated: true },
    { name: 'petwalker_earnings', col: 'walk_session_id', isWalkRelated: true },
    { name: 'walk_sessions', col: 'customer_id', isUserCol: true },
    { name: 'pets', col: 'owner_id', isUserCol: true },
    { name: 'petwalker_profiles', col: 'user_id', isUserCol: true },
    { name: 'user_roles', col: 'user_id', isUserCol: true },
    { name: 'profiles', col: 'id', isUserCol: true }
  ];

  for (const table of tables) {
    try {
      let query = supabase.from(table.name).delete();
      
      // Tentar por e2e_run_id primeiro (mais eficiente)
      const { error: runErr } = await query.eq('e2e_run_id', runId);
      
      if (runErr) {
        if (runErr.code === '42703') { // Coluna não existe
          if (table.isUserCol) {
            const { error: idErr } = await supabase.from(table.name).delete().in(table.col, verifiedIds);
            if (idErr) throw idErr;
          } else if (table.isWalkRelated) {
             // Deletar via subquery de sessions do runId
             const { data: sess } = await supabase.from('walk_sessions').select('id').eq('e2e_run_id', runId);
             if (sess && sess.length > 0) {
               const { error: walkErr } = await supabase.from(table.name).delete().in(table.col, sess.map(s => s.id));
               if (walkErr) throw walkErr;
             }
          }
        } else {
          throw runErr;
        }
      }

      // 3. Verificação de Resíduos
      const { count, error: countErr } = await supabase
        .from(table.name)
        .select('*', { count: 'exact', head: true })
        .eq('e2e_run_id', runId);
        
      if (!countErr && count && count > 0) {
        throw new Error(JSON.stringify({ error: 'cleanup_incomplete', table: table.name, remaining: count }));
      }
    } catch (err: any) {
      if (err.code !== '42703') {
        throw new Error(JSON.stringify({ error: 'table_cleanup_failed', table: table.name, details: err }));
      }
    }
  }

  // 4. Deleção de usuários no Auth
  for (const uid of verifiedIds) {
    const { error: authDelError } = await supabase.auth.admin.deleteUser(uid);
    if (authDelError && authDelError.status !== 404) {
      throw new Error(JSON.stringify({ error: 'auth_user_delete_failed', uid, details: authDelError }));
    }
    
    // Verificação dupla
    const { data: exists } = await supabase.auth.admin.getUserById(uid);
    if (exists?.user) {
      throw new Error(JSON.stringify({ error: 'auth_ghost_user', uid }));
    }
  }

  console.log(`[cleanup] Sucesso total para runId: ${runId}. Zero resíduos.`);
}
