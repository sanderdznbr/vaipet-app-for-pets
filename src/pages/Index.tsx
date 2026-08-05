import { useEffect, useState } from 'react';
import { HomePasseio } from '@/components/HomePasseio';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ActiveWalkBanner } from '@/components/ActiveWalkBanner';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { SplashScreen } from '@/components/SplashScreen';
import { GuidedTour } from '@/components/GuidedTour';
import { motion, AnimatePresence } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0,
      delayChildren: 0
    }
  }
};

const itemVariants = {
  hidden: { y: 0, opacity: 1 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0 }
  }
};

const Index = () => {
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();
  const { palette } = useHomeTheme();
  
  const [contentReady, setContentReady] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [authTimeout, setAuthTimeout] = useState(false);
  const [hasCheckedProfile, setHasCheckedProfile] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Safety timeout: if auth is still loading after 8 seconds, flag it
    const timer = setTimeout(() => {
      setAuthTimeout(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    
    // If explicitly not loading and no user, redirect
    if (!loading && !user) {
      console.log('[Index] No user and loading finished, redirecting to /auth');
      navigate('/auth', { replace: true });
      return;
    }

    // If timeout reached and still no user, redirect
    if (authTimeout && !user) {
      console.log('[Index] Auth timeout and no user, redirecting to /auth');
      navigate('/auth', { replace: true });
      return;
    }

    if (user && profile) {
      console.log('[Index] User and profile authenticated:', user.id);
      
      if (profile.onboarding_completed === false) {
        navigate('/onboarding', { replace: true });
        return;
      }
      
      if (profile.role === 'petshop') {
        navigate('/petshop-dashboard', { replace: true });
        return;
      }

      // Always show content immediately, disabling splash
      setShowSplash(false);
      setContentReady(true);
      setHasCheckedProfile(true);
    } else if (user && !profile && !loading) {
      // User exists but profile fetching failed or is empty
      console.log('[Index] User exists but profile missing, waiting or retrying...');
    }
  }, [user, loading, profile, navigate, mounted, authTimeout]);

  const handleSplashComplete = () => {
    sessionStorage.setItem('vaipet_index_splash_seen', 'true');
    setShowSplash(false);
    setContentReady(true);
  };

  return (
    <>
      <GuidedTour />
      <AnimatePresence>
        {showSplash && (
          <SplashScreen 
            key="splash-screen" 
            variant="video" 
            onComplete={handleSplashComplete} 
          />
        )}
      </AnimatePresence>

      <div
        className="min-h-screen"
        style={{ backgroundColor: palette.paper }}
      >
        {contentReady && !showSplash && (
          <motion.div
            key="main-content"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="min-h-screen flex flex-col max-w-md mx-auto relative"
            style={{ background: palette.paper, color: palette.ink }}
          >
            <motion.div variants={itemVariants} className="flex-1 pb-28 pt-10">
              <ActiveWalkBanner />
              <HomePasseio />
            </motion.div>
            <motion.div variants={itemVariants} className="fixed bottom-0 left-0 right-0 z-50">
              <BottomNavigation />
            </motion.div>
          </motion.div>
        )}
        {!contentReady && (
          <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#F7F5EF] z-[100]">
            <SplashScreen variant="logo" />
            <div className="absolute bottom-20 flex flex-col items-center gap-4 px-6 w-full max-w-xs">
              <div className="text-[12px] font-medium opacity-40 text-center">
                {loading ? 'Validando acesso...' : !profile ? 'Carregando perfil...' : 'Preparando sua experiência...'}
              </div>
              
              {(authTimeout || (!loading && !user)) && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full flex flex-col gap-2"
                >
                  <button 
                    onClick={() => navigate('/auth')}
                    className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg active:scale-95 transition-transform"
                  >
                    Entrar novamente
                  </button>
                  <button 
                    onClick={() => window.location.reload()}
                    className="w-full py-2 text-xs opacity-50 underline"
                  >
                    Recarregar página
                  </button>
                </motion.div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Index;