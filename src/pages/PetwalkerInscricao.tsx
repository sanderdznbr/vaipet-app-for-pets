import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';

const PetwalkerInscricao = () => {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existingApp, setExistingApp] = useState<Tables<'petwalker_applications'> | null>(null);
  
  const [formData, setFormData] = useState({
    legal_name: '',
    birth_date: '',
    phone: '',
    city: '',
    experience_description: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });

  useEffect(() => {
    if (hasRole('petwalker')) {
      navigate('/petwalker', { replace: true });
      return;
    }

    const checkExisting = async () => {
      if (!user) {
        setChecking(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('petwalker_applications')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (data) setExistingApp(data);
      } catch (err) {
        console.error('Error checking application:', err);
      } finally {
        setChecking(false);
      }
    };
    checkExisting();
  }, [user, hasRole, navigate]);

  const validateAge = (dateString: string) => {
    const today = new Date();
    const birthDate = new Date(dateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 18;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('Você precisa estar logado para se inscrever.');
      navigate('/auth?redirect=/petwalker/inscricao');
      return;
    }

    if (!validateAge(formData.birth_date)) {
      toast.error('Você deve ter pelo menos 18 anos para se inscrever.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('petwalker_applications').insert([
        {
          user_id: user.id,
          legal_name: formData.legal_name,
          birth_date: formData.birth_date,
          phone: formData.phone,
          city: formData.city,
          experience_description: formData.experience_description,
          emergency_contact_name: formData.emergency_contact_name,
          emergency_contact_phone: formData.emergency_contact_phone,
          status: 'pending'
        },
      ]);

      if (error) throw error;

      toast.success('Inscrição enviada com sucesso!');
      navigate('/inicio');
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao processar inscrição');
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;

  if (existingApp) {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-sm">
          <div className="w-20 h-20 bg-[#F7F5EF] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">📄</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Inscrição Enviada</h1>
          <p className="text-gray-500 mb-8">
            Sua inscrição de status <strong>{existingApp.status}</strong> já está conosco. 
            Aguarde nossa análise.
          </p>
          <Button onClick={() => navigate('/inicio')} className="w-full h-14 rounded-2xl font-bold">
            Voltar para Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F5EF] pb-10">
      <div className="max-w-md mx-auto p-6">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-gray-500 font-medium">
          <ChevronLeft size={20} />
          Voltar
        </button>

        <h1 className="text-2xl font-bold mb-2">Seja um PetWalker</h1>
        <p className="text-gray-500 mb-8">Ganhe dinheiro passeando com pets na sua região.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Nome Completo (Conforme documento)</label>
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
            <label className="text-sm font-bold ml-1">Cidade</label>
            <Input 
              required 
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.city}
              onChange={e => setFormData({...formData, city: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Sua Experiência</label>
            <Textarea 
              required 
              placeholder="Descreva brevemente seu contato anterior com animais..."
              className="min-h-[120px] rounded-2xl bg-white border-none shadow-sm p-4"
              value={formData.experience_description}
              onChange={e => setFormData({...formData, experience_description: e.target.value})}
            />
          </div>

          <div className="pt-4 border-t border-gray-200">
            <h3 className="font-bold mb-4">Contato de Emergência</h3>
            <div className="space-y-4">
              <Input 
                required 
                placeholder="Nome do contato"
                className="h-14 rounded-2xl bg-white border-none shadow-sm"
                value={formData.emergency_contact_name}
                onChange={e => setFormData({...formData, emergency_contact_name: e.target.value})}
              />
              <Input 
                required 
                placeholder="Telefone do contato"
                className="h-14 rounded-2xl bg-white border-none shadow-sm"
                value={formData.emergency_contact_phone}
                onChange={e => setFormData({...formData, emergency_contact_phone: e.target.value})}
              />
            </div>
          </div>

          <Button 
            disabled={loading}
            type="submit" 
            className="w-full h-16 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20"
          >
            {loading ? 'Processando...' : 'Enviar Candidatura'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default PetwalkerInscricao;
