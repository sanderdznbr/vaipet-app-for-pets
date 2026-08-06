import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft } from 'lucide-react';

const PetwalkerInscricao = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    legal_name: user?.user_metadata?.full_name || '',
    birth_date: '',
    phone: user?.user_metadata?.phone || '',
    city: '',
    experience_description: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Basic age validation
    const birthDate = new Date(formData.birth_date);
    const age = new Date().getFullYear() - birthDate.getFullYear();
    if (age < 18) {
      toast.error('Você deve ter pelo menos 18 anos para se inscrever.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('petwalker_applications').insert([
        {
          user_id: user.id,
          ...formData,
          status: 'pending',
          submitted_at: new Date().toISOString(),
        },
      ]);

      if (error) throw error;

      toast.success('Inscrição enviada com sucesso! Analisaremos seus dados.');
      navigate('/inicio');
    } catch (err: any) {
      console.error('Erro ao enviar inscrição:', err);
      toast.error(err.message || 'Erro ao processar inscrição');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F5EF] pb-10">
      <div className="max-w-md mx-auto p-6">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-gray-500 font-medium">
          <ChevronLeft size={20} />
          Voltar
        </button>

        <h1 className="text-2xl font-bold mb-2">Trabalhe como PetWalker</h1>
        <p className="text-gray-500 mb-8">Preencha seus dados para análise. Entraremos em contato em breve.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Nome Completo (RG)</label>
            <Input 
              required 
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.legal_name}
              onChange={e => setFormData({...formData, legal_name: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Data de Nascimento</label>
            <Input 
              required 
              type="date"
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.birth_date}
              onChange={e => setFormData({...formData, birth_date: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Telefone WhatsApp</label>
            <Input 
              required 
              placeholder="(00) 00000-0000"
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.phone}
              onChange={e => setFormData({...formData, phone: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Cidade de Atuação</label>
            <Input 
              required 
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.city}
              onChange={e => setFormData({...formData, city: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Fale sobre sua experiência</label>
            <Textarea 
              required 
              placeholder="Conte-nos sobre sua relação com pets..."
              className="min-h-[120px] rounded-2xl bg-white border-none shadow-sm p-4"
              value={formData.experience_description}
              onChange={e => setFormData({...formData, experience_description: e.target.value})}
            />
          </div>

          <div className="pt-4 border-t border-gray-200">
            <h3 className="font-bold mb-4">Contato de Emergência</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold ml-1">Nome do Contato</label>
                <Input 
                  required 
                  className="h-14 rounded-2xl bg-white border-none shadow-sm"
                  value={formData.emergency_contact_name}
                  onChange={e => setFormData({...formData, emergency_contact_name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold ml-1">Telefone do Contato</label>
                <Input 
                  required 
                  className="h-14 rounded-2xl bg-white border-none shadow-sm"
                  value={formData.emergency_contact_phone}
                  onChange={e => setFormData({...formData, emergency_contact_phone: e.target.value})}
                />
              </div>
            </div>
          </div>

          <Button 
            disabled={loading}
            type="submit" 
            className="w-full h-16 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20"
          >
            {loading ? 'Enviando...' : 'Enviar Inscrição'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default PetwalkerInscricao;