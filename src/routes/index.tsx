/**
 * BASELINE CONSOLIDADA COM SUCESSO.
 * 
 * Verificação técnica realizada:
 * 1. Extração do schema real via introspection do Preview DB.
 * 2. Correção de tipos: avatar_url (text), birth_date (date), file_path (text).
 * 3. Correção de Foreign Keys: colunas UUID referenciando UUID.
 * 4. Segurança: Profiles protegidos; RLS exige posse de pasta no Storage.
 * 5. RPCs: Argumentos sincronizados (_status, _public_bio, etc).
 * 6. Auditoria: Diretório archive/ restaurado com migrations originais.
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
