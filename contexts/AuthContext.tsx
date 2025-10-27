import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '@/services/authService';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const authenticated = await authService.isAuthenticated();
    setIsAuthenticated(authenticated);

    if (authenticated) {
      const userData = await AsyncStorage.getItem('user_data');
      if (userData) {
        setUser(JSON.parse(userData));
      }
    }
  };

  const login = async (userData: User) => {
    setIsAuthenticated(true);
    setUser(userData);
    await AsyncStorage.setItem('user_data', JSON.stringify(userData));
  };

  const logout = async () => {
    await authService.logout();
    await AsyncStorage.removeItem('user_data');
    setIsAuthenticated(false);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout }}>
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
