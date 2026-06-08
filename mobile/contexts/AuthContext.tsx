import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { authService } from '@/services/authService';
import { userService } from '@/services/userService';
import { organizationService } from '@/services/organizationService';
import {
  loginRoute,
  persistOrganizationId,
  persistOrganizationSlug,
} from '@/services/organizationContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Alert, AppState } from 'react-native';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId?: string | null;
  organizationSlug?: string | null;
}

const HYPER_ADMIN_ROLE = 'ROLE_HYPER_ADMIN';

interface AuthContextType {
  isAuthenticated: boolean | null;
  user: User | null;
  login: (userData: User) => Promise<void>;
  logout: () => Promise<void>;
  checkTokenExpiration: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const tokenCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkAuth();
    startTokenExpirationCheck();

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      stopTokenExpirationCheck();
      subscription.remove();
    };
  }, []);

  const handleAppStateChange = (nextAppState: string) => {
    if (nextAppState === 'active') {
      checkTokenExpiration();
    }
  };

  const checkAuth = async () => {
    const authenticated = await authService.isAuthenticated();
    setIsAuthenticated(authenticated);

    if (authenticated) {
      const userData = await AsyncStorage.getItem('user_data');
      if (userData) {
        const parsedUser = JSON.parse(userData);
        if (parsedUser?.role === HYPER_ADMIN_ROLE) {
          await authService.logout();
          setIsAuthenticated(false);
          setUser(null);
          return;
        }
        setUser(parsedUser);
      }
    } else {
      setUser(null);
    }
  };

  const checkTokenExpiration = async () => {
    const isTokenValid = await authService.validateToken();

    if (!isTokenValid && isAuthenticated) {
      Alert.alert(
        'Session expirée',
        'Votre session a expiré après 24 heures. Veuillez vous reconnecter.',
        [
          {
            text: 'Se reconnecter',
            onPress: async () => {
              const slug = user?.organizationSlug || (await AsyncStorage.getItem('last_org_slug')) || undefined;
              await logout();
              router.replace(loginRoute(slug || ''));
            }
          }
        ],
        { cancelable: false }
      );
    }
  };

  const startTokenExpirationCheck = () => {
    stopTokenExpirationCheck();
    tokenCheckInterval.current = setInterval(() => {
      checkTokenExpiration();
    }, 5 * 60 * 1000);
  };

  const stopTokenExpirationCheck = () => {
    if (tokenCheckInterval.current) {
      clearInterval(tokenCheckInterval.current);
      tokenCheckInterval.current = null;
    }
  };

  const login = async (userData: User) => {
    if (userData.role === HYPER_ADMIN_ROLE) {
      await authService.logout();
      setIsAuthenticated(false);
      setUser(null);
      Alert.alert(
        'Accès refusé',
        "L'application mobile est réservée aux coordonnateurs de l'organisation.",
      );
      return;
    }

    // Enrich user with full profile (incl. organization) when possible,
    // so we can persist the user's organization for future sessions.
    let enriched: User = userData;
    try {
      const res = await userService.getProfile();
      if (res?.data) {
        enriched = { ...userData, ...(res.data as any) };
      }
    } catch {}
    try {
      const orgRes = await organizationService.getCurrent();
      if (orgRes?.data) {
        enriched = {
          ...enriched,
          organizationId: orgRes.data.id,
          organizationSlug: orgRes.data.slug,
        };
      }
    } catch {}
    if (enriched.role === HYPER_ADMIN_ROLE) {
      await authService.logout();
      setIsAuthenticated(false);
      setUser(null);
      Alert.alert(
        'Accès refusé',
        "L'application mobile est réservée aux coordonnateurs de l'organisation.",
      );
      return;
    }
    setIsAuthenticated(true);
    setUser(enriched);
    await AsyncStorage.setItem('user_data', JSON.stringify(enriched));
    if ((enriched as any)?.organizationSlug) {
      await persistOrganizationSlug((enriched as any).organizationSlug);
    }
    if ((enriched as any)?.organizationId) {
      await persistOrganizationId((enriched as any).organizationId);
    }
    startTokenExpirationCheck();
  };

  const logout = async () => {
    stopTokenExpirationCheck();
    await authService.logout();
    await AsyncStorage.removeItem('user_data');
    // Keep `last_org_slug` / `last_org_id` so the user is reminded of
    // their organization on next login.
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, checkTokenExpiration }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
