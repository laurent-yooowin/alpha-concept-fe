import { api } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  company?: string;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

const TOKEN_KEY = 'auth_token';

export const authService = {
  async login(credentials: LoginCredentials) {
    const response = await api.post<AuthResponse>('/auth/login', credentials);

    if (response.data?.access_token) {
      await AsyncStorage.setItem(TOKEN_KEY, response.data.access_token);
    }

    return response;
  },

  async register(userData: RegisterData) {
    return api.post<AuthResponse>('/auth/register', userData);
  },

  async forgotPassword(email: string) {
    return api.post('/auth/forgot-password', { email });
  },

  async resetPassword(token: string, newPassword: string) {
    return api.post('/auth/reset-password', { token, newPassword });
  },

  async logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
  },

  async getToken() {
    return AsyncStorage.getItem(TOKEN_KEY);
  },

  async isAuthenticated() {
    const token = await this.getToken();
    return !!token;
  },
};
