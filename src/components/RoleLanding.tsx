import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { SplashScreen } from '@/components/SplashScreen';

const RoleLanding = () => {
  const { 
    authStatus, 
    profileStatus, 
    profile, 
    rolesStatus, 
    hasRole 
  } = useAuth();

  const isLoading = authStatus === 'initializing' || 
                   (authStatus === 'authenticated' && (profileStatus === 'loading' || profileStatus === 'idle' || rolesStatus === 'loading' || rolesStatus === 'idle'));
  
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
    // If error, Index.tsx will handle the retry UI, but we need to land somewhere.
    // Landing on /inicio is safe because it has its own error state handling.
    return <Navigate to="/inicio" replace />;
  }

  if (authStatus === 'authenticated' && profileStatus === 'ready' && rolesStatus === 'ready') {
    // Priority: PetWalker -> PetShop -> Normal User
    
    // 1. PetWalker Logic
    if (hasRole('petwalker')) {
      // Assuming petwalker_profiles checks later, for now just to dashboard
      // The requirement says: PetWalker aprovado -> /petwalker, incomplet -> /petwalker/onboarding
      // Since we don't have the status here yet, we'll go to /petwalker and let it redirect if needed.
      return <Navigate to="/petwalker" replace />;
    }

    // 2. PetShop Logic
    if (profile?.role === 'petshop') {
      return <Navigate to="/petshop-dashboard" replace />;
    }

    // 3. Normal User / Onboarding
    if (profile?.onboarding_completed === false) {
      return <Navigate to="/onboarding" replace />;
    }

    return <Navigate to="/inicio" replace />;
  }

  return null;
};

export default RoleLanding;