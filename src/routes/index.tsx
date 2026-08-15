import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/**
 * Não altere nenhum arquivo ainda.
 * 
 * Agora que o preflightCleanup removeu os 14 usuários órfãos, execute novamente somente:
 * 
 * npm run test:e2e:walk:matching
 * 
 * Registre:
 * 
 * 1. Comando interno executado pelo script.
 * 2. Exit Code.
 * 3. Duração total.
 * 4. Resultado completo do Playwright.
 * 5. Confirmação individual de que:
 *    - o dono criou a solicitação;
 *    - a oferta apareceu para o PetWalker pela interface;
 *    - o PetWalker aceitou;
 *    - o banco registrou apenas o aceite esperado;
 *    - todas as assertions do corpo do teste terminaram antes do teardown;
 *    - o cleanup de dados terminou com zero resíduos.
 * 
 * 6. Se falhar, informe:
 *    - stack trace completo;
 *    - arquivo e linha exata;
 *    - nome do BrowserContext que não fechou;
 *    - se ele já estava encerrado quando context.close foi chamado;
 *    - caminhos de trace, screenshot e vídeo.
 * 
 * Não considere a criação do pet como prova do matching completo. Só declare PASS se o comando finalizar com Exit Code 0.
 * 
 * Se repetir o timeout em browserContext.close, não esconda nem ignore o erro: diagnostique o ciclo de vida dos contextos e proponha o patch mínimo, mantendo o cleanup de dados fail-closed.
 */
const RedirectIndex = () => {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (user) {
    return <Navigate to="/inicio" replace />;
  }

  return <Navigate to="/auth" replace />;
};

export default RedirectIndex;