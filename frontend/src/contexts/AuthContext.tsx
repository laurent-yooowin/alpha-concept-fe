import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authAPI, usersAPI, currentOrgAPI, setAccessToken, clearAccessToken, getAccessToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  address: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: 'ROLE_USER' | 'ROLE_ADMIN' | 'ROLE_HYPER_ADMIN';
  zone_geographique: string | null;
  specialite: string | null;
  isActive: boolean;
  organizationId?: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  backgroundImageUrl?: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  cguContent?: string | null;
  privacyContent?: string | null;
  loginTitle?: string | null;
  loginContent?: string | null;
  legalValidationStatus?: 'en_cours' | 'termine';
  legalValidationRequestedAt?: string | null;
  legalValidationValidatedAt?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: User | null;
  organization: Organization | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string,
    organizationSlug?: string,
    options?: { hyperAdminOnly?: boolean },
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext < AuthContextType | undefined > (undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState < User | null > (null);
  const [organization, setOrganization] = useState < Organization | null > (null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const loadOrganization = async (currentUser: User | null) => {
    if (!currentUser || !currentUser.organizationId || currentUser.role === 'ROLE_HYPER_ADMIN') {
      setOrganization(null);
      // expose for non-react consumers (e.g. PDF generator)
      (window as any).__currentOrganization = null;
      return;
    }
    try {
      const org = await currentOrgAPI.get();
      setOrganization(org);
      (window as any).__currentOrganization = org;
      // Persist the user's organization slug so they can be redirected
      // automatically to their org login portal on future visits.
      if (org?.slug) {
        try { localStorage.setItem('lastOrgSlug', org.slug); } catch {}
      }
    } catch (e) {
      console.warn('Failed to load organization', e);
      setOrganization(null);
      (window as any).__currentOrganization = null;
    }
  };

  const checkAuth = async () => {
    const token = getAccessToken();
    if (token) {
      try {
        const profileData = await usersAPI.getProfile();
        setUser(profileData);
        await loadOrganization(profileData);
      } catch (error) {
        console.error('Auth check failed:', error);
        clearAccessToken();
      }
    }
    setLoading(false);
  };

  const signIn = async (
    email: string,
    password: string,
    organizationSlug?: string,
    options?: { hyperAdminOnly?: boolean },
  ): Promise<{ error: Error | null }> => {
    try {
      const response = await authAPI.login(email, password, organizationSlug);
      if (options?.hyperAdminOnly && response.user?.role !== 'ROLE_HYPER_ADMIN') {
        return { error: new Error('Ce portail est réservé au compte Hyper Admin ReportBTP.') };
      }
      setAccessToken(response.access_token);
      const profileData = await usersAPI.getProfile();
      setUser(profileData);
      await loadOrganization(profileData);
      return { error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    clearAccessToken();
    setUser(null);
    setOrganization(null);
    (window as any).__currentOrganization = null;
  };

  const refreshProfile = async () => {
    try {
      const profileData = await usersAPI.getProfile();
      setUser(profileData);
      await loadOrganization(profileData);
    } catch (error) {
      console.error('Refresh profile error:', error);
    }
  };

  const value: AuthContextType = {
    user,
    profile: user,
    organization,
    loading,
    signIn,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
