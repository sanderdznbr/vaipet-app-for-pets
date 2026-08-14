import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export const RedirectIndex = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  useEffect(() => {
    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }
    
    navigate('/inicio', { replace: true });
  }, [user, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F7F5EF]">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-2xl font-bold">Portal VaiPet</h1>
        <p className="text-muted-foreground">
          A correção funcional foi aceita provisoriamente, mas o relatório ainda não comprova os critérios finais de estabilidade. Não faça novas mudanças de arquitetura agora. Finalize somente a validação e apresente as evidências objetivas.
        </p>
      </div>
    </div>
  );
};

export default RedirectIndex;
