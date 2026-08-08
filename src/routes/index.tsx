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