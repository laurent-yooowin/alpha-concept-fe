import { api, apiRequest } from './api';

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
  customPromptIds?: string[];
  reportGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  mission?: any;
}

export interface CreateVisitData {
  missionId: string;
  visitDate: string;
  /** @deprecated Photos must be persisted via analysisGroups commands. */
  photos?: Photo[];
  customPromptIds?: string[];
  notes?: string;
}

export interface UpdateVisitData {
  visitDate?: string;
  /** @deprecated Photos must be persisted via analysisGroups commands. */
  photos?: Photo[];
  notes?: string;
  customPromptIds?: string[];
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

  async generateReport(visitId: string, options?: { header?: string; footer?: string; notes?: string }) {
    return api.post(`/visits/${visitId}/generate-report`, options || {});
  },

  analysisGroups: {
    bulkEdit(visitId: string, groups: Array<{ groupId: string; observations?: string[]; recommendations?: string[]; references?: string[]; comment?: string }>) {
      return apiRequestPatch(`/visits/${encodeURIComponent(visitId)}/analysis-groups`, { groups });
    },
    create(visitId: string, body: { requestId: string; imageUrls?: string[]; imageReceipts?: string[]; userDirectives?: string; comment?: string; customPromptIds?: string[] }) {
      return api.post(`/visits/${encodeURIComponent(visitId)}/analysis-groups`, body);
    },
    update(visitId: string, groupId: string, body: Record<string, unknown>) {
      return apiRequestPatch(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}`, body);
    },
    attachPhotos(visitId: string, groupId: string, body: { imageUrls: string[]; imageReceipts: string[]; isDetailPhoto?: boolean; isReadabilityPhoto?: boolean; detailContext?: string }) {
      return api.post(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/photos`, body);
    },
    clarify(visitId: string, groupId: string, body: { requestId: string; detailImageUrls: string[]; detailImageReceipts: string[]; userDirectives?: string; customPromptIds?: string[] }) {
      return api.post(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/clarify`, body);
    },
    reanalyze(visitId: string, groupId: string, body: { requestId: string; userDirectives?: string; customPromptIds?: string[] }) {
      return api.post(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/reanalyze`, body);
    },
    reanalyzeAll(visitId: string, body: { requestId: string; userDirectives?: string; customPromptIds?: string[] }) {
      return api.post(`/visits/${encodeURIComponent(visitId)}/analysis-groups/reanalyze-all`, body);
    },
    deletePhoto(visitId: string, groupId: string, photoId: string) {
      return apiRequestPatch(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/photos/${encodeURIComponent(photoId)}`, undefined, 'DELETE');
    },
    delete(visitId: string, groupId: string) {
      return apiRequestPatch(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}`, undefined, 'DELETE');
    },
  },
};

function apiRequestPatch(endpoint: string, body?: unknown, method: 'PATCH' | 'DELETE' = 'PATCH') {
  return apiRequest(endpoint, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
