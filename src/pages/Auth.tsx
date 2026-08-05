import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useHomeTheme } from '@/hooks/useHomeTheme';
import { ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import logoAsset from "@/assets/vaipet-logo-new.png.asset.json";
import splashAsset from "@/assets/animations/splash.gif.asset.json";
import authBgAsset from "@/assets/auth/vipetauth_photo.png.asset.json";
import { motion, AnimatePresence } from 'framer-motion';

const BRAND = '#31D880';
const LIME = '#E4FF7A';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [animPhase, setAnimPhase] = useState<AnimationPhase>('idle');
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { theme, palette } = useHomeTheme();
  const PAPER = palette.paper;
  const INK = palette.ink;

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      console.log('[Auth] Initial check:', !!session, 'Error:', error);
      if (session) {
        console.log('[Auth] Found existing session, triggering transition');
        triggerTransition();
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] State change:', event, session?.user?.id);
      if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION')) {
        setTimeout(() => triggerTransition(), 800);
      }
    });
    return () => { subscription.unsubscribe(); };
  }, [navigate]);

  const triggerTransition = useCallback(() => {
    console.log('[Auth] Triggering transition, isMobile:', isMobile);
    if (isMobile) {
      setAnimPhase('playing-anim2');
      sessionStorage.setItem('vaipet_index_splash_seen', 'true');
      setTimeout(() => {
        console.log('[Auth] Animation finished, navigating to /');
        navigate('/', { replace: true });
      }, 3500);
      return;
    }
    navigate('/', { replace: true });
  }, [navigate, isMobile]);

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setOauthLoading(provider);
    try {
      console.log('[Auth] Starting OAuth:', provider);
      const { error } = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (error) {
        console.error('[Auth] OAuth error:', error);
        toast.error(`Erro ao entrar com ${provider === 'google' ? 'Google' : 'Apple'}`);
      }
    } catch (e) {
      console.error('[Auth] OAuth catch:', e);
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
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              phone: phone,
            }
          }
        });
        if (error) throw error;
        toast.success('Cadastro realizado! Verifique seu e-mail ou faça login.');
        setIsRegistering(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success('Bem-vindo de volta!');
      }
    } catch (error: any) {
      console.error('[Auth] Email auth error:', error);
      toast.error(error.message || 'Erro na autenticação');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] w-full flex items-center justify-center overflow-hidden relative"
      style={{ 
        backgroundColor: PAPER, 
        color: INK, 
        fontFamily: "'DM Sans', system-ui, sans-serif" 
      }}
    >
      <main className="w-full flex items-center justify-center px-6 py-10 relative z-10 overflow-y-auto max-h-[100dvh]">
        <div className="w-full max-w-md flex flex-col gap-8 items-center">
          <img src="/vaipet-logo.svg" alt="VaiPet" className="w-24 h-auto" />
          
          <div className="w-full flex flex-col gap-6">
          <div className="w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={isRegistering ? 'register' : 'login'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="w-full flex flex-col gap-6"
              >
                <h2 className="text-2xl font-bold text-center" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {isRegistering ? 'Criar Conta' : 'Entrar no VaiPet'}
                </h2>

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

                <button
                  onClick={() => setIsRegistering(!isRegistering)}
                  className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity"
                >
                  {isRegistering ? 'Já tem conta? Entre aqui' : 'Não tem conta? Crie uma'}
                </button>

                {!isRegistering && (
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
              </motion.div>
            </AnimatePresence>
          </div>
          </div>

          <p className="text-[11px] font-medium leading-relaxed text-center mt-4" style={{ color: INK, opacity: 0.6 }}>
            Ao continuar, você aceita os{' '}
            <Link to="/termos-de-uso" className="underline" style={{ color: INK }}>Termos</Link>
            {' '}e{' '}
            <Link to="/politica-de-privacidade" className="underline" style={{ color: INK }}>Privacidade</Link>.
          </p>
        </div>

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
      </main>
    </div>
  );
};

export default Auth;
