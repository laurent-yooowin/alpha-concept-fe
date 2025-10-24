import { api } from './api';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'csps' | 'admin' | 'coordinator';
  phone?: string;
  company?: string;
  isActive: boolean;
  createdAt: string;
}

export const userService = {
  async getProfile() {
    return api.get<User>('/users/profile');
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
