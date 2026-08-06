import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { SplashScreen } from '@/components/SplashScreen';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const PetwalkerDashboard = () => {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [app, setApp] = useState<Tables<'petwalker_applications'> | null>(null);
  const [walkerProfile, setWalkerProfile] = useState<Tables<'petwalker_profiles'> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadWalkerData = async () => {
      if (!user) return;
      try {
        const [appRes, profileRes] = await Promise.all([
          supabase.from('petwalker_applications').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('petwalker_profiles').select('*').eq('user_id', user.id).maybeSingle()
        ]);

        if (appRes.data) setApp(appRes.data);
        if (profileRes.data) setWalkerProfile(profileRes.data);
      } catch (err) {
        console.error('Error loading petwalker data:', err);
        toast.error('Erro ao carregar dados do passeador');
      } finally {
        setLoading(false);
      }
    };

    loadWalkerData();
  }, [user]);

  if (!hasRole('petwalker')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F7F5EF] text-center">
        <h1 className="text-xl font-bold mb-4">Acesso exclusivo para PetWalkers</h1>
        <p className="text-gray-600 mb-6">Você ainda não possui permissão de passeador aprovada.</p>
        <button 
          onClick={() => navigate('/inicio')}
          className="px-6 py-3 bg-primary text-white rounded-xl font-bold"
        >
          Voltar para Home
        </button>
      </div>
    );
  }

  if (loading) return <SplashScreen />;

  // Redirect to onboarding if profile not completed
  if (walkerProfile && !walkerProfile.profile_completed) {
    return <Navigate to="/petwalker/onboarding" replace />;
  }

  return (
    <div className="min-h-screen bg-[#F7F5EF] pb-24">
      <div className="p-6">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Olá, {user?.user_metadata?.full_name?.split(' ')[0] || 'Passeador'}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-[#31D880]/10 text-[#31D880] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                PetWalker
              </span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-full bg-gray-200 overflow-hidden">
            {user?.user_metadata?.avatar_url && (
              <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            )}
          </div>
        </header>

        {/* Status Card */}
        <div className="bg-white rounded-3xl p-6 shadow-sm mb-6 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-500">Status atual</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${walkerProfile?.availability_status === 'available' ? 'bg-[#31D880]' : 'bg-gray-400'}`} />
              <span className="text-sm font-bold uppercase tracking-tight">
                {walkerProfile?.availability_status === 'available' ? 'Disponível' : 'Offline'}
              </span>
            </div>
          </div>
          <button className="w-full py-4 bg-primary text-white rounded-2xl font-bold shadow-lg shadow-primary/20 active:scale-95 transition-transform">
            {walkerProfile?.availability_status === 'available' ? 'Ficar Offline' : 'Ficar Disponível'}
          </button>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest block mb-1">Ganhos Hoje</span>
            <span className="text-xl font-bold">R$ 0,00</span>
          </div>
          <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest block mb-1">Passeios</span>
            <span className="text-xl font-bold">{walkerProfile?.completed_walks || 0}</span>
          </div>
        </div>

        {/* Active Walk / Requests Empty State */}
        <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm text-center mb-6">
          <div className="w-16 h-16 bg-[#F7F5EF] rounded-2xl flex items-center justify-center mx-auto mb-4">
             <span className="text-2xl">🐕</span>
          </div>
          <h3 className="font-bold mb-1">Nenhum passeio ativo</h3>
          <p className="text-sm text-gray-500">Fique disponível para começar a receber solicitações de passeio.</p>
        </div>
      </div>
    </div>
  );
};

export default PetwalkerDashboard;