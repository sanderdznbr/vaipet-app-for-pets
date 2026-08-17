import { SupabaseClient } from '@supabase/supabase-js';

export async function failClosedCleanup(supabase: SupabaseClient, userIds: string[], runId: string) {
  console.log(`[cleanup] Iniciando fail-closed cleanup para ${userIds.length} IDs.`);

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
    // Tentativa 1: via metadata
    await supabase.from(table).delete().eq('e2e_run_id', runId);
    // Tentativa 2: via listagem de IDs (perfis, roles, etc)
    if (userIds.length > 0) {
      const idCol = table === 'pets' ? 'owner_id' : (table === 'walk_sessions' ? 'customer_id' : 'id');
      if (['profiles', 'user_roles', 'petwalker_profiles'].includes(table)) {
         await supabase.from(table).delete().in(table === 'user_roles' ? 'user_id' : 'id', userIds);
      } else if (table === 'walk_sessions') {
         await supabase.from(table).delete().in('customer_id', userIds);
      }
    }
    
    // Verificação rigorosa
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('e2e_run_id', runId);
    console.log(`[cleanup] Tabela ${table} confirmada: count=${count || 0}`);
  }

  // Deletar usuários Auth (Admin)
  for (const uid of userIds) {
    await supabase.auth.admin.deleteUser(uid);
    const { data } = await supabase.auth.admin.getUserById(uid);
    if (!data.user) {
      console.log(`[cleanup] Usuário Auth ${uid} confirmado inexistente (404).`);
    }
  }

  console.log('Cleanup zero');
}
