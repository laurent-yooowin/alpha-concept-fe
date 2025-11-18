import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authAPI, usersAPI, setAccessToken, clearAccessToken, getAccessToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  address: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: 'ROLE_USER' | 'ROLE_ADMIN';
  zone_geographique: string | null;
  specialite: string | null;
  isActive: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext < AuthContextType | undefined > (undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState < User | null > (null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = getAccessToken();
    if (token) {
      try {
        const profileData = await usersAPI.getProfile();
        setUser(profileData);
      } catch (error) {
        console.error('Auth check failed:', error);
        clearAccessToken();
      }
    }
    setLoading(false);
  };

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    try {
      const response = await authAPI.login(email, password);
      setAccessToken(response.access_token);
      const profileData = await usersAPI.getProfile();
      setUser(profileData);
      return { error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    clearAccessToken();
    setUser(null);
  };

  const refreshProfile = async () => {
    try {
      const profileData = await usersAPI.getProfile();
      setUser(profileData);
    } catch (error) {
      console.error('Refresh profile error:', error);
    }
  };

  const value: AuthContextType = {
    user,
    profile: user,
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
