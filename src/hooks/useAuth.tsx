import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'error';
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  authStatus: AuthStatus;
  profileStatus: ProfileStatus;
  authError: Error | null;
  profileError: Error | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing');
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  const [authError, setAuthError] = useState<Error | null>(null);
  const [profileError, setProfileError] = useState<Error | null>(null);
  
  const currentUserIdRef = useRef<string | null>(null);
  const requestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    // Abort previous request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

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

      // Verify if this request is still the latest and for the correct user
      if (requestId !== requestIdRef.current || userId !== currentUserIdRef.current) {
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
      
      // If this request is no longer relevant, silent exit
      if (requestId !== requestIdRef.current || userId !== currentUserIdRef.current) {
        return;
      }

      if (err.name === 'AbortError' || err.message === 'Fetch is aborted') {
        return;
      }

      console.error('[AuthProvider] Profile fetch exception:', err);
      setProfileError(err);
      setProfileStatus('error');
    } finally {
      if (requestId === requestIdRef.current) {
        abortControllerRef.current = null;
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
      console.log('[AuthProvider] Auth event:', event);
      
      // Synchronous updates only in the callback to avoid deadlocks
      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user);
        setAuthStatus('authenticated');
      } else {
        setSession(null);
        setUser(null);
        setProfile(null);
        setAuthStatus('unauthenticated');
        setProfileStatus('idle');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // React to user changes separately
  useEffect(() => {
    currentUserIdRef.current = user?.id || null;
    if (authStatus === 'authenticated' && user) {
      fetchProfile(user.id);
    }
    
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [user, authStatus, fetchProfile]);

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      setUser(null);
      setSession(null);
      setProfile(null);
      setAuthStatus('unauthenticated');
      setProfileStatus('idle');
    } catch (err) {
      console.error('[AuthProvider] SignOut error:', err);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const value = {
    user,
    session,
    profile,
    loading: authStatus === 'initializing' || (authStatus === 'authenticated' && (profileStatus === 'loading' || profileStatus === 'idle')),
    authStatus,
    profileStatus,
    authError,
    profileError,
    signOut,
    refreshProfile
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
