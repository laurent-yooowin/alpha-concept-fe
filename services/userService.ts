import { api } from './api';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'csps' | 'admin' | 'coordinator';
  phone?: string;
  company?: string;
  experience?: number;
  isActive: boolean;
  createdAt: string;
}

export const userService = {
  async getProfile() {
    return api.get<User>('/users/profile');
  },

  async updateProfile(userData: Partial<User>) {
    const profile = await this.getProfile();
    if (profile.data?.id) {
      return api.put<User>(`/users/${profile.data.id}`, userData);
    }
    return { error: 'Unable to get user ID' };
  },

  async getAllUsers() {
    return api.get<User[]>('/users');
  },

  async getUserById(id: string) {
    return api.get<User>(`/users/${id}`);
  },

  async updateUser(id: string, userData: Partial<User>) {
    return api.put<User>(`/users/${id}`, userData);
  },

  async deleteUser(id: string) {
    return api.delete(`/users/${id}`);
  },
};
