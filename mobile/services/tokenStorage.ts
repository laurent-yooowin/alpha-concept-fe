import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auth_token';
const TOKEN_TIMESTAMP_KEY = 'auth_token_timestamp';
const TOKEN_EXPIRY_HOURS = 24;

export const tokenStorage = {
  async setToken(token: string) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem(TOKEN_TIMESTAMP_KEY, Date.now().toString());
  },

  async getToken() {
    return AsyncStorage.getItem(TOKEN_KEY);
  },

  async clearToken() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(TOKEN_TIMESTAMP_KEY);
  },

  async isTokenExpired() {
    const timestampStr = await AsyncStorage.getItem(TOKEN_TIMESTAMP_KEY);
    if (!timestampStr) return true;

    const timestamp = parseInt(timestampStr, 10);
    const hoursPassed = (Date.now() - timestamp) / (1000 * 60 * 60);
    return hoursPassed >= TOKEN_EXPIRY_HOURS;
  },

  async validateToken() {
    const token = await this.getToken();
    if (!token) return false;

    const expired = await this.isTokenExpired();
    if (expired) {
      await this.clearToken();
      return false;
    }

    return true;
  },
};
