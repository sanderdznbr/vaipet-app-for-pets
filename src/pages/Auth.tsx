import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Eye, EyeOff, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';

const PAPER = "#F7F5EF";
const INK = "#1A1A1A";

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const AppleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.05 20.28c-.96.95-2.12 2.37-3.83 2.37-1.63 0-2.16-1.01-3.95-1.01-1.83 0-2.42 1.01-3.93 1.01-1.63 0-3-.1.49-4.14-.95-2.58-1.34-6.43 1.15-8.77.7-.65 1.76-1.05 2.88-1.05 1.44 0 2.45.8 3.35.8.85 0 2.16-.95 3.86-.95 1.34 0 2.58.5 3.4 1.48-3.08 1.6-2.58 5.6.5 7.02-.6 1.43-1.4 2.86-2.45 3.16zM12.03 5.48c-.06-1.94 1.58-3.66 3.48-3.8 0.1-.01.2-.01.3-.01.12 2.13-1.78 4.07-3.78 3.81z"/>
  </svg>
);

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupIntent, setSignupIntent] = useState<'pet_owner' | 'petwalker' | null>(null);

  const [animPhase, setAnimPhase] = useState<'idle' | 'playing-anim1' | 'playing-anim2'>('idle');
  const [splashAsset] = useState({ url: 'https://images.unsplash.com/photo-1517849845537-4d257902454a' });

  useEffect(() => {
    const type = searchParams.get('type');
    if (type === 'recovery') {
      setIsRecoveryMode(true);
    }
  }, [searchParams]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (isRegistering) {
        if (password !== confirmPassword) {
          toast.error('As senhas não coincidem');
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              phone: phone,
              signup_intent: signupIntent
            }
          }
        });
        if (error) throw error;
        toast.success('Cadastro realizado! Verifique seu e-mail.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate('/inicio');
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });
      if (error) throw error;
      toast.success('Link de recuperação enviado para seu e-mail!');
    } catch (error: any) {
      toast.error(error.message);
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
      navigate('/auth');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setOauthLoading(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        }
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message);
      setOauthLoading(null);
    }
  };

  return (
    <div
      className="min-h-[100dvh] w-full flex items-center justify-center overflow-hidden relative"
      style={{ backgroundColor: PAPER, color: INK, fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <header className="fixed top-0 left-0 right-0 z-20 flex flex-col items-center py-6 sm:py-8 pointer-events-none bg-inherit">
        <div className="w-full max-w-md px-6 flex flex-col items-center gap-4 sm:gap-6 pointer-events-auto">
          <img src="/vaipet-logo.svg" alt="VaiPet" className="w-20 sm:w-24 h-auto" />
          
          <div className="w-full h-8 sm:h-10 flex items-center">
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

      <main className="w-full flex flex-col items-center px-6 pt-40 sm:pt-48 pb-10 relative z-10 overflow-y-auto max-h-[100dvh]">
        <div className="w-full max-w-md flex flex-col gap-4 sm:gap-6">
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
                  <h2 className="text-2xl font-bold text-center">Nova Senha</h2>
                  <p className="text-sm text-center text-black/60">Crie uma nova senha para sua conta.</p>
                </div>
                <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Nova Senha"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className="w-full h-14 sm:h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-base sm:text-lg pr-14"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60 transition-opacity">
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
                      className="w-full h-14 sm:h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-base sm:text-lg pr-14"
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60 transition-opacity">
                      {showConfirmPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                    </button>
                  </div>
                  <button type="submit" disabled={isLoading} className="w-full h-16 rounded-2xl font-bold text-white shadow-lg bg-[#31D880] disabled:opacity-70 mt-2">
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
                  <h2 className="text-2xl font-bold text-center">Recuperar Senha</h2>
                  <p className="text-sm text-center text-black/60">Informe seu e-mail e enviaremos um link de recuperação.</p>
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
                  <button type="submit" disabled={isLoading} className="w-full h-16 rounded-2xl font-bold text-white shadow-lg bg-[#31D880] disabled:opacity-70 mt-2">
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
                <h2 className="text-2xl font-bold text-center">Como você quer usar o VaiPet?</h2>
                <div className="flex flex-col gap-4">
                  <button onClick={() => setSignupIntent('pet_owner')} className="p-6 rounded-2xl border-2 border-black/5 hover:border-[#31D880] text-left transition-all bg-white group">
                    <h3 className="text-lg font-bold mb-1">Dono(a) de Pet</h3>
                    <p className="text-sm text-black/60">Quero cuidar dos meus pets e solicitar passeios.</p>
                  </button>
                  <button onClick={() => setSignupIntent('petwalker')} className="p-6 rounded-2xl border-2 border-black/5 hover:border-[#31D880] text-left transition-all bg-white group">
                    <h3 className="text-lg font-bold mb-1">Quero ser PetWalker</h3>
                    <p className="text-sm text-black/60">Crie sua conta e depois envie sua candidatura.</p>
                  </button>
                </div>
                <button onClick={() => setIsRegistering(false)} className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity">
                  Já tem conta? Entre aqui
                </button>
              </motion.div>
            ) : (
              <motion.div
                key={isRegistering ? 'register' : 'login'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="w-full flex flex-col gap-6"
              >
                <div className="flex flex-col items-center gap-2">
                  <h2 className="text-2xl font-bold text-center">{isRegistering ? 'Criar Conta' : 'Entrar no VaiPet'}</h2>
                </div>
                <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
                  {isRegistering && (
                    <>
                      <input type="text" placeholder="Nome Completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg" />
                      <input type="tel" placeholder="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg" />
                    </>
                  )}
                  <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg" />
                  <div className="relative">
                    <input type={showPassword ? "text" : "password"} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg pr-14" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60 transition-opacity">
                      {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                    </button>
                  </div>
                  {isRegistering && (
                    <div className="relative">
                      <input type={showConfirmPassword ? "text" : "password"} placeholder="Confirmar Senha" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full h-16 px-6 rounded-2xl border border-black/10 bg-white/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#31D880] transition-all text-lg pr-14" />
                      <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60 transition-opacity">
                        {showConfirmPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                      </button>
                    </div>
                  )}
                  <button type="submit" disabled={isLoading} className="w-full h-16 rounded-2xl font-bold text-white shadow-lg bg-[#31D880] disabled:opacity-70 mt-2">
                    {isLoading ? 'Aguarde...' : (isRegistering ? 'Cadastrar' : 'Entrar')}
                  </button>
                </form>
                {!isRegistering && (
                  <button onClick={() => setIsForgotPassword(true)} className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity -mt-2">
                    Esqueci minha senha
                  </button>
                )}
                <button onClick={() => { setIsRegistering(!isRegistering); setSignupIntent(null); }} className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity">
                  {isRegistering ? 'Já tem conta? Entre aqui' : 'Não tem conta? Crie uma'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {!isRegistering && !isForgotPassword && !isRecoveryMode && (
            <>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-black/10"></span></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="px-2 text-black/40" style={{ backgroundColor: PAPER }}>Ou continue com</span></div>
              </div>
              <div className="w-full flex flex-col gap-3">
                <button onClick={() => handleOAuth('google')} className="group w-full flex items-center justify-between px-6 transition-all active:scale-[0.98] border border-black/5 shadow-sm bg-white h-[64px] rounded-[20px]">
                  <span className="flex items-center gap-4">
                    <GoogleIcon />
                    <span className="text-[15px] font-bold">Google</span>
                  </span>
                  <ArrowUpRight size={18} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                </button>
                <button onClick={() => handleOAuth('apple')} className="group w-full flex items-center justify-between px-6 transition-all active:scale-[0.98] border border-black/5 shadow-sm bg-white h-[64px] rounded-[20px]">
                  <span className="flex items-center gap-4">
                    <AppleIcon />
                    <span className="text-[15px] font-bold">Apple</span>
                  </span>
                  <ArrowUpRight size={18} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>
            </>
          )}

          <p className="text-[11px] font-medium leading-relaxed text-center mt-6 w-full opacity-60">
            Ao continuar, você aceita os{' '}
            <Link to="/termos-de-uso" className="underline">Termos</Link>
            {' '}e{' '}
            <Link to="/politica-de-privacidade" className="underline">Privacidade</Link>.
          </p>
        </div>
      </main>

      {animPhase === 'playing-anim2' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none bg-[#F7F5EF]">
          <div className="w-full h-full flex items-center justify-center overflow-hidden">
            <img src={splashAsset.url + "?t=" + Date.now()} alt="VaiPet Loading" className="w-full h-full object-cover" />
          </div>
        </div>
      )}
    </div>
  );
};

export default Auth;
