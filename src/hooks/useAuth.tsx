import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Tables, Database } from '@/integrations/supabase/types';

// Use string for AppRole if enum is not yet in types.ts
type AppRole = Database['public']['Enums']['app_role'];
type SignupIntent = 'pet_owner' | 'petwalker';

type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
type RolesStatus = 'idle' | 'loading' | 'ready' | 'error';
type ApplicationStatus = 'idle' | 'loading' | 'none' | 'pending' | 'approved' | 'rejected' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: any | null; // Profile type might be missing signup_intent
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
  const [profile, setProfile] = useState<any | null>(null);
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
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .abortSignal(controller.signal);

      if (requestId !== rolesRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        console.error('[AuthProvider] Roles error:', error);
        setRolesError(error);
        setRolesStatus('error');
      } else {
        setRoles(data?.map(r => r.role as AppRole) || []);
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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
        .abortSignal(controller.signal);

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
      const { data, error } = await supabase
        .from('petwalker_applications')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()
        .abortSignal(controller.signal);

      if (requestId !== appRequestIdRef.current || userId !== currentUserIdRef.current) return;

      if (error) {
        console.error('[AuthProvider] App error:', error);
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
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        if (session) {
          setSession(session);
          setUser(session.user);
          setAuthStatus('authenticated');
        } else {
          setAuthStatus('unauthenticated');
        }
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
    }
  }, [user, authStatus, fetchProfile, fetchRoles, fetchApplication]);

  const signOut = async () => {
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
