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
const TOKEN_TIMESTAMP_KEY = 'auth_token_timestamp';
const TOKEN_EXPIRY_HOURS = 24;

export const authService = {
  async login(credentials: LoginCredentials) {
    const response = await api.post<AuthResponse>('/auth/login', credentials);

    if (response.data?.access_token) {
      await AsyncStorage.setItem(TOKEN_KEY, response.data.access_token);
      await AsyncStorage.setItem(TOKEN_TIMESTAMP_KEY, Date.now().toString());
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
    await AsyncStorage.removeItem(TOKEN_TIMESTAMP_KEY);
    await AsyncStorage.removeItem('user_data');
  },

  async getToken() {
    return AsyncStorage.getItem(TOKEN_KEY);
  },

  async isTokenExpired(): Promise<boolean> {
    const timestampStr = await AsyncStorage.getItem(TOKEN_TIMESTAMP_KEY);

    if (!timestampStr) {
      return true;
    }

    const timestamp = parseInt(timestampStr, 10);
    const now = Date.now();
    const hoursPassed = (now - timestamp) / (1000 * 60 * 60);

    return hoursPassed >= TOKEN_EXPIRY_HOURS;
  },

  async isAuthenticated() {
    const token = await this.getToken();

    if (!token) {
      return false;
    }

    const expired = await this.isTokenExpired();

    if (expired) {
      await this.logout();
      return false;
    }

    return true;
  },

  async validateToken(): Promise<boolean> {
    const token = await this.getToken();

    if (!token) {
      return false;
    }

    const expired = await this.isTokenExpired();

    if (expired) {
      await this.logout();
      return false;
    }

    return true;
  },
};
