import { api } from './api';

export interface Mission {
  id: string;
  title: string;
  client?: string;
  address?: string;
  date?: string;
  time?: string;
  type?: string;
  status: 'en_cours' | 'terminee' | 'en_attente';
  description?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
  visitsCount: number;
  reportsCount: number;
  createdAt: string;
  updatedAt: string;
  endDate: string;
  refClient: string;
  refBusiness: string;
}

export interface CreateMissionData {
  title: string;
  client?: string;
  address?: string;
  date?: string;
  time?: string;
  type?: string;
  description?: string;
  status?: 'en_cours' | 'terminee' | 'en_attente';
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface UpdateMissionData {
  title?: string;
  client?: string;
  address?: string;
  date?: string;
  time?: string;
  type?: string;
  description?: string;
  status?: 'en_cours' | 'terminee' | 'en_attente';
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export const missionService = {
  async getMissions() {
    return api.get<Mission[]>('/missions');
  },

  async getMission(id: string) {
    return api.get<Mission>(`/missions/${id}`);
  },

  async createMission(data: CreateMissionData) {
    return api.post<Mission>('/missions', data);
  },

  async updateMission(id: string, data: UpdateMissionData) {
    return api.put<Mission>(`/missions/${id}`, data);
  },

  async deleteMission(id: string) {
    return api.delete(`/missions/${id}`);
  },
};
