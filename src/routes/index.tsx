import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const Index = () => {
  const { session, roles, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  // Multi-role redirection authority
  if (roles && roles.includes('petwalker')) {
    return <Navigate to="/walker/painel" replace />;
  }

  return <Navigate to="/home" replace />;
};

export default Index;
