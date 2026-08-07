/**
 * BASELINE CONSOLIDADA:
 * - 18 TABELAS: profiles, user_roles, pets, petwalker_applications, petwalker_profiles, walk_sessions, petwalker_earnings, products, product_images, inventory, posts, post_likes, post_comments, notifications, locations, pet_documents, breed_photos, pet_models_3d.
 * - ARQUIVO: supabase/migrations/00000000000000_baseline_schema.sql (377 linhas, 13.9KB).
 * - HISTÓRICO: Diretório archive/ restaurado com 15 migrations para auditoria.
 * - STATUS: Estrutura completa versionada, segura e pronta para reconstrução de bancos vazios.
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

