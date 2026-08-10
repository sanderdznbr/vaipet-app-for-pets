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
    <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.09997 22C7.78997 22.05 6.79997 20.68 5.95997 19.47C4.24997 17 2.93997 12.45 4.69997 9.39C5.56997 7.87 7.12997 6.91 8.81997 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/>
  </svg>
);

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isOTPMode, setIsOTPMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  
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

  const translateError = (message: string) => {
    if (message.includes('Invalid login credentials')) {
      return 'E-mail ou senha incorretos.';
    }
    if (message.includes('User already registered')) {
      return 'Este e-mail já está cadastrado.';
    }
    if (message.includes('Password is too short')) {
      return 'A senha deve ter pelo menos 6 caracteres.';
    }
    if (message.includes('Email not confirmed')) {
      return 'Por favor, confirme seu e-mail.';
    }
    return message;
  };

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
        setIsOTPMode(true);
        toast.success('Cadastro realizado! Enviamos um código para seu e-mail.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate('/inicio');
      }
    } catch (error: any) {
      toast.error(translateError(error.message));
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
      toast.error(translateError(error.message));
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
      toast.error(translateError(error.message));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: 'signup'
      });
      if (error) throw error;
      toast.success('E-mail verificado com sucesso!');
      navigate('/inicio');
    } catch (error: any) {
      toast.error(translateError(error.message));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (error) throw error;
      toast.success('Novo código enviado!');
    } catch (error: any) {
      toast.error(translateError(error.message));
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
      toast.error(translateError(error.message));
      setOauthLoading(null);
    }
  };

  return (
    <div
      className="min-h-[100dvh] w-full flex items-center justify-center overflow-hidden relative bg-background"
    >
      <header className="fixed top-0 left-0 right-0 z-20 flex flex-col items-center pt-safe-plus pb-4 pointer-events-none">
        <div className="w-full max-w-md px-6 flex flex-col items-center pointer-events-auto">
          <img src="/vaipet-logo.svg" alt="VaiPet" className="h-10 w-auto mb-12" />
          
          <div className="w-full flex items-center min-h-[40px]">
            <AnimatePresence>
              {(isForgotPassword || isOTPMode || (isRegistering && signupIntent)) && (
                <motion.button
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  onClick={() => {
                    if (isForgotPassword) setIsForgotPassword(false);
                    else if (isOTPMode) setIsOTPMode(false);
                    else setSignupIntent(null);
                  }}
                  className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors flex items-center gap-2 text-sm font-medium text-primary"
                >
                  <ArrowLeft size={20} />
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
            {isOTPMode ? (
              <motion.div
                key="otp-mode"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full flex flex-col gap-6"
              >
                <div className="flex flex-col items-center gap-2">
                  <h2 className="text-2xl font-bold text-center">Verificar E-mail</h2>
                  <p className="text-sm text-center text-black/60">Digite o código de 6 dígitos enviado para <strong>{email}</strong></p>
                </div>
                <form onSubmit={handleVerifyOTP} className="flex flex-col gap-4">
                  <input
                    type="text"
                    placeholder="Código de 6 dígitos"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    className="w-full h-[56px] px-6 rounded-xl border border-separator bg-surface focus:outline-none focus:ring-1 focus:ring-primary transition-all text-ios-title-2 text-center tracking-widest font-bold"
                  />
                  <button type="submit" disabled={isLoading || otpCode.length < 6} className="w-full h-[56px] rounded-xl font-bold text-primary-foreground shadow-sm bg-primary active:scale-[0.98] transition-all disabled:opacity-40 mt-2">
                    {isLoading ? 'Verificando...' : 'Confirmar Código'}
                  </button>
                </form>
                <button 
                  type="button"
                  onClick={handleResendOTP}
                  disabled={isLoading}
                  className="text-sm font-semibold text-center underline opacity-60 hover:opacity-100 transition-opacity"
                >
                  Não recebeu o código? Enviar novamente
                </button>
              </motion.div>
            ) : isRecoveryMode ? (
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
                      className="w-full h-[56px] px-6 rounded-xl border border-separator bg-surface focus:outline-none focus:ring-1 focus:ring-primary transition-all text-ios-body pr-14"
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
                      className="w-full h-[56px] px-6 rounded-xl border border-separator bg-surface focus:outline-none focus:ring-1 focus:ring-primary transition-all text-ios-body pr-14"
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60 transition-opacity">
                      {showConfirmPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                    </button>
                  </div>
                  <button type="submit" disabled={isLoading} className="w-full h-[56px] rounded-xl font-bold text-primary-foreground shadow-sm bg-primary active:scale-[0.98] transition-all disabled:opacity-40 mt-2">
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
                    className="w-full h-[56px] px-6 rounded-xl border border-separator bg-surface focus:outline-none focus:ring-1 focus:ring-primary transition-all text-ios-body"
                  />
                  <button type="submit" disabled={isLoading} className="w-full h-[56px] rounded-xl font-bold text-primary-foreground shadow-sm bg-primary active:scale-[0.98] transition-all disabled:opacity-40 mt-2">
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
                  <button onClick={() => setSignupIntent('pet_owner')} className="p-6 rounded-xl border border-separator hover:border-primary text-left transition-all bg-surface active:scale-[0.98] group">
                    <h3 className="text-ios-headline font-bold mb-1">Dono(a) de Pet</h3>
                    <p className="text-ios-subheadline text-muted-foreground">Quero cuidar dos meus pets e solicitar passeios.</p>
                  </button>
                  <button onClick={() => setSignupIntent('petwalker')} className="p-6 rounded-xl border border-separator hover:border-primary text-left transition-all bg-surface active:scale-[0.98] group">
                    <h3 className="text-ios-headline font-bold mb-1">Quero ser PetWalker</h3>
                    <p className="text-ios-subheadline text-muted-foreground">Crie sua conta e depois envie sua candidatura.</p>
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
                <div className="flex flex-col items-center gap-2 mb-2">
                  <h2 className="text-[32px] font-bold tracking-tight text-center">
                    {isRegistering ? 'Criar Conta' : 'Entrar no VaiPet'}
                  </h2>
                  <p className="text-ios-body text-muted-foreground text-center">
                    {isRegistering ? 'Preencha os dados para começar' : 'Acesse sua conta para continuar'}
                  </p>
                </div>

                <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
                  {isRegistering && (
                    <>
                      <div className="relative group">
                        <input type="text" placeholder="Nome Completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full h-[56px] px-6 rounded-2xl border border-separator bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-ios-body" />
                      </div>
                      <div className="relative group">
                        <input type="tel" placeholder="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full h-[56px] px-6 rounded-2xl border border-separator bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-ios-body" />
                      </div>
                    </>
                  )}
                  <div className="relative group">
                    <div className="absolute left-6 top-1/2 -translate-y-1/2 text-primary">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    </div>
                    <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full h-[56px] pl-14 pr-6 rounded-2xl border border-separator bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-ios-body" />
                  </div>
                  <div className="relative group">
                    <div className="absolute left-6 top-1/2 -translate-y-1/2 text-primary">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="11" x="8" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                    <input type={showPassword ? "text" : "password"} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full h-[56px] pl-14 pr-14 rounded-2xl border border-separator bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-ios-body" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60 transition-opacity">
                      {showPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                    </button>
                  </div>
                  {isRegistering && (
                    <div className="relative group">
                      <input type={showConfirmPassword ? "text" : "password"} placeholder="Confirmar Senha" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full h-[56px] px-6 rounded-2xl border border-separator bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-ios-body pr-14" />
                      <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-60 transition-opacity">
                        {showConfirmPassword ? <EyeOff size={22} /> : <Eye size={22} />}
                      </button>
                    </div>
                  )}
                  <button type="submit" disabled={isLoading} className="w-full h-[56px] rounded-2xl font-bold text-white shadow-lg shadow-primary/20 bg-primary active:scale-[0.98] hover:brightness-105 transition-all disabled:opacity-40 mt-2 text-lg">
                    {isLoading ? 'Aguarde...' : (isRegistering ? 'Cadastrar' : 'Entrar')}
                  </button>
                </form>
                
                <div className="flex flex-col gap-4 mt-2">
                  {!isRegistering && (
                    <button onClick={() => setIsForgotPassword(true)} className="text-[15px] font-semibold text-center text-primary hover:underline transition-all">
                      Esqueci minha senha
                    </button>
                  )}
                  <button onClick={() => { setIsRegistering(!isRegistering); setSignupIntent(null); }} className="text-[15px] font-medium text-center text-foreground transition-all">
                    {isRegistering ? 'Já tem conta? ' : 'Não tem conta? '}
                    <span className="text-primary font-bold">{isRegistering ? 'Entre aqui' : 'Crie uma'}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!isRegistering && !isForgotPassword && !isRecoveryMode && (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-separator"></span></div>
                <div className="relative flex justify-center text-[11px] font-bold uppercase tracking-widest"><span className="px-4 text-muted-foreground bg-background">Ou continue com</span></div>
              </div>
              <div className="w-full flex flex-col gap-3">
                <button onClick={() => handleOAuth('google')} className="group w-full flex items-center justify-between px-6 transition-all active:scale-[0.98] border border-separator shadow-sm bg-surface h-[60px] rounded-2xl hover:border-primary/30">
                  <span className="flex items-center gap-4">
                    <GoogleIcon />
                    <span className="text-[16px] font-bold">Continuar com Google</span>
                  </span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-20 group-hover:opacity-100 transition-opacity"><path d="m9 18 6-6-6-6"/></svg>
                </button>
                <button onClick={() => handleOAuth('apple')} className="group w-full flex items-center justify-between px-6 transition-all active:scale-[0.98] border border-separator shadow-sm bg-surface h-[60px] rounded-2xl hover:border-primary/30">
                  <span className="flex items-center gap-4">
                    <AppleIcon />
                    <span className="text-[16px] font-bold">Continuar com Apple</span>
                  </span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-20 group-hover:opacity-100 transition-opacity"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>
            </>
          )}

          <div className="flex flex-col items-center gap-1 mt-10">
            <div className="flex items-center gap-1.5 opacity-60">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <p className="text-[11px] font-medium leading-relaxed text-center">
                Ao continuar, você concorda com os
              </p>
            </div>
            <div className="text-[11px] font-bold">
              <Link to="/termos-de-uso" className="text-primary underline">Termos de Uso</Link>
              <span className="mx-1 opacity-60">e</span>
              <Link to="/politica-de-privacidade" className="text-primary underline">Política de Privacidade</Link>.
            </div>
          </div>
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
