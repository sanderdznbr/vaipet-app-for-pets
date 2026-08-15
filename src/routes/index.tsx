import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const RedirectIndex = () => {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (user) {
    return <Navigate to="/inicio" replace />;
  }

  return <Navigate to="/auth" replace />;
};

export default RedirectIndex;
