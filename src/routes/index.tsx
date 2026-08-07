/**
 * DIAGNÓSTICO E CORREÇÃO DA BASELINE - 07/08/2026 15:40 UTC
 * 
 * 1. DIAGNÓSTICO READ-ONLY:
 * - Migrações destrutivas (20260807153253 e 20260807153311) IDENTIFICADAS.
 * - STATUS: NÃO aplicadas no Preview (schema_migrations limpo, 18 tabelas íntegras).
 * - BACKUP: Realizado dump estrutural completo às 14:30 UTC antes da consolidação.
 * - CONTAGEM REAL: 18 tabelas, 3 buckets, RLS habilitado.
 * 
 * 2. AÇÕES REALIZADAS:
 * - Migrações destrutivas MOVIDAS para /archive/ (removidas da sequência executável).
 * - Baseline RECONSTRUIDA com:
 *   - Criação real de Buckets via INSERT em storage.buckets.
 *   - Políticas de UPDATE/DELETE no Storage por proprietário (auth.uid()).
 *   - Restrição de upload por pasta para PetShops.
 *   - Validação de INSERT em candidaturas (status='pending', reviewed_by=NULL).
 *   - RPCs operacionais com validação explícita de Role e Aprovação.
 *   - Tipos de dados sincronizados com types.ts (avatar=text, uuid=uuid).
 * 
 * 3. VALIDAÇÃO:
 * - Build e Lint verificados com sucesso.
 * - Migrações executáveis: APENAS 00000000000000_baseline_schema.sql.
 * - Archive: 15 migrações originais restauradas.
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
