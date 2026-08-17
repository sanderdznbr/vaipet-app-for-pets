import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
  console.log('Cleaning up residual E2E data...');
  const tables = ['walk_pickup_codes', 'walker_tracking', 'walk_offers', 'petwalker_earnings', 'walk_sessions', 'pets', 'petwalker_profiles', 'user_roles', 'profiles'];
  for (const t of tables) {
    const { error } = await adminClient.from(t).delete().eq('e2e_test', true);
    if (error) console.error(`Error cleaning ${t}: ${error.message}`);
  }
  
  const { data: users } = await adminClient.auth.admin.listUsers();
  const e2eUsers = users.users.filter(u => u.email?.includes('-op-') || u.email?.includes('-sec-'));
  for (const u of e2eUsers) {
    await adminClient.auth.admin.deleteUser(u.id);
  }
  console.log(`Cleaned ${e2eUsers.length} users.`);
}
clean();
