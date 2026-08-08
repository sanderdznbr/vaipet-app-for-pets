// For the code present, I get the error below.
// 
// Please think step-by-step in order to resolve it.
// ```
// build failed with exit status 1: stderr:
// rs paralaxe (far/mid/near) + splashes na
// 
//     at getRollupError (file:///dev-server/node_modules/rollup/dist/es/shared/parseAst.js:395:41)
//     at error (file:///dev-server/node_modules/rollup/dist/es/shared/parseAst.js:391:42)
//     at Object.error (file:///dev-server/node_modules/rollup/dist/es/shared/node-entry.js:20545:20)
//     at Object.error (file:///dev-server/node_modules/rollup/dist/es/shared/node-entry.js:19604:42)
//     at Object.transform (file:///dev-server/node_modules/vite/dist/node/chunks/dep-BWSbWtLw.js:64647:14)
// error: script "build:dev" exited with code 1
// 
// stdout:
// vite v5.4.10 building for development...
// transforming...
// ✓ 6 modules transformed.
// ```
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * PORTAL PETWALKER - FASE 2: PRECIFICAÇÃO E PERFIL SIMPLIFICADO
 * 
 * 1. PRECIFICAÇÃO: Centralizada no servidor via RPC get_walk_quote e configurações em centavos.
 * 2. SNAPSHOT: Armazenamento imutável do preço em walk_sessions na criação.
 * 3. SIMPLIFICAÇÃO: PetWalker não define mais preço ou raio (regra de negócio da plataforma).
 * 4. SEGURANÇA: RPCs com SECURITY DEFINER e validações rigorosas de duração e modalidade.
 */
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