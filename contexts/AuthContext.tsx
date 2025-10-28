import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { authService } from '@/services/authService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Alert, AppState } from 'react-native';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

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
  const tokenCheckInterval = useRef<NodeJS.Timeout | null>(null);

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
        setUser(JSON.parse(userData));
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
            onPress: () => {
              logout();
              router.replace('/login');
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
    setIsAuthenticated(true);
    setUser(userData);
    await AsyncStorage.setItem('user_data', JSON.stringify(userData));
    startTokenExpirationCheck();
  };

  const logout = async () => {
    stopTokenExpirationCheck();
    await authService.logout();
    await AsyncStorage.removeItem('user_data');
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
