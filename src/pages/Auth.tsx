import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { ArrowUpRight, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import splashAsset from "@/assets/animations/splash.gif.asset.json";

const BRAND = '#31D880';

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const AppleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
  </svg>
);

type AnimationPhase = 'idle' | 'playing-anim2';

const Auth = () => {
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [signupIntent, setSignupIntent] = useState<'pet_owner' | 'petwalker' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [animPhase, setAnimPhase] = useState<AnimationPhase>('idle');


  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  const triggerTransition = useCallback(() => {
    console.log('[Auth] Triggering transition, isMobile:', isMobile);
    const searchParams = new URLSearchParams(window.location.search);
    const redirectPath = searchParams.get('redirect');
    
    const safeRedirect = redirectPath && redirectPath.startsWith('/') && !redirectPath.startsWith('//') 
      ? redirectPath 
      : '/';

    if (isMobile) {
      setAnimPhase('playing-anim2');
      sessionStorage.setItem('vaipet_index_splash_seen', 'true');
      setTimeout(() => {
        console.log('[Auth] Animation finished, navigating to:', safeRedirect);
        navigate(safeRedirect, { replace: true });
      }, 3500);
      return;
    }
    navigate(safeRedirect, { replace: true });
  }, [navigate, isMobile]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('type') === 'recovery') {
      setIsRecoveryMode(true);
    }

    const checkUser = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session && !isRecoveryMode) {
        triggerTransition();
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      }
      if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION')) {
        if (!isRecoveryMode) {
          triggerTransition();
        }
      }
    });
    return () => { subscription.unsubscribe(); };
  }, [triggerTransition, isRecoveryMode]);


  const handleOAuth = async (provider: 'google' | 'apple') => {
    // Proteção: não iniciar OAuth se estiver registrando mas sem intenção selecionada
    if (isRegistering && !signupIntent) {
      toast.error('Selecione como deseja usar o VaiPet antes de continuar');
      return;
    }

    setOauthLoading(provider);
    try {
      if (isRegistering && signupIntent) {
        localStorage.setItem('vaipet_pending_signup_intent', JSON.stringify({
          intent: signupIntent,
          timestamp: Date.now()
        }));
      } else if (!isRegistering) {
        // Modo login: remover qualquer intenção pendente antiga
        localStorage.removeItem('vaipet_pending_signup_intent');
      }

      const { error } = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin
      });
      if (error) {
        toast.error(`Erro ao entrar com ${provider === 'google' ? 'Google' : 'Apple'}`);
      }
    } catch (e) {
      toast.error('Erro ao fazer login');
    } finally {
      setOauthLoading(null);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (isRegistering) {
        if (password !== confirmPassword) {
          throw new Error('As senhas não coincidem');
        }
        
        const finalIntent = signupIntent || 'pet_owner';
        
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              phone: phone,
              signup_intent: finalIntent
            }
          }
        });
        if (error) {
          if (error.message.includes('User already registered')) {
            throw new Error('Este e-mail já está cadastrado. Tente fazer login.');
          }
          if (error.message.includes('Password is known to be weak')) {
            throw new Error('Esta senha é muito fraca e fácil de adivinhar. Por favor, escolha outra mais forte.');
          }
          throw error;
        }
        toast.success('Cadastro realizado! Verifique seu e-mail ou faça login.');
        setIsRegistering(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            throw new Error('E-mail ou senha incorretos.');
          }
          throw error;
        }
        toast.success('Bem-vindo de volta!');
      }
    } catch (err) {
      const error = err as Error;
      toast.error(error.message || 'Ocorreu um erro.');
    } finally {
      setIsLoading(false);
    }
  };


  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error('Informe seu e-mail para recuperar a senha');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });
      if (error) throw error;
      toast.success('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
      setIsForgotPassword(false);
    } catch (err) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao enviar e-mail de recuperação.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Senha atualizada com sucesso!');
      setIsRecoveryMode(false);
      triggerTransition();
    } catch (err) {
      const error = err as Error;
      toast.error(error.message || 'Erro ao atualizar senha.');
    } finally {
      setIsLoading(false);
    }
  };

  return (


    <div
      className="min-h-[100dvh] w-full flex items-center justify-center overflow-hidden relative"
      style={{ backgroundColor: PAPER, color: INK, fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <header className="fixed top-0 left-0 right-0 z-20 flex flex-col items-center gap-6 py-10 pointer-events-none">
        <div className="w-full max-w-md px-6 flex flex-col items-center gap-6 pointer-events-auto">
          <img src="/vaipet-logo.svg" alt="VaiPet" className="w-24 h-auto" />
          
          <div className="w-full h-10 flex items-center">
            <AnimatePresence>
              {(isForgotPassword || (isRegistering && signupIntent)) && (
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  onClick={() => {
                    if (isForgotPassword) setIsForgotPassword(false);
                    else setSignupIntent(null);
                  }}
                  className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors flex items-center gap-2 text-xs font-medium opacity-60"
                >
                  <ArrowLeft size={16} />
                  <span>Voltar</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <main className="w-full flex flex-col items-center px-6 pt-52 pb-10 relative z-10 overflow-y-auto max-h-[100dvh]">
        <div className="w-full max-w-md flex flex-col gap-6">

            <AnimatePresence mode="wait">
              {isRecoveryMode ? (
                <motion.div
                  key="recovery-mode"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="w-full flex flex-col gap-6"
                >
                  <div className="flex flex-col items-center gap-2">
                    <h2 className="text-2xl font-bold text-center" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      Nova Senha
                    </h2>
                    <p className="text-sm text-center text-black/60">
                      Crie uma nova senha para sua conta.
                    </p>
                  </div>

                  <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Nova Senha"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg pr-14"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-5 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/60 transition-colors"
                      >
                        {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                      </button>
                    </div>

                    <div className="relative">
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Confirmar Nova Senha"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg pr-14"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-5 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/60 transition-colors"
                      >
                        {showConfirmPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-16 rounded-2xl font-bold text-white transition-all active:scale-[0.98] disabled:opacity-70 shadow-lg shadow-[#31D880]/20 text-lg mt-2"
                      style={{ backgroundColor: '#31D880' }}
                    >
                      {isLoading ? 'Atualizando...' : 'Atualizar Senha'}
                    </button>
                  </form>
                </motion.div>
              ) : isForgotPassword ? (

                <motion.div
                  key="forgot-password"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="w-full flex flex-col gap-6"
                >
                  <div className="flex flex-col items-center gap-2">

                    <h2 className="text-2xl font-bold text-center" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      Recuperar Senha
                    </h2>
                    <p className="text-sm text-center text-black/60">
                      Informe seu e-mail e enviaremos um link para você criar uma nova senha.
                    </p>
                  </div>

                  <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
                    <input
                      type="email"
                      placeholder="E-mail"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg"
                    />
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-16 rounded-2xl font-bold text-white transition-all active:scale-[0.98] disabled:opacity-70 shadow-lg shadow-[#31D880]/20 text-lg mt-2"
                      style={{ backgroundColor: '#31D880' }}
                    >
                      {isLoading ? 'Enviando...' : 'Enviar link de recuperação'}
                    </button>
                  </form>
                </motion.div>
              ) : isRegistering && !signupIntent ? (

                <motion.div
                  key="intent-selection"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="w-full flex flex-col gap-6"
                >
                  <h2 className="text-2xl font-bold text-center" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    Como você quer usar o VaiPet?
                  </h2>
                  
                  <div className="flex flex-col gap-4">
                    <button
                      onClick={() => setSignupIntent('pet_owner')}
                      className="p-6 rounded-2xl border-2 border-black/5 hover:border-[#31D880] text-left transition-all bg-white group"
                    >
                      <h3 className="text-lg font-bold mb-1">Dono(a) de Pet</h3>
                      <p className="text-sm text-black/60">Quero cuidar dos meus pets, encontrar serviços e solicitar passeios.</p>
                    </button>

                    <button
                      onClick={() => setSignupIntent('petwalker')}
                      className="p-6 rounded-2xl border-2 border-black/5 hover:border-[#31D880] text-left transition-all bg-white group"
                    >
                      <h3 className="text-lg font-bold mb-1">Quero ser PetWalker</h3>
                      <p className="text-sm text-black/60">Crie sua conta e depois envie sua candidatura. Sujeito à análise. É necessário ter 18 anos ou mais.</p>
                      <p className="text-[10px] mt-2 text-black/40 font-medium uppercase tracking-wider">Cadastro sujeito à análise • 18+ anos</p>
                    </button>
                  </div>

                  <button
                    onClick={() => setIsRegistering(false)}
                    className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity"
                  >
                    Já tem conta? Entre aqui
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key={isRegistering ? 'register' : 'login'}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="w-full flex flex-col gap-6"
                >
                  <div className="flex flex-col items-center gap-2">
                    {isRegistering && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 bg-black/5 rounded-full opacity-60 mb-2">
                        {signupIntent === 'pet_owner' ? 'Dono(a) de Pet' : 'Candidato PetWalker'}
                      </span>
                    )}
                    <h2 className="text-2xl font-bold text-center" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {isRegistering ? 'Criar Conta' : 'Entrar no VaiPet'}
                    </h2>
                  </div>


                  <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
                    {isRegistering && (
                      <>
                        <input
                          type="text"
                          placeholder="Nome Completo"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          required
                          className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg"
                        />
                        <input
                          type="tel"
                          placeholder="Telefone"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required
                          className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg"
                        />
                      </>
                    )}
                    <input
                      type="email"
                      placeholder="E-mail"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg"
                    />
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="Senha"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg pr-14"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-5 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/60 transition-colors"
                      >
                        {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                      </button>
                    </div>

                    {isRegistering && (
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirmar Senha"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg pr-14"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-5 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/60 transition-colors"
                        >
                          {showConfirmPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                        </button>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-16 rounded-2xl font-bold text-white transition-all active:scale-[0.98] disabled:opacity-70 shadow-lg shadow-[#31D880]/20 text-lg mt-2"
                      style={{ backgroundColor: '#31D880' }}
                    >
                      {isLoading ? 'Aguarde...' : (isRegistering ? 'Cadastrar' : 'Entrar')}
                    </button>
                  </form>

                  {!isRegistering && (
                    <button
                      onClick={() => setIsForgotPassword(true)}
                      className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity -mt-2"
                    >
                      Esqueci minha senha
                    </button>
                  )}


                  <button
                    onClick={() => {
                      setIsRegistering(!isRegistering);
                      setSignupIntent(null);
                    }}
                    className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity"
                  >
                    {isRegistering ? 'Já tem conta? Entre aqui' : 'Não tem conta? Crie uma'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {!isRegistering && !isForgotPassword && (
              <>
                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-black/10"></span>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="px-2 text-black/40" style={{ backgroundColor: PAPER }}>Ou continue com</span>
                  </div>
                </div>

                <div className="w-full flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => handleOAuth('google')}
                    disabled={oauthLoading !== null}
                    className="group w-full flex items-center justify-between px-6 transition-all active:scale-[0.98] disabled:opacity-60 border border-black/5 shadow-sm bg-white"
                    style={{ height: 64, borderRadius: 20, color: INK, fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    <span className="flex items-center gap-4">
                      <span className="flex items-center justify-center bg-[#F8F9FA] border border-black/5" style={{ width: 36, height: 36, borderRadius: 10 }}>
                        <GoogleIcon />
                      </span>
                      <span className="text-[15px] font-bold">Google</span>
                    </span>
                    <ArrowUpRight size={18} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOAuth('apple')}
                    disabled={oauthLoading !== null}
                    className="group w-full flex items-center justify-between px-6 transition-all active:scale-[0.98] disabled:opacity-60 border border-black/5 shadow-sm bg-white"
                    style={{ height: 64, borderRadius: 20, color: INK, fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    <span className="flex items-center gap-4">
                      <span className="flex items-center justify-center bg-white border border-black/5 shadow-sm" style={{ width: 36, height: 36, borderRadius: 10 }}>
                        <AppleIcon />
                      </span>
                      <span className="text-[15px] font-bold">Apple</span>
                    </span>
                    <ArrowUpRight size={18} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                  </button>
                </div>
              </>
            )}

            <p className="text-[11px] font-medium leading-relaxed text-center mt-6 w-full" style={{ color: INK, opacity: 0.6 }}>
              Ao continuar, você aceita os{' '}
              <Link to="/termos-de-uso" className="underline" style={{ color: INK }}>Termos</Link>
              {' '}e{' '}
              <Link to="/politica-de-privacidade" className="underline" style={{ color: INK }}>Privacidade</Link>.
            </p>
          </div>
        </div>
      </main>






      {animPhase === 'playing-anim2' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none bg-[#F7F5EF]">
          <div className="w-full h-full flex items-center justify-center overflow-hidden">
            <img
              src={splashAsset.url + "?t=" + Date.now()}
              alt="VaiPet Loading"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Auth;




