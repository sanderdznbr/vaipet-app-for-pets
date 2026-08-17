import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
  console.log('Cleaning up residual E2E data (Deep Clean)...');
  
  // 1. Apagar PINs vinculados a sessões E2E
  const { data: e2eSessions } = await adminClient.from('walk_sessions').select('id').eq('e2e_test', true);
  const sessionIds = e2eSessions?.map(s => s.id) || [];
  if (sessionIds.length > 0) {
    await adminClient.from('walk_pickup_codes').delete().in('session_id', sessionIds);
  }

  // 2. Apagar tabelas sem e2e_test mas ligadas a usuários/sessões
  await adminClient.from('walker_tracking').delete().filter('session_id', 'in', `(${sessionIds.join(',')})`);
  await adminClient.from('walk_offers').delete().filter('walk_session_id', 'in', `(${sessionIds.join(',')})`);
  
  // 3. Tabelas principais
  const tables = ['walk_sessions', 'pets', 'petwalker_profiles', 'profiles'];
  for (const t of tables) {
    await adminClient.from(t).delete().eq('e2e_test', true);
  }
  
  // 4. Limpar user_roles (não tem e2e_test)
  const { data: users } = await adminClient.auth.admin.listUsers();
  const e2eUsers = users.users.filter(u => u.email?.includes('-op-') || u.email?.includes('-sec-'));
  const e2eUserIds = e2eUsers.map(u => u.id);
  if (e2eUserIds.length > 0) {
    await adminClient.from('user_roles').delete().in('user_id', e2eUserIds);
  }

  // 5. Auth
  for (const u of e2eUsers) {
    await adminClient.auth.admin.deleteUser(u.id);
  }
  console.log(`Deep Cleaned ${e2eUsers.length} users and ${sessionIds.length} sessions.`);
}
clean();
