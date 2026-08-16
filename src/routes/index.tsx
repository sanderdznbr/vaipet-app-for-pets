/**
 * O resultado foi aceito. A falha agora está isolada no aceite do PetWalker.
 *
 * Não execute novamente o E2E completo.
 *
 * Não aumente timeout.
 *
 * Não altere a lógica da aplicação sem diagnóstico.
 *
 * Não declare a Phase 3.1 certificada.
 *
 * PARTE 1 — DIAGNÓSTICO EXATO DO STEP 12
 *
 * Mostre:
 *
 * 1. Código completo dos Steps 11, 12 e 13;
 *
 * 2. Linha exata aguardada quando ocorreu o timeout;
 *
 * 3. URL do PetWalker no momento da falha;
 *
 * 4. Screenshot da oferta visível;
 *
 * 5. Todos os botões, links e textos visíveis nessa tela;
 *
 * 6. Console errors, page errors, requests failed e HTTP >= 400;
 *
 * 7. Código do componente/cartão usado para aceitar a oferta;
 *
 * 8. RPC/função chamada pela interface no aceite.
 *
 * Execute:
 *
 * rg -n -C 40 "walker: accept-via-ui|acceptance-confirmed|accept_walk_request|Aceitar|walk-details" src tests
 *
 * Determine se o bloqueio ocorreu:
 *
 * - ao localizar o botão;
 *
 * - ao clicar/arrastar;
 *
 * - durante a chamada RPC;
 *
 * - ao aguardar navegação;
 *
 * - ou ao validar o banco.
 *
 * PARTE 2 — TESTE ISOLADO DO ACEITE
 *
 * Crie um teste específico chamado “walker-acceptance:” com setup controlado.
 *
 * O setup pode usar service_role exclusivamente para:
 *
 * - provisionar Owner e PetWalker E2E;
 *
 * - criar pet E2E;
 *
 * - criar uma walk_session válida em searching;
 *
 * - criar/gerar a oferta canônica para o PetWalker.
 *
 * O teste propriamente dito deve obrigatoriamente:
 *
 * 1. Autenticar o PetWalker pela interface real;
 *
 * 2. Navegar para /petwalker;
 *
 * 3. Visualizar a oferta;
 *
 * 4. Aceitar pela interface real;
 *
 * 5. Usar a mesma interação disponível ao usuário em produção;
 *
 * 6. Aguardar a resposta real da RPC;
 *
 * 7. Confirmar no banco:
 *
 *    - walker_id gravado === ID do PetWalker autenticado;
 *
 *    - status anterior === searching;
 *
 *    - status posterior === accepted;
 *
 * 8. Confirmar visualmente a navegação/estado de passeio aceito;
 *
 * 9. Executar cleanup fail-closed com zero resíduos.
 *
 * Não use:
 *
 * - chamada direta à accept_walk_request pelo teste;
 *
 * - page.evaluate;
 *
 * - dispatchEvent;
 *
 * - PointerEvent sintético;
 *
 * - force:true;
 *
 * - comportamento exclusivo para headless;
 *
 * - alteração direta do status para accepted.
 *
 * É permitido adicionar data-testid sem alterar comportamento.
 *
 * PARTE 3 — FAIL-FAST E EVIDÊNCIAS
 *
 * Cada espera do aceite deve ter timeout máximo de 20 segundos.
 *
 * Registre:
 *
 * - session_id;
 *
 * - walker_id esperado;
 *
 * - walker_id gravado;
 *
 * - status antes;
 *
 * - status depois;
 *
 * - URL antes do aceite;
 *
 * - URL depois do aceite;
 *
 * - status HTTP/RPC;
 *
 * - mensagem de erro sanitizada, se existir.
 *
 * Execute somente:
 *
 * npx playwright test tests/walk-real-e2e.spec.ts -g "walker-acceptance:" --reporter=line
 *
 * PLAYWRIGHT_EXIT_CODE=$?
 *
 * echo PLAYWRIGHT_EXIT_CODE=$PLAYWRIGHT_EXIT_CODE
 *
 * Critérios obrigatórios:
 *
 * - “1 passed”;
 *
 * - PLAYWRIGHT_EXIT_CODE=0;
 *
 * - walker_id correto;
 *
 * - status accepted;
 *
 * - confirmação visual;
 *
 * - cleanup zero;
 *
 * - duração inferior a 90 segundos.
 *
 * Se falhar, informe a primeira linha Playwright que falhou e preserve trace, screenshot e vídeo. Não faça commit nem tente o E2E completo.
 *
 * Inclua também:
 *
 * git rev-parse HEAD
 *
 * git status --short
 *
 * git diff --stat
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