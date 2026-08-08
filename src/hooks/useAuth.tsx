import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Session, User } from '@supabase/supabase-js';
import { Database } from '@/integrations/supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type AppRole = Database['public']['Enums']['app_role'];
type SignupIntent = 'pet_owner' | 'petwalker' | null;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  signupIntent: SignupIntent;
  petwalkerApplication: any | null;
  applicationStatus: 'pending' | 'approved' | 'rejected' | 'none';
  loading: boolean;
  authStatus: 'initializing' | 'authenticated' | 'unauthenticated';
  profileStatus: 'loading' | 'ready' | 'error';
  rolesStatus: 'loading' | 'ready' | 'error';
  authError: string | null;
  profileError: string | null;
  rolesError: string | null;
  applicationError: string | null;
  
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [petwalkerApplication, setPetwalkerApplication] = useState<any | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<'pending' | 'approved' | 'rejected' | 'none'>('none');
  
  const [authStatus, setAuthStatus] = useState<'initializing' | 'authenticated' | 'unauthenticated'>('initializing');
  const [profileStatus, setProfileStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rolesStatus, setRolesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [applicationError, setApplicationError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    setProfileStatus('loading');
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);
      setProfileStatus('ready');
    } catch (err: any) {
      console.error('Error fetching profile:', err);
      setProfileError(err.message);
      setProfileStatus('error');
    }
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
    setRolesStatus('loading');
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) throw error;
      setRoles(data.map(r => r.role as AppRole));
      setRolesStatus('ready');
    } catch (err: any) {
      console.error('Error fetching roles:', err);
      setRolesError(err.message);
      setRolesStatus('error');
    }
  }, []);

  const fetchApplication = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('petwalker_applications')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      setPetwalkerApplication(data);
      setApplicationStatus(data?.status || 'none');
    } catch (err: any) {
      console.error('Error fetching application:', err);
      setApplicationError(err.message);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setAuthStatus('authenticated');
        fetchProfile(session.user.id);
        fetchRoles(session.user.id);
        fetchApplication(session.user.id);
      } else {
        setAuthStatus('unauthenticated');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setAuthStatus('authenticated');
        fetchProfile(session.user.id);
        fetchRoles(session.user.id);
        fetchApplication(session.user.id);
      } else {
        setAuthStatus('unauthenticated');
        setProfile(null);
        setRoles([]);
        setPetwalkerApplication(null);
        setApplicationStatus('none');
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, fetchRoles, fetchApplication]);

  const signOut = async () => {
    await supabase.auth.signOut();
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
    signupIntent: (profile?.signup_intent as SignupIntent) || null,
    petwalkerApplication,
    applicationStatus,
    loading: authStatus === 'initializing' || (authStatus === 'authenticated' && (profileStatus === 'loading' || rolesStatus === 'loading')),
    authStatus,
    profileStatus,
    rolesStatus,
    authError,
    profileError,
    rolesError,
    applicationError,
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
