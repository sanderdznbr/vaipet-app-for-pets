/**
 * REPOSITÓRIO GITHUB: O projeto está atualmente hospedado na infraestrutura interna do Lovable (ID: 5edb42fd-d1f8-4525-b087-71641899d629).
 * Para conectar a um repositório GitHub externo, utilize o botão "GitHub" no menu superior da plataforma Lovable.
 * 
 * BASELINE STATUS: CONSOLIDADA.
 * 1. Schema real verificado (avatar_url: text, birth_date: date).
 * 2. Foreign Keys corrigidas (UUID).
 * 3. RPCs sincronizadas com o frontend.
 * 4. Migrations arquivadas em /archive.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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
