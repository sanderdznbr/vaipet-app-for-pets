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
    // Delete baseado estritamente no runId (onde houver coluna) ou nos verifiedIds
    let deleteQuery;
    if (['walk_pickup_codes', 'walker_tracking', 'walk_offers', 'petwalker_earnings', 'walk_sessions', 'pets', 'petwalker_profiles', 'profiles'].includes(table)) {
        deleteQuery = supabase.from(table).delete().eq('e2e_run_id', runId);
    } else if (table === 'user_roles') {
        deleteQuery = supabase.from(table).delete().in('user_id', verifiedIds);
    }

    const { error: delError } = await (deleteQuery as any);
    if (delError) {
      console.error(`[cleanup] Erro ao limpar tabela ${table}:`, delError);
      throw delError;
    }
    
    // Verificação rigorosa: count deve ser 0
    const { count, error: countError } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('e2e_run_id', runId);
    if (countError) throw countError;
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
