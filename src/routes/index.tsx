/**
 * REPOSITÓRIO GITHUB: O projeto está hospedado internamente no Lovable (ID: 5edb42fd-d1f8-4525-b087-71641899d629).
 * 
 * BASELINE STATUS: CONSOLIDADA E VALIDADA (Zero-Trust Security).
 * 1. Proteção de Colunas: perfis e métricas blindados contra alteração direta.
 * 2. Validação Server-side: Candidaturas com regras de inserção e aprovação atômica.
 * 3. Zero-Trust RLS: Políticas granulares para todas as 18 tabelas.
 * 4. Storage Hardened: Buckets com validação de propriedade por pasta.
 * 5. RPCs Hardened: SECURITY DEFINER com search_path e revogação de execução pública.
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
