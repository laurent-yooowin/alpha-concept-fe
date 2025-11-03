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
  async analyzePhoto(imageUrl: string, userComments: string) {
    const data = {
      imageUrl,
      userComments
    }
    return apiRequest('/ai/analyze-photo', { method: "POST", body: JSON.stringify(data) });
  },
};

