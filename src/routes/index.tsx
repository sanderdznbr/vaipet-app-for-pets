/**
 * ACCOUNT INTENT FLOW (HARDENED & SYNCED)
 * 1. Intent Selection in Auth.tsx or SignupWizard.tsx
 * 2. AuthProvider resiliently processes intent from localStorage with timeout/retry
 * 3. RoleLanding handles redirection priority: PetWalker role > Petwalker Profile Status > Intent
 * 4. PetwalkerInscricao tracks application status with real-time subscription & auth guard
 * 5. handle_new_user trigger correctly captures phone and signup intent
 * 6. set_petwalker_availability requires dual validation: role petwalker AND approved profile
 */
export const RedirectIndex = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-2xl font-bold">Portal PetWalker</h1>
        <p className="text-muted-foreground">
          O fluxo de intenção de conta foi corrigido e endurecido:
          - Migrations reconciliadas sem duplicidade.
          - Segurança da disponibilidade restaurada.
          - Persistência OAuth resiliente.
          - Roteamento operacional por petwalker_profiles.
        </p>
      </div>
    </div>
  );
};

export default RedirectIndex;