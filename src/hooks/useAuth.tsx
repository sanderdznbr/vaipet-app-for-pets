import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
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

  const fetchProfile = useCallback(async (userId: string) => {
    setProfileStatus('loading');
    setProfileError(null);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
    );

    try {
      const fetchPromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      const { data, error } = (await Promise.race([fetchPromise, timeoutPromise])) as any;

      if (error) {
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
      console.error('[AuthProvider] Profile fetch exception:', err);
      setProfileError(err);
      setProfileStatus('error');
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
    if (authStatus === 'authenticated' && user) {
      fetchProfile(user.id);
    }
  }, [user, authStatus, fetchProfile]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
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
    loading: authStatus === 'initializing' || profileStatus === 'loading',
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
