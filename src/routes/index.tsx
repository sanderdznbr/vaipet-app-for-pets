/**
 * REPOSITÓRIO GITHUB: O projeto está hospedado internamente no Lovable (ID: 5edb42fd-d1f8-4525-b087-71641899d629).
 * 
 * BASELINE STATUS: CONSOLIDADA E VALIDADA (Fidelity 100% types.ts).
 * 1. Todos os tipos corrigidos (avatar_url: text, birth_date: date, etc).
 * 2. Foreign Keys rigorosamente UUID -> UUID.
 * 3. RPCs sincronizadas (_status, _public_bio, etc).
 * 4. Pet Models 3D corrigido com pet_id.
 * 5. Security: RLS restrito, profiles protegidos, storage com owner check.
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
