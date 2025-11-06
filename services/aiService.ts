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
};

