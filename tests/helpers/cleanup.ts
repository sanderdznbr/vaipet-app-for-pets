import { type SupabaseClient } from "@supabase/supabase-js";

export async function failClosedCleanup(admin: SupabaseClient, ids: string[], runId?: string) {
  if (!ids.length) return;
  
  console.log(`[cleanup] Iniciando fail-closed cleanup para IDs: ${ids.join(', ')}`);

  // 1. Exclusão de sessões e dependências
  const { data: sessions, error: sErr } = await admin
    .from("walk_sessions")
    .select("id")
    .or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  
  if (sErr) throw new Error(`Erro ao buscar sessões para cleanup: ${sErr.message}`);

  if (sessions && sessions.length > 0) {
    const sIds = sessions.map(s => s.id);
    await admin.from("walker_tracking").delete().in("walk_session_id", sIds);
    await admin.from("walk_offers").delete().in("session_id", sIds);
    await admin.from("petwalker_earnings").delete().in("walk_session_id", sIds);
    const { error: delErr } = await admin.from("walk_sessions").delete().in("id", sIds);
    if (delErr) throw new Error(`Erro ao deletar sessões: ${delErr.message}`);
  }

  // 2. Exclusão de pets
  const { error: pErr } = await admin.from("pets").delete().in("owner_id", ids);
  if (pErr) throw new Error(`Erro ao deletar pets: ${pErr.message}`);

  // 3. Exclusão de perfis petwalker
  const { error: pwErr } = await admin.from("petwalker_profiles").delete().in("user_id", ids);
  if (pwErr) throw new Error(`Erro ao deletar perfis walker: ${pwErr.message}`);

  // 4. Exclusão de roles
  const { error: rErr } = await admin.from("user_roles").delete().in("user_id", ids);
  if (rErr) throw new Error(`Erro ao deletar roles: ${rErr.message}`);

  // 5. Exclusão de perfis
  const { error: profErr } = await admin.from("profiles").delete().in("id", ids);
  if (profErr) throw new Error(`Erro ao deletar perfis: ${profErr.message}`);

  // 6. Exclusão de usuários Auth
  for (const id of ids) {
    const { error: authErr } = await admin.auth.admin.deleteUser(id);
    if (authErr && !authErr.message.includes("User not found")) {
      throw new Error(`Erro ao deletar usuário ${id}: ${authErr.message}`);
    }
  }

  // 7. Validações finais de integridade
  const { data: remainSessions } = await admin.from("walk_sessions").select("id").or(`customer_id.in.(${ids.join(",")}),walker_id.in.(${ids.join(",")})`);
  if (remainSessions?.length) throw new Error(`Resíduo detectado em walk_sessions: ${remainSessions.length}`);

  const { data: remainPets } = await admin.from("pets").select("id").in("owner_id", ids);
  if (remainPets?.length) throw new Error(`Resíduo detectado em pets: ${remainPets.length}`);

  for (const id of ids) {
    const { data: u } = await admin.auth.admin.getUserById(id);
    if (u.user) throw new Error(`Usuário Auth ${id} ainda existe após exclusão`);
  }

  console.log("Cleanup zero");
}
