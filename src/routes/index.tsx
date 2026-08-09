import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export const RedirectIndex = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    navigate('/inicio', { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F7F5EF]">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-2xl font-bold">Portal VaiPet</h1>
        <p className="text-muted-foreground animate-pulse">
          Redirecionando para o início...
        </p>
      </div>
    </div>
  );
};

export default RedirectIndex;