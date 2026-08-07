import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Tables, Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];
type SignupIntent = 'pet_owner' | 'petwalker';

type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
type RolesStatus = 'idle' | 'loading' | 'ready' | 'error';
type ApplicationStatus = 'idle' | 'loading' | 'none' | 'pending' | 'approved' | 'rejected' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Tables<'profiles'> | null;
  roles: AppRole[];
  signupIntent: SignupIntent | null;
  petwalkerApplication: Tables<'petwalker_applications'> | null;
  applicationStatus: ApplicationStatus;
  loading: boolean;
  authStatus: AuthStatus;
  profileStatus: ProfileStatus;
  rolesStatus: RolesStatus;
  authError: Error | null;
  profileError: Error | null;
  rolesError: Error | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  refreshApplication: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Tables<'profiles'> | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing');
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  const [rolesStatus, setRolesStatus] = useState<RolesStatus>('idle');
  const [petwalkerApplication, setPetwalkerApplication] = useState<Tables<'petwalker_applications'> | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<ApplicationStatus>('idle');
  const [authError, setAuthError] = useState<Error | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const [rolesError, setRolesError] = useState<Error | null>(null);
  
  const currentUserIdRef = useRef<string | null>(null);
  const profileRequestIdRef = useRef<number>(0);
  const intentRequestIdRef = useRef<number>(0);
  const rolesRequestIdRef = useRef<number>(0);
  const appRequestIdRef = useRef<number>(0);
  const profileAbortControllerRef = useRef<AbortController | null>(null);
  const rolesAbortControllerRef = useRef<AbortController | null>(null);
  const appAbortControllerRef = useRef<AbortController | null>(null);

  const fetchRoles = useCallback(async (userId: string) => {
    if (rolesAbortControllerRef.current) rolesAbortControllerRef.current.abort();
    const requestId = ++rolesRequestIdRef.current;
    const controller = new AbortController();
    rolesAbortControllerRef.current = controller;
    setRolesStatus('loading');
    setRolesError(null);

    try {
      const { data, error } = await Promise.race([
        (supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId) as any).abortSignal(controller.signal),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);

      if (requestId !== rolesRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        setRolesError(error);
        setRolesStatus('error');
      } else {
        setRoles(data?.map((r: any) => r.role as AppRole) || []);
        setRolesStatus('ready');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (requestId !== rolesRequestIdRef.current) return;
      setRolesError(err);
      setRolesStatus('error');
    }
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    if (profileAbortControllerRef.current) profileAbortControllerRef.current.abort();
    const requestId = ++profileRequestIdRef.current;
    const controller = new AbortController();
    profileAbortControllerRef.current = controller;
    setProfileStatus('loading');

    try {
      const { data, error } = await Promise.race([
        (supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle() as any).abortSignal(controller.signal),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);

      if (requestId !== profileRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        setProfileError(error);
        setProfileStatus('error');
      } else if (!data) {
        setProfileStatus('missing');
      } else {
        setProfile(data);
        setProfileStatus('ready');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (requestId !== profileRequestIdRef.current) return;
      setProfileError(err);
      setProfileStatus('error');
    }
  }, []);

  const fetchApplication = useCallback(async (userId: string) => {
    if (appAbortControllerRef.current) appAbortControllerRef.current.abort();
    const requestId = ++appRequestIdRef.current;
    const controller = new AbortController();
    appAbortControllerRef.current = controller;
    setApplicationStatus('loading');

    try {
      const { data, error } = await Promise.race([
        (supabase
          .from('petwalker_applications')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle() as any).abortSignal(controller.signal),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);

      if (requestId !== appRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        setApplicationStatus('error');
      } else if (!data) {
        setPetwalkerApplication(null);
        setApplicationStatus('none');
      } else {
        setPetwalkerApplication(data);
        setApplicationStatus(data.status as ApplicationStatus);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (requestId !== appRequestIdRef.current) return;
      setApplicationStatus('error');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const initAuth = async () => {
      try {
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Auth Timeout')), 10000))
        ]);
        if (mounted) {
          if (session) {
            setSession(session);
            setUser(session.user);
            setAuthStatus('authenticated');
          } else {
            setAuthStatus('unauthenticated');
          }
        }
      } catch (e) {
        if (mounted) setAuthStatus('error');
      }
    };
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user);
        setAuthStatus('authenticated');
      } else {
        setSession(null);
        setUser(null);
        setProfile(null);
        setRoles([]);
        setPetwalkerApplication(null);
        setAuthStatus('unauthenticated');
        setProfileStatus('idle');
        setRolesStatus('idle');
        setApplicationStatus('idle');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    currentUserIdRef.current = user?.id || null;
    if (authStatus === 'authenticated' && user) {
      fetchProfile(user.id);
      fetchRoles(user.id);
      fetchApplication(user.id);

      const channel = supabase
        .channel(`app-status-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'petwalker_applications',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            setPetwalkerApplication(payload.new as Tables<'petwalker_applications'>);
            const newStatus = (payload.new as any).status as ApplicationStatus;
            setApplicationStatus(newStatus);
            if (newStatus === 'approved') {
              fetchRoles(user.id);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, authStatus, fetchProfile, fetchRoles, fetchApplication]);

  // Handle pending signup intent after login (NOT inside onAuthStateChange)
  useEffect(() => {
    if (authStatus === 'authenticated' && user && profileStatus === 'ready') {
      const pendingIntentStr = localStorage.getItem('vaipet_pending_signup_intent');
      if (pendingIntentStr) {
        const processIntent = async () => {
          const requestId = ++intentRequestIdRef.current;
          let intentData: any;
          
          try {
            intentData = JSON.parse(pendingIntentStr);
          } catch (e) {
            console.error('Invalid intent JSON:', e);
            localStorage.removeItem('vaipet_pending_signup_intent');
            return;
          }

          const { intent, timestamp } = intentData;
          const now = Date.now();
          
          // Validate: Only pet_owner or petwalker, within 30 minutes
          if (
            (intent !== 'pet_owner' && intent !== 'petwalker') || 
            (now - timestamp > 30 * 60 * 1000)
          ) {
            console.warn('Expired or invalid intent:', intent);
            localStorage.removeItem('vaipet_pending_signup_intent');
            return;
          }

          try {
            const { error } = await Promise.race([
              supabase.rpc('set_signup_intent', { _intent: intent }),
              new Promise<any>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), 10000))
            ]);

            if (error) {
              console.error('Error applying intent:', error);
              // Do NOT remove from localStorage on network/server error to allow retry
              return;
            }
            
            if (requestId === intentRequestIdRef.current) {
              await fetchProfile(user.id);
              localStorage.removeItem('vaipet_pending_signup_intent');
            }
          } catch (e) {
            console.error('Error processing intent RPC:', e);
            // Do NOT remove on timeout/network error
          }
        };
        processIntent();
      }
    }
  }, [authStatus, user, profileStatus, fetchProfile]);

  const signOut = async () => {
    if (profileAbortControllerRef.current) profileAbortControllerRef.current.abort();
    if (rolesAbortControllerRef.current) rolesAbortControllerRef.current.abort();
    if (appAbortControllerRef.current) appAbortControllerRef.current.abort();
    
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setAuthStatus('unauthenticated');
  };

  const refreshProfile = () => user ? fetchProfile(user.id) : Promise.resolve();
  const refreshRoles = () => user ? fetchRoles(user.id) : Promise.resolve();
  const refreshApplication = () => user ? fetchApplication(user.id) : Promise.resolve();

  const hasRole = (role: AppRole) => roles.includes(role);

  const value = {
    user,
    session,
    profile,
    roles,
    signupIntent: profile?.signup_intent || null,
    petwalkerApplication,
    applicationStatus,
    loading: authStatus === 'initializing' || (authStatus === 'authenticated' && (profileStatus === 'loading' || rolesStatus === 'loading')),
    authStatus,
    profileStatus,
    rolesStatus,
    authError,
    profileError,
    rolesError,
    signOut,
    refreshProfile,
    refreshRoles,
    refreshApplication,
    hasRole
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};