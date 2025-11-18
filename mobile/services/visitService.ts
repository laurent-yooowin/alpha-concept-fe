import { api } from './api';

export interface PhotoAnalysis {
  observation: string;
  recommendation: string;
  riskLevel: 'faible' | 'moyen' | 'eleve';
  confidence: number;
}

export interface Photo {
  id: string;
  uri: string;
  analysis: PhotoAnalysis;
  comment?: string;
  validated: boolean;
}

export interface Visit {
  id: string;
  missionId: string;
  userId: string;
  visitDate: string;
  photos: Photo[];
  photoCount: number;
  notes?: string;
  reportGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  mission?: any;
}

export interface CreateVisitData {
  missionId: string;
  visitDate: string;
  photos?: Photo[];
  notes?: string;
}

export interface UpdateVisitData {
  visitDate?: string;
  photos?: Photo[];
  notes?: string;
  reportGenerated?: boolean;
}

export const visitService = {
  async getVisits(missionId?: string) {
    const url = missionId ? `/visits?missionId=${missionId}` : '/visits';
    return api.get<Visit[]>(url);
  },

  async getVisit(id: string) {
    return api.get<Visit>(`/visits/${id}`);
  },

  async createVisit(data: CreateVisitData) {
    return api.post<Visit>('/visits', data);
  },

  async updateVisit(id: string, data: UpdateVisitData) {
    return api.put<Visit>(`/visits/${id}`, data);
  },

  async deleteVisit(id: string) {
    return api.delete(`/visits/${id}`);
  },
};
