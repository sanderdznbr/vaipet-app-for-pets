import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function debug() {
  const { data: users } = await adminClient.auth.admin.listUsers();
  const owner = users.users.find(u => u.email?.startsWith('owner-sec-'));
  if (!owner) {
    console.log('No owner found');
    return;
  }
  
  const { data: walk } = await adminClient.from('walk_sessions').select('*').eq('customer_id', owner.id).single();
  console.log('Walk Session:', JSON.stringify(walk, null, 2));

  const { data, error } = await adminClient.auth.signInWithPassword({
    email: owner.email!,
    password: 'VaiPet@2026'
  });
  
  const userClient = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${data.session?.access_token}` } }
  });

  const rpc = await userClient.rpc('customer_get_pickup_code', { _session_id: walk.id });
  console.log('RPC Result:', JSON.stringify(rpc, null, 2));
}

debug();
