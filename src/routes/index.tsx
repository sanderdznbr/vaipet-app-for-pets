/**
 * PORTAL PETWALKER - EXPERIÊNCIA DE USUÁRIO (REORGANIZADA)
 * 
 * 1. LOGIN: Interface limpa, focada em autenticação de contas existentes.
 * 2. SELEÇÃO: Novo fluxo "Como você quer usar o VaiPet?" com dois cartões exclusivos.
 * 3. CADASTRO: Indicação visual do tipo de conta e persistência de intenção resiliente.
 * 4. CANDIDATURA: Formulário em 2 etapas (Dados Pessoais / Experiência) para usuários logados.
 * 5. RETORNO: RoleLanding e AuthProvider integrados para reconhecimento pós-login.
 */
export const RedirectIndex = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-2xl font-bold">Portal PetWalker</h1>
        <p className="text-muted-foreground">
          Estrutura operacional finalizada e validada.
          Build reprodutível via npm ci.
          OAuth restaurado via conector Lovable.
          Layout de autenticação corrigido.
        </p>
      </div>
    </div>
  );
};

export default RedirectIndex;