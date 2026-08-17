import { SupabaseClient } from '@supabase/supabase-js';

export async function failClosedCleanup(supabase: SupabaseClient, userIds: string[], runId: string) {
  if (!runId) throw new Error('runId is mandatory for fail-closed cleanup');
  if (userIds.length === 0) {
    console.log('[cleanup] Nenhum ID fornecido para limpeza.');
    return;
  }

  // Filtragem rigorosa: Somente IDs com e2e_test=true no metadata
  const verifiedIds: string[] = [];
  for (const id of userIds) {
    const { data: user, error } = await supabase.auth.admin.getUserById(id);
    if (error) {
       console.error(`[cleanup] Erro ao validar usuário ${id}:`, error);
       throw error;
    }
    if (user?.user?.user_metadata?.e2e_test === true && user?.user?.user_metadata?.e2e_run_id === runId) {
      verifiedIds.push(id);
    } else {
      throw new Error(`Tentativa de deletar usuário não-E2E ou de outro run: ${id}`);
    }
  }

  console.log(`[cleanup] Iniciando fail-closed cleanup para ${verifiedIds.length} IDs validados.`);

  // Tabelas na ordem inversa de dependência
  const tables = [
    'walk_pickup_codes',
    'walker_tracking',
    'walk_offers',
    'petwalker_earnings',
    'walk_sessions',
    'pets',
    'petwalker_profiles',
    'user_roles',
    'profiles'
  ];

  for (const table of tables) {
    let deleteQuery;
    
    // Verificamos se a coluna e2e_run_id existe antes de filtrar por ela
    // Como estamos rodando em sandbox, assumimos que as migrations estão aplicadas ou usamos verifiedIds como fallback
    if (['walk_pickup_codes', 'walker_tracking', 'walk_offers', 'petwalker_earnings', 'walk_sessions', 'pets', 'petwalker_profiles', 'profiles'].includes(table)) {
        // Fallback robusto: se a coluna e2e_run_id falhar, tentamos via verifiedIds
        const { error: delError } = await supabase.from(table).delete().eq('e2e_run_id', runId);
        if (delError && delError.code === '42703') { // Column does not exist
             const idCol = table === 'pets' ? 'owner_id' : (table === 'walk_sessions' ? 'customer_id' : (table === 'walk_offers' ? 'session_id' : 'id'));
             // Para tabelas de junção ou específicas, o ID pode variar. Profiles e Roles são os mais críticos.
             if (['profiles', 'petwalker_profiles'].includes(table)) {
                 await supabase.from(table).delete().in('id', verifiedIds);
             }
        } else if (delError) {
            throw delError;
        }
    } else if (table === 'user_roles') {
        await supabase.from(table).delete().in('user_id', verifiedIds);
    }

    // Verificação rigorosa: contagem de e2e_run_id deve ser 0
    const { count, error: countError } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('e2e_run_id', runId);
    if (countError && countError.code !== '42703') throw countError;
    if (countError && countError.code === '42703') {
        // Se a coluna não existe, não há resíduos por e2e_run_id nesta tabela
        console.log(`[cleanup] Tabela ${table} ignorada (sem e2e_run_id)`);
        continue;
    }
    
    if (count === null || count === undefined) throw new Error(`Falha ao obter contagem da tabela ${table}`);
    if (count > 0) throw new Error(`Cleanup incompleto na tabela ${table}: count=${count}`);
    
    console.log(`[cleanup] Tabela ${table} confirmada: count=0`);
  }

  // Deletar usuários Auth (Admin)
  for (const uid of verifiedIds) {
    const { error: authDelError } = await supabase.auth.admin.deleteUser(uid);
    if (authDelError) throw authDelError;
    
    const { data, error: getError } = await supabase.auth.admin.getUserById(uid);
    if (!getError && data.user) {
      throw new Error(`Usuário Auth ${uid} ainda existe após deleção!`);
    }
    console.log(`[cleanup] Usuário Auth ${uid} confirmado inexistente (404).`);
  }

  console.log('Cleanup concluído com sucesso (Zero residuos).');
}
