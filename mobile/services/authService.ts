import { api } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { tokenStorage } from './tokenStorage';
import {
  getStoredOrganizationSlug,
  persistOrganizationSlug,
} from './organizationContext';

export interface LoginCredentials {
  email: string;
  password: string;
  organizationSlug?: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  company?: string;
  experience?: number;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    organizationId?: string | null;
    organizationSlug?: string | null;
  };
}

const HYPER_ADMIN_ROLE = 'ROLE_HYPER_ADMIN';

export const authService = {
  async login(credentials: LoginCredentials) {
    const organizationSlug = credentials.organizationSlug || await getStoredOrganizationSlug();
    const response = await api.post<AuthResponse>('/auth/login', {
      ...credentials,
      organizationSlug,
    });

    if (response.data?.user?.role === HYPER_ADMIN_ROLE) {
      await this.logout();
      return {
        error: "L'application mobile est réservée aux coordonnateurs de l'organisation.",
      };
    }

    if (response.data?.access_token) {
      await tokenStorage.setToken(response.data.access_token);
      await persistOrganizationSlug(organizationSlug);
    }

    return response;
  },

  async register(userData: RegisterData) {
    return api.post<AuthResponse>('/auth/register', userData);
  },

  async forgotPassword(email: string) {
    return api.post('/auth/forgot-password', { email });
  },

  async verifyCode(email: string, code: string) {
    return api.post<{ resetToken: string; message: string }>('/auth/verify-code', { email, code });
  },

  async resetPassword(token: string, newPassword: string) {
    return api.post('/auth/reset-password', { token, newPassword });
  },

  async logout() {
    await tokenStorage.clearToken();
    await AsyncStorage.removeItem('user_data');
  },

  async getToken() {
    return tokenStorage.getToken();
  },

  async isTokenExpired(): Promise<boolean> {
    return tokenStorage.isTokenExpired();
  },

  async isAuthenticated() {
    return tokenStorage.validateToken();
  },

  async validateToken(): Promise<boolean> {
    return tokenStorage.validateToken();
  },
};
