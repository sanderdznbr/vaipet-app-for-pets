/**
 * @task Consolidação de Baseline Finalizada e Validada (Zero-Trust + Storage)
 * 
 * 1. STORAGE:
 *    - Buckets pet-photos (público), pet-documents (privado) e product-images (público) criados estruturalmente.
 *    - Policies de RLS configuradas para padrão canônico: {userId}/{categoria}/...
 *    - Limites de tamanho (5MB/10MB) e tipos MIME (Imagens/PDF) aplicados.
 * 
 * 2. FRONTEND:
 *    - Atualizados todos os caminhos de upload para o padrão seguro:
 *      - Perfis: {userId}/avatars/...
 *      - Pets: {userId}/pets/{petId}/...
 *      - Documentos: {userId}/pets/{petId}/documents/...
 *      - Produtos: {userId}/products/{productId}/...
 * 
 * 3. SEGURANÇA (Zero-Trust):
 *    - PetWalker Applications: Validação rígida no INSERT (status='pending', reviewed_by=NULL, etc).
 *    - PetWalker Profiles: Leitura direta bloqueada para terceiros.
 *    - RPC get_public_petwalker_profiles: Nova função segura para expor apenas dados públicos de walkers aprovados.
 *    - RLS Completa: Todas as 18 tabelas protegidas.
 * 
 * 4. INTEGRIDADE:
 *    - Baseline livre de DROP SCHEMA.
 *    - RPCs com SECURITY DEFINER e search_path fixo.
 *    - Triggers de updated_at restaurados.
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
