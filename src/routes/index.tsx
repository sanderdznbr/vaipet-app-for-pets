/**
 * O aceite isolado do PetWalker está CERTIFICADO com evidências completas.
 *
 * Agora falta somente a execução integrada final da Phase 3.1.
 *
 * Antes de executar, audite o teste completo:
 *
 * rg -n "fallback|accessibility shortcut|dispatchEvent|PointerEvent|page.evaluate|force:|petwalker/painel|walk-details" tests/walk-real-e2e.spec.ts
 *
 * O matching completo deve reutilizar exatamente os fluxos já certificados:
 *
 * OWNER:
 *
 * - autenticação real;
 *
 * - seleção real do pet;
 *
 * - tipo e duração;
 *
 * - arrasto real do SlideToConfirm com page.mouse;
 *
 * - criação da walk_session;
 *
 * - status searching.
 *
 * PETWALKER:
 *
 * - autenticação real;
 *
 * - rota /petwalker;
 *
 * - transição “Ficar Online”, se necessária;
 *
 * - oferta da mesma session_id visível;
 *
 * - clique em data-testid="walker-accept-button";
 *
 * - RPC 200;
 *
 * - walker_id esperado === gravado;
 *
 * - status searching → accepted;
 *
 * - navegação para /petwalker/passeio/{session_id}.
 *
 * Remova do teste completo qualquer fluxo antigo, incluindo:
 *
 * - /petwalker/painel;
 *
 * - /walk-details;
 *
 * - fallback de clique no slider;
 *
 * - comportamento exclusivo para headless;
 *
 * - eventos sintéticos;
 *
 * - force:true.
 *
 * Não altere código funcional já certificado. Faça somente a sincronização do E2E completo com os dois testes isolados aprovados.
 *
 * Execute uma única vez:
 *
 * npx playwright test tests/walk-real-e2e.spec.ts -g "matching:" --reporter=line
 *
 * PLAYWRIGHT_EXIT_CODE=$?
 *
 * echo PLAYWRIGHT_EXIT_CODE=$PLAYWRIGHT_EXIT_CODE
 *
 * Registre na saída:
 *
 * - owner_id;
 *
 * - walker_id esperado;
 *
 * - session_id;
 *
 * - status após publicação;
 *
 * - confirmação da oferta visível;
 *
 * - resposta RPC;
 *
 * - walker_id gravado;
 *
 * - status depois do aceite;
 *
 * - URL final;
 *
 * - contagens finais do cleanup.
 *
 * Critérios finais:
 *
 * - “1 passed”;
 *
 * - PLAYWRIGHT_EXIT_CODE=0;
 *
 * - mesma session_id do início ao fim;
 *
 * - searching → accepted;
 *
 * - walker_id correto;
 *
 * - URL /petwalker/passeio/{session_id};
 *
 * - cleanup zero.
 *
 * Timeout ou SIGTERM continuam sendo FAIL.
 *
 * Se passar:
 *
 * 1. Execute npx tsc --noEmit;
 *
 * 2. Execute npm run build;
 *
 * 3. Atualize docs/PHASE3_STABILIZATION.md com os resultados brutos;
 *
 * 4. Atualize a Security Memory para “Matching E2E integrado: CERTIFICADO”;
 *
 * 5. Mostre HEAD completo, git status --short e git diff --stat;
 *
 * 6. Só então declare a Phase 3.1 concluída.
 *
 * Se falhar, informe apenas o primeiro step real que falhou e não altere novamente os fluxos isolados já certificados.
 */

import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const RedirectIndex = () => {
  const { user, loading, authStatus } = useAuth();

  // Enquanto estiver inicializando (hydrating), não redirecionamos
  if (loading && authStatus === 'initializing') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/inicio" replace />;
  }

  return <Navigate to="/auth" replace />;
};

export default RedirectIndex;