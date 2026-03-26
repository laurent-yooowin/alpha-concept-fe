import { api, apiRequest } from './api';

export interface AIAnalysis {
  nonConformities: string[];
  recommendations: string[];
  riskLevel: 'faible' | 'moyen' | 'eleve';
  confidence: number;
  photoConformity: boolean;
  photoConformityMessage: string | any;
  references: any;
}

export const aiService = {
  async analyzePhoto(imageUrl: string) {
    const data = {
      imageUrl
    }
    return apiRequest('/ai/analyze-photo', { method: "POST", body: JSON.stringify(data) });
  },

  async analyzePhotoWithDirectives(imageUrl: string, userDirectives: string, previousReport: string) {
    const data = {
      imageUrl,
      userDirectives,
      previousReport,
    }
    return apiRequest('/ai/analyze-photo-directives', { method: "POST", body: JSON.stringify(data) });
  },

  async analyzeDirectives(userDirectives: string, missionContext?: {
    title?: string;
    client?: string;
    address?: string;
    type?: string;
  }, previousReport?: string) {
    const data = { userDirectives, missionContext, previousReport };
    return apiRequest('/ai/analyze-directives', { method: "POST", body: JSON.stringify(data) });
  },

  async analyzeBatchPhotos(imageUrls: string[], userDirectives?: string, previousReport?: string) {
    const data = {
      imageUrls,
      userDirectives,
      previousReport,
    }
    return apiRequest('/ai/analyze-batch', { method: "POST", body: JSON.stringify(data) });
  },

  async analyzeBatchEnhanced(imageUrls: string[], previousAnalysis: any, unreadableSections: string[], userDirectives?: string) {
    const data = {
      imageUrls,
      previousAnalysis,
      unreadableSections,
      userDirectives,
    }
    return apiRequest('/ai/analyze-batch-enhanced', { method: "POST", body: JSON.stringify(data) });
  },
};

