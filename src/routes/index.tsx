/**
 * ACCOUNT INTENT FLOW (RE-HARDENED)
 * 1. Intent Selection in Auth.tsx or SignupWizard.tsx
 * 2. AuthProvider processes pending intent from localStorage after OAuth login
 * 3. RoleLanding handles redirection priority: PetWalker role > Application status > Intent
 * 4. PetwalkerInscricao tracks application status via manual refresh or realtime subscription
 * 5. handle_new_user trigger correctly handles signup_intent and meta data
 * 6. Zero-Trust RLS prevents role elevation and direct operational profile reads
 */
export const RedirectIndex = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-2xl font-bold">Portal PetWalker</h1>
        <p className="text-muted-foreground">
          O fluxo de intenção de conta foi totalmente implementado:
          - Cadastro unificado com escolha de intenção.
          - Redirecionamento inteligente PetWalker vs Dono de Pet.
          - Acompanhamento de candidatura em tempo real.
          - Segurança Zero-Trust validada.
        </p>
      </div>
    </div>
  );
};

export default RedirectIndex;