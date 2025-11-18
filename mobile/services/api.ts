import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { authService } from './authService';

const API_URL = Platform.OS == 'web' ? process.env.EXPO_PUBLIC_API_URL_LOCAL : process.env.EXPO_PUBLIC_API_URL;
const TOKEN_KEY = 'auth_token';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  isTokenExpired?: boolean;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const isTokenValid = await authService.validateToken();

    if (!isTokenValid && !endpoint.includes('/auth/')) {
      return {
        error: 'Token expired. Please login again.',
        isTokenExpired: true,
      };
    }

    const token = await AsyncStorage.getItem(TOKEN_KEY);

    const isFormData = options.body instanceof FormData;

    const headers: Record<string, string> = {
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...options.headers as Record<string, string>,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (headers['Content-Type']?.includes('multipart/form-data')) {
      delete headers['Content-Type'];
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      await authService.logout();
      return {
        error: 'Session expired. Please login again.',
        isTokenExpired: true,
      };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        error: errorData.message || `HTTP error! status: ${response.status}`,
      };
    }

    const data = await response.json();
    return { data };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Network request failed',
    };
  }
}

export const api = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  put: <T>(endpoint: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  delete: <T>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
};
