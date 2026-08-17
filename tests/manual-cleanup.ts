import { createClient } from '@supabase/supabase-js';

const adminClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function clean() {
  const { data: users } = await adminClient.auth.admin.listUsers();
  const e2eUsers = users.users.filter(u => u.user_metadata?.e2e_test === true || u.email?.includes('@example.com'));
  const ids = e2eUsers.map(u => u.id);
  
  if (ids.length > 0) {
    await adminClient.from('walk_pickup_codes').delete().filter('session_id', 'not.is', null); // Limpa tudo, é seguro em E2E
    await adminClient.from('walk_sessions').delete().in('customer_id', ids);
    await adminClient.from('pets').delete().in('owner_id', ids);
    await adminClient.from('petwalker_profiles').delete().in('user_id', ids);
    await adminClient.from('user_roles').delete().in('user_id', ids);
    await adminClient.from('profiles').delete().in('id', ids);
    for (const id of ids) await adminClient.auth.admin.deleteUser(id);
  }
  console.log(`Hard Cleaned ${ids.length} users.`);
}
clean();
