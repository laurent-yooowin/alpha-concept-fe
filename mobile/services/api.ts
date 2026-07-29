import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { tokenStorage } from './tokenStorage';

const RAW_API_URL =
  Platform.OS === 'web'
    ? process.env.EXPO_PUBLIC_API_URL_LOCAL
    : process.env.EXPO_PUBLIC_API_URL;
const getExpoDevHost = () => {
  const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoClient?.hostUri;
  const debuggerHost = Constants.manifest?.debuggerHost;
  const host = hostUri || debuggerHost;

  return host?.split(':')[0];
};

const normalizeApiUrl = (rawUrl?: string) => {
  const url = (rawUrl || 'https://reportbtp.com/api').replace(/\/+$/, '');
  const devHost = getExpoDevHost();

  if (
    __DEV__ &&
    Platform.OS !== 'web' &&
    devHost &&
    (url.includes('://localhost:') || url.includes('://127.0.0.1:'))
  ) {
    return url.replace('://localhost:', `://${devHost}:`).replace('://127.0.0.1:', `://${devHost}:`);
  }

  return url;
};
const API_URL = normalizeApiUrl(RAW_API_URL);

// Native file uploads need the resolved development host (not localhost).
export const getApiBaseUrl = () => API_URL;
const PUBLIC_ENDPOINT_PREFIXES = ['/auth/', '/public/'];

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  isTokenExpired?: boolean;
  status?: number;
  details?: any;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_URL}${endpoint}`;

  try {
    const isPublicEndpoint = PUBLIC_ENDPOINT_PREFIXES.some((prefix) => endpoint.includes(prefix));
    const isTokenValid = isPublicEndpoint ? true : await tokenStorage.validateToken();

    if (!isTokenValid) {
      return {
        error: 'Token expired. Please login again.',
        isTokenExpired: true,
      };
    }

    const token = await tokenStorage.getToken();

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

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // console.log("response API >>>: ", response);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const rawMessage = errorData.message || errorData.error || `HTTP error! status: ${response.status}`;
      const message = Array.isArray(rawMessage)
        ? rawMessage.join(' • ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : rawMessage?.message
            ? String(rawMessage.message)
            : JSON.stringify(rawMessage);

      if (response.status === 401 && !isPublicEndpoint) {
        await tokenStorage.clearToken();
        return {
          error: message || 'Session expired. Please login again.',
          isTokenExpired: true,
          status: response.status,
          details: errorData,
        };
      }

      return {
        error: message,
        status: response.status,
        details: errorData,
      };
    }

    const data = await response.json();
    return { data };
  } catch (error) {
    console.error('API request failed:', {
      url,
      method: options.method || 'GET',
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      error: error instanceof Error
        ? `${error.message} (${url})`
        : 'Problème Serveur ',
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
