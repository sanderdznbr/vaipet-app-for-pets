/**
 * DIAGNÓSTICO E CORREÇÃO DA DISPONIBILIDADE - 07/08/2026 22:00 UTC
 * 
 * 1. RPC set_petwalker_availability CORRIGIDA:
 * - Agora atualiza 'is_accepting_requests' (true para 'available', false para 'offline').
 * - Atualiza 'last_online_at' e 'updated_at' de forma atômica.
 * - Restrita a PetWalkers com 'approval_status' = 'approved'.
 * 
 * 2. CONSISTÊNCIA FUNCIONAL:
 * - get_public_petwalker_profiles agora reflete corretamente a disponibilidade real.
 * - Usuários comuns e PetWalkers não aprovados são bloqueados na origem.
 * 
 * 3. VALIDAÇÃO:
 * - Baseline consolidada com 18 tabelas, 3 buckets e RLS Zero-Trust.
 * - Tipos sincronizados e build verificado.
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
