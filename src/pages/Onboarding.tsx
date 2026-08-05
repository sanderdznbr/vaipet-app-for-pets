import React, { useState, useEffect } from 'react';
import { SplashScreen } from '@/components/SplashScreen';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { UserInfoStep } from '@/components/onboarding/UserInfoStep';
import { PermissionsStep } from '@/components/onboarding/PermissionsStep';
import { PetRegistrationStep } from '@/components/onboarding/PetRegistrationStep';
import { SuccessStep } from '@/components/onboarding/SuccessStep';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';

const Onboarding = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const handleBackStep = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };
  const [petData, setPetData] = useState<{name: string, photo?: string} | null>(null);
  const { user, loading, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
      return;
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    // Only redirect away from onboarding if profile is explicitly marked as completed
    // and we are NOT on the success step (Step 4), to allow the user to see the success screen.
    if (!loading && profile?.onboarding_completed === true && currentStep !== 4) {
      console.log('[Onboarding] Profile already completed, redirecting to home');
      navigate('/inicio', { replace: true });
    }
  }, [profile?.onboarding_completed, loading, navigate, currentStep]);

  if (loading) {
    return <SplashScreen />;
  }

  if (!user) {
    return null;
  }

  const handleNextStep = (data?: {name: string, photo?: string}) => {
    if (data) {
      setPetData(data);
    }
    
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    try {
      if (user) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id);
      }
      window.location.replace('/inicio');
    } catch (error) {
      console.error('Error completing onboarding:', error);
      window.location.replace('/inicio');
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <UserInfoStep onNext={() => handleNextStep()} onBack={undefined} />;
      case 2:
        return <PermissionsStep onNext={() => handleNextStep()} onBack={() => setCurrentStep(1)} />;
      case 3:
        return <PetRegistrationStep onNext={handleNextStep} onBack={() => setCurrentStep(2)} />;
      case 4:
        return <SuccessStep onNext={handleNextStep} petName={petData?.name} petPhoto={petData?.photo} />;
      default:
        return <UserInfoStep onNext={() => handleNextStep()} />;
    }
  };

  const stepProgress = (currentStep / 4) * 100;

  return (
    <div className="min-h-screen bg-[#F7F5EF] relative overflow-hidden flex flex-col items-center">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-[#0B1410]/5 z-[60]">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${stepProgress}%` }}
          className="h-full bg-[#31D880]"
        />
      </div>

      <div className="w-full max-w-md relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Onboarding;
