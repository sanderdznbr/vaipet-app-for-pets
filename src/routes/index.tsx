/**
 * DIAGNÓSTICO E CORREÇÃO DA BASELINE - 07/08/2026 21:55 UTC
 * 
 * 1. AÇÕES REALIZADAS:
 * - Constraint 'valid_initial_status' removida (permitindo aprovação/rejeição via RPC).
 * - Proteção de INSERT em petwalker_applications movida para RLS WITH CHECK (Zero-Trust).
 * - RPC 'get_public_petwalker_profiles' IMPLEMENTADA (Security Definer, authenticated only).
 * - Leitura direta de 'petwalker_profiles' BLOQUEADA para terceiros.
 * - Caminhos de upload padronizados: {userId}/{categoria}/...
 * - Policies de Storage consolidadas com validação rigorosa de prefixo {userId}/.
 * 
 * 2. VALIDAÇÃO:
 * - Build e Lint verificados.
 * - Migrações executáveis: baseline_schema + hardening_turn_2.
 * - Archive: 15 migrações originais.
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
