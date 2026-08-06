import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ChevronLeft } from 'lucide-react';

const PetwalkerOnboarding = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [formData, setFormData] = useState({
    public_bio: '',
    experience_years: 0,
    service_radius_km: 5,
    price_30_minutes: 30,
  });

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('petwalker_profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (data) {
          setFormData({
            public_bio: data.public_bio || '',
            experience_years: data.experience_years || 0,
            service_radius_km: data.service_radius_km || 5,
            price_30_minutes: Number(data.price_30_minutes) || 30,
          });
        }
      } catch (err) {
        console.error('Error loading profile:', err);
      } finally {
        setInitialLoading(false);
      }
    };
    loadProfile();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.rpc('update_petwalker_operational_profile', {
        _public_bio: formData.public_bio,
        _experience_years: formData.experience_years,
        _service_radius_km: formData.service_radius_km,
        _price_30_minutes: formData.price_30_minutes
      });

      if (error) throw error;

      toast.success('Perfil atualizado com sucesso!');
      navigate('/petwalker');
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao atualizar perfil');
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) return null;

  return (
    <div className="min-h-screen bg-[#F7F5EF] pb-10">
      <div className="max-w-md mx-auto p-6">
        <button onClick={() => navigate('/petwalker')} className="mb-6 flex items-center gap-2 text-gray-500 font-medium">
          <ChevronLeft size={20} />
          Voltar
        </button>

        <h1 className="text-2xl font-bold mb-2">Completar Perfil</h1>
        <p className="text-gray-500 mb-8">Dados necessários para começar a receber passeios.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Bio Pública</label>
            <Textarea 
              required 
              placeholder="Descreva seu trabalho..."
              className="min-h-[120px] rounded-2xl bg-white border-none shadow-sm p-4"
              value={formData.public_bio}
              onChange={e => setFormData({...formData, public_bio: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Anos de Experiência</label>
            <Input 
              required 
              type="number"
              min="0"
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.experience_years}
              onChange={e => setFormData({...formData, experience_years: parseInt(e.target.value) || 0})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Raio de Atendimento (km)</label>
            <Input 
              required 
              type="number"
              min="1"
              max="50"
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.service_radius_km}
              onChange={e => setFormData({...formData, service_radius_km: parseInt(e.target.value) || 5})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold ml-1">Valor por 30 min (R$)</label>
            <Input 
              required 
              type="number"
              min="10"
              step="0.01"
              className="h-14 rounded-2xl bg-white border-none shadow-sm"
              value={formData.price_30_minutes}
              onChange={e => setFormData({...formData, price_30_minutes: parseFloat(e.target.value) || 30})}
            />
          </div>

          <Button 
            disabled={loading}
            type="submit" 
            className="w-full h-16 rounded-2xl text-lg font-bold shadow-xl shadow-primary/20"
          >
            {loading ? 'Salvando...' : 'Salvar Perfil'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default PetwalkerOnboarding;
