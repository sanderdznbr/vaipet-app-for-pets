import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Redirects to /inicio which is the main landing page of the application.
 */
const RedirectIndex = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/inicio', { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F5EF]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-[#31D880] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-medium opacity-50">Carregando...</p>
      </div>
    </div>
  );
};

export default RedirectIndex;
