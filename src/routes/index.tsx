import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const Index = () => {
  const { user, profile, loading, authStatus } = useAuth();

  if (loading || authStatus === 'initializing') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Redireciona usuários autenticados para /inicio respeitando onboarding
  if (profile?.onboarding_completed) {
    return <Navigate to="/inicio" replace />;
  }

  // Se não completou onboarding mas está logado, vai para /inicio também 
  // (ou você pode definir uma rota de onboarding específica se existir)
  return <Navigate to="/inicio" replace />;
};

export default Index;
