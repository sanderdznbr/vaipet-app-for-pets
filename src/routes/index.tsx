/**
 * PORTAL PETWALKER - STATUS DA CONSOLIDAÇÃO (REHARDENED v3)
 * 
 * 1. GERENCIADOR DE PACOTES: npm (oficializado). lockfile regenerado.
 * 2. AUTH RESILIENCE: Intent OAuth não é mais removida em erro de rede/timeout. requestId dedicado.
 * 3. ROLE LANDING: Tratamento de erros explícito para petwalker_profiles. Roteamento operacional blindado.
 * 4. SEGURANÇA: RPC set_petwalker_availability com validação dupla (role + approved).
 * 5. WIZARD: Validação estrita do parâmetro ?intent= (apenas pet_owner ou petwalker).
 */
export const RedirectIndex = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-2xl font-bold">Portal PetWalker</h1>
        <p className="text-muted-foreground">
          Estrutura operacional finalizada e validada.
          Build reprodutível via npm ci.
          Redirecionamento operacional resiliente.
        </p>
      </div>
    </div>
  );
};

export default RedirectIndex;