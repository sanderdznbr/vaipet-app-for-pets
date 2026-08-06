import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Tables, Database } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;
type AppRole = Database['public']['Enums']['app_role'];

type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
type RolesStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
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
  hasRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing');
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  const [rolesStatus, setRolesStatus] = useState<RolesStatus>('idle');
  const [authError, setAuthError] = useState<Error | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);
  const [rolesError, setRolesError] = useState<Error | null>(null);
  
  const currentUserIdRef = useRef<string | null>(null);
  const profileRequestIdRef = useRef<number>(0);
  const rolesRequestIdRef = useRef<number>(0);
  const profileAbortControllerRef = useRef<AbortController | null>(null);
  const rolesAbortControllerRef = useRef<AbortController | null>(null);

  const fetchRoles = useCallback(async (userId: string) => {
    if (rolesAbortControllerRef.current) {
      rolesAbortControllerRef.current.abort();
    }

    const requestId = ++rolesRequestIdRef.current;
    const controller = new AbortController();
    rolesAbortControllerRef.current = controller;

    setRolesStatus('loading');
    setRolesError(null);

    let timeoutId: any;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error('Roles fetch timeout');
        (error as any).isTimeout = true;
        reject(error);
      }, 10000);
    });

    try {
      const fetchPromise = supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        // @ts-ignore
        .abortSignal(controller.signal);

      // @ts-ignore
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
      clearTimeout(timeoutId);

      if (requestId !== rolesRequestIdRef.current || userId !== currentUserIdRef.current) {
        return;
      }

      if (error) {
        if (error.message === 'Fetch is aborted') return;
        console.error('[AuthProvider] Error fetching roles:', error);
        setRolesError(error);
        setRolesStatus('error');
      } else {
        setRoles(data?.map(r => r.role) || []);
        setRolesStatus('ready');
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.isTimeout && controller) controller.abort();
      if (requestId !== rolesRequestIdRef.current || userId !== currentUserIdRef.current) return;
      if (err.name === 'AbortError' || err.message === 'Fetch is aborted') return;

      console.error('[AuthProvider] Roles fetch exception:', err);
      setRolesError(err);
      setRolesStatus('error');
    } finally {
      if (requestId === rolesRequestIdRef.current) {
        rolesAbortControllerRef.current = null;
      }
    }
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    if (profileAbortControllerRef.current) {
      profileAbortControllerRef.current.abort();
    }

    const requestId = ++profileRequestIdRef.current;
    const controller = new AbortController();
    profileAbortControllerRef.current = controller;

    setProfileStatus('loading');
    setProfileError(null);

    let timeoutId: any;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error('Profile fetch timeout');
        (error as any).isTimeout = true;
        reject(error);
      }, 10000);
    });

    try {
      const fetchPromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
        // @ts-ignore
        .abortSignal(controller.signal);

      // @ts-ignore
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
      clearTimeout(timeoutId);

      if (requestId !== profileRequestIdRef.current || userId !== currentUserIdRef.current) {
        return;
      }

      if (error) {
        if (error.message === 'Fetch is aborted') return;
        console.error('[AuthProvider] Error fetching profile:', error);
        setProfileError(error);
        setProfileStatus('error');
      } else if (!data) {
        console.warn('[AuthProvider] Profile missing for user:', userId);
        setProfileStatus('missing');
      } else {
        setProfile(data);
        setProfileStatus('ready');
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.isTimeout && controller) controller.abort();
      if (requestId !== profileRequestIdRef.current || userId !== currentUserIdRef.current) return;
      if (err.name === 'AbortError' || err.message === 'Fetch is aborted') return;

      console.error('[AuthProvider] Profile fetch exception:', err);
      setProfileError(err);
      setProfileStatus('error');
    } finally {
      if (requestId === profileRequestIdRef.current) {
        profileAbortControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (mounted) {
          if (session) {
            setSession(session);
            setUser(session.user);
            setAuthStatus('authenticated');
          } else {
            setAuthStatus('unauthenticated');
          }
        }
      } catch (err: any) {
        console.error('[AuthProvider] Session init error:', err);
        if (mounted) {
          setAuthError(err);
          setAuthStatus('error');
        }
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user);
        setAuthStatus('authenticated');
      } else {
        setSession(null);
        setUser(null);
        setProfile(null);
        setRoles([]);
        setAuthStatus('unauthenticated');
        setProfileStatus('idle');
        setRolesStatus('idle');
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
    }
    
    return () => {
      if (profileAbortControllerRef.current) profileAbortControllerRef.current.abort();
      if (rolesAbortControllerRef.current) rolesAbortControllerRef.current.abort();
    };
  }, [user, authStatus, fetchProfile, fetchRoles]);

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      setUser(null);
      setSession(null);
      setProfile(null);
      setRoles([]);
      setAuthStatus('unauthenticated');
      setProfileStatus('idle');
      setRolesStatus('idle');
    } catch (err) {
      console.error('[AuthProvider] SignOut error:', err);
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const refreshRoles = async () => {
    if (user) await fetchRoles(user.id);
  };

  const hasRole = (role: AppRole) => roles.includes(role);

  const value = {
    user,
    session,
    profile,
    roles,
    loading: authStatus === 'initializing' || (authStatus === 'authenticated' && (profileStatus === 'loading' || profileStatus === 'idle' || rolesStatus === 'loading' || rolesStatus === 'idle')),
    authStatus,
    profileStatus,
    rolesStatus,
    authError,
    profileError,
    rolesError,
    signOut,
    refreshProfile,
    refreshRoles,
    hasRole
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
