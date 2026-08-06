import React, { useState, useEffect } from 'react';
import { PetwalkerProtectedRoute } from '@/components/PetwalkerProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const PetwalkerPerfil = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    public_bio: '',
    experience_years: 0,
    service_radius_km: 1,
    price_30_minutes: 0,
  });

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from('petwalker_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (data && !error) {
        setFormData({
          public_bio: data.public_bio || '',
          experience_years: data.experience_years || 0,
          service_radius_km: data.service_radius_km || 1,
          price_30_minutes: Number(data.price_30_minutes) || 0,
        });
      }
    };
    loadProfile();
  }, [user]);

  const handleUpdate = async (e: React.FormEvent) => {
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
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao atualizar perfil');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PetwalkerProtectedRoute>
      <div className="min-h-screen bg-[#F7F5EF] pb-24">
        <Header />
        <div className="p-6 max-w-lg mx-auto">
          <h1 className="text-2xl font-bold mb-6">Configurações do Perfil</h1>
          
          <form onSubmit={handleUpdate} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Bio Pública</label>
              <Textarea 
                value={formData.public_bio}
                onChange={e => setFormData(prev => ({ ...prev, public_bio: e.target.value }))}
                placeholder="Conte sobre sua experiência com pets..."
                className="h-32"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Anos de Experiência</label>
                <Input 
                  type="number"
                  value={formData.experience_years}
                  onChange={e => setFormData(prev => ({ ...prev, experience_years: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Raio (km)</label>
                <Input 
                  type="number"
                  value={formData.service_radius_km}
                  onChange={e => setFormData(prev => ({ ...prev, service_radius_km: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Preço (30 min)</label>
              <Input 
                type="number"
                step="0.01"
                value={formData.price_30_minutes}
                onChange={e => setFormData(prev => ({ ...prev, price_30_minutes: parseFloat(e.target.value) || 0 }))}
              />
            </div>

            <Button type="submit" className="w-full h-12" disabled={loading}>
              {loading ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </form>
        </div>
        <BottomNavigation />
      </div>
    </PetwalkerProtectedRoute>
  );
};

export default PetwalkerPerfil;