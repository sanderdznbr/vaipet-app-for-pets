import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { SplashScreen } from '@/components/SplashScreen';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

const RoleLanding = () => {
  const { 
    authStatus, 
    profileStatus, 
    profile, 
    rolesStatus, 
    roles,
    hasRole,
    applicationStatus,
    refreshRoles,
    user
  } = useAuth();

  const [waitApproved, setWaitApproved] = useState(0);
  const [petwalkerProfile, setPetwalkerProfile] = useState<any>(null);
  const [pwProfileLoading, setPwProfileLoading] = useState(false);

  // Fetch petwalker profile specifically for profile_completed check
  useEffect(() => {
    if (hasRole('petwalker') && user) {
      setPwProfileLoading(true);
      supabase
        .from('petwalker_profiles')
        .select('profile_completed')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          setPetwalkerProfile(data);
          setPwProfileLoading(false);
        });
    }
  }, [hasRole, user]);

  useEffect(() => {
    if (applicationStatus === 'approved' && !hasRole('petwalker') && waitApproved < 3) {
      const timer = setTimeout(() => {
        refreshRoles();
        setWaitApproved(prev => prev + 1);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [applicationStatus, hasRole, waitApproved, refreshRoles]);

  const isLoading = authStatus === 'initializing' || 
                   (authStatus === 'authenticated' && (
                     profileStatus === 'loading' || 
                     profileStatus === 'idle' || 
                     rolesStatus === 'loading' || 
                     rolesStatus === 'idle' || 
                     applicationStatus === 'loading' || 
                     applicationStatus === 'idle' ||
                     pwProfileLoading
                   ));
  
  const isError = authStatus === 'error' || profileStatus === 'error' || rolesStatus === 'error' || profileStatus === 'missing';

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#F7F5EF] z-[100]">
        <SplashScreen variant="logo" />
        <div className="absolute bottom-20 flex flex-col items-center gap-4 px-6 w-full max-w-xs">
          <div className="text-[12px] font-medium opacity-40 text-center">
            Redirecionando...
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <Navigate to="/auth" replace />;
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#F7F5EF]">
        <h2 className="text-xl font-bold mb-2">Erro ao carregar dados</h2>
        <p className="text-gray-500 mb-6">Não conseguimos identificar seu destino.</p>
        <Button 
          onClick={() => window.location.reload()}
          className="px-6 py-3 font-bold"
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  // 1. PetWalker Logic
  if (hasRole('petwalker')) {
    // Decision based on petwalker_profiles.profile_completed
    if (petwalkerProfile && !petwalkerProfile.profile_completed) {
      return <Navigate to="/petwalker/onboarding" replace />;
    }
    return <Navigate to="/petwalker" replace />;
  }

  // Approved but role not synced yet
  if (applicationStatus === 'approved' && !hasRole('petwalker')) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-[#F7F5EF]">
        <h2 className="text-xl font-bold mb-2">Quase lá!</h2>
        <p className="text-gray-500 mb-6">Sua candidatura foi aprovada. Estamos preparando seu perfil de PetWalker...</p>
        <Button onClick={() => refreshRoles()} className="mt-4">
          Verificar agora
        </Button>
      </div>
    );
  }

  // Pending candidate or rejected candidate -> track in /petwalker/inscricao
  if (applicationStatus === 'pending' || applicationStatus === 'rejected') {
    return <Navigate to="/petwalker/inscricao" replace />;
  }

  // Intent PetWalker without application -> /petwalker/inscricao
  if (profile?.signup_intent === 'petwalker' && applicationStatus === 'none') {
    return <Navigate to="/petwalker/inscricao" replace />;
  }

  // 2. PetShop Logic
  if (profile?.role === 'petshop' || hasRole('petshop')) {
    return <Navigate to="/petshop-dashboard" replace />;
  }

  // 3. Normal User / Onboarding
  if (profile?.onboarding_completed === false) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Navigate to="/inicio" replace />;
};

export default RoleLanding;