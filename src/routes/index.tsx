/**
 * BASELINE CONSOLIDADA E VALIDADA:
 * - 18 TABELAS: profiles, user_roles, pets, petwalker_applications, petwalker_profiles, walk_sessions, petwalker_earnings, products, product_images, inventory, posts, post_likes, post_comments, notifications, locations, pet_documents, breed_photos, pet_models_3d.
 * - INTEGRIDADE: Colunas e tipos rigorosamente sincronizados com types.ts.
 * - PRIVACIDADE: Profiles protegidos (SELECT bloqueado, acesso via get_public_profiles RPC).
 * - SEGURANÇA: user_roles.role bloqueado para UPDATE por usuários comuns. RPCs de aprovação com travas transacionais.
 * - STORAGE: Buckets pet-photos, pet-documents e product-images configurados com RLS.
 * - ARQUIVO: supabase/migrations/00000000000000_baseline_schema.sql.
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

