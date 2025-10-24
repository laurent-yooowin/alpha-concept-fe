import { api } from './api';

export interface AIAnalysis {
  observations: string[];
  recommendations: string[];
  riskLevel: 'faible' | 'moyen' | 'eleve';
  confidence: number;
}

export const aiService = {
  async analyzePhoto(imageUrl: string) {
    return api.post<AIAnalysis>('/ai/analyze-photo', { imageUrl });
  },
};
