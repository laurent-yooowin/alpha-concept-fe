import { apiRequest } from '../lib/api';

export interface AIAnalysis {
  observations: string[];
  recommendations: string[];
  references: string[];
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
  unreadableSections?: string[];
}

const parseArrayField = (val: any): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((s: string) => s && s.length > 0);
  return String(val).split(', ').filter((s: string) => s.length > 0);
};

const mapRiskLevel = (level: string): 'low' | 'medium' | 'high' => {
  if (level === 'faible' || level === 'low') return 'low';
  if (level === 'moyen' || level === 'medium') return 'medium';
  return 'high';
};

const parseAIResponse = (data: any): AIAnalysis => {
  const nonConformities = parseArrayField(data.nonConformities);
  const observations = parseArrayField(data.observations);
  const photoConformityMessage = parseArrayField(data.photoConformityMessage);
  const hasNonConformities = nonConformities.length > 0;

  return {
    observations: hasNonConformities ? nonConformities : (photoConformityMessage.length > 0 ? photoConformityMessage : observations),
    recommendations: parseArrayField(data.recommendations),
    references: parseArrayField(data.references),
    riskLevel: mapRiskLevel(data.riskLevel),
    confidence: parseInt(data.confidence || '0'),
    unreadableSections: parseArrayField(data.unreadableSections),
  };
};

export const aiService = {
  async analyzePhoto(imageUrl: string): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-photo', {
      method: 'POST',
      body: JSON.stringify({ imageUrl }),
    });
    return parseAIResponse(response);
  },

  async analyzePhotoWithDirectives(imageUrl: string, userDirectives: string, previousReport: string): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-photo-directives', {
      method: 'POST',
      body: JSON.stringify({ imageUrl, userDirectives, previousReport }),
    });
    return parseAIResponse(response);
  },

  async analyzeDirectives(userDirectives: string, missionContext?: any, previousReport?: string): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-directives', {
      method: 'POST',
      body: JSON.stringify({ userDirectives, missionContext, previousReport }),
    });
    return parseAIResponse(response);
  },

  async analyzeBatchPhotos(imageUrls: string[], userDirectives?: string, previousReport?: string): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-batch', {
      method: 'POST',
      body: JSON.stringify({ imageUrls, userDirectives, previousReport }),
    });
    return parseAIResponse(response);
  },

  async analyzeBatchEnhanced(imageUrls: string[], previousAnalysis: any, unreadableSections: string[], userDirectives?: string): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-batch-enhanced', {
      method: 'POST',
      body: JSON.stringify({ imageUrls, previousAnalysis, unreadableSections, userDirectives }),
    });
    return parseAIResponse(response);
  },
};
