import { apiRequest } from './api';

export interface AIAnalysis {
  nonConformities: string[];
  recommendations: string[];
  riskLevel: 'faible' | 'moyen' | 'eleve';
  confidence: number;
  photoConformity: boolean;
  photoConformityMessage: string | any;
  references: any;
  appliedCustomPrompts?: Array<{ id: string; name: string; content: string }>;
}

export interface AIPromptSelection {
  visitId?: string;
  missionType?: string;
  customPromptIds?: string[];
}

export const aiService = {
  async analyzePhoto(imageUrl: string, promptSelection: AIPromptSelection = {}) {
    return apiRequest('/ai/analyze-photo', {
      method: 'POST',
      body: JSON.stringify({ imageUrl, ...promptSelection }),
    });
  },

  async analyzePhotoWithDirectives(
    imageUrl: string,
    userDirectives: string,
    previousReport: string,
    promptSelection: AIPromptSelection = {},
  ) {
    return apiRequest('/ai/analyze-photo-directives', {
      method: 'POST',
      body: JSON.stringify({ imageUrl, userDirectives, previousReport, ...promptSelection }),
    });
  },

  async analyzeDirectives(
    userDirectives: string,
    missionContext?: {
      title?: string;
      client?: string;
      address?: string;
      type?: string;
    },
    previousReport?: string,
    promptSelection: AIPromptSelection = {},
  ) {
    return apiRequest('/ai/analyze-directives', {
      method: 'POST',
      body: JSON.stringify({ userDirectives, missionContext, previousReport, ...promptSelection }),
    });
  },

  async analyzeBatchPhotos(
    imageUrls: string[],
    userDirectives?: string,
    previousReport?: string,
    promptSelection: AIPromptSelection = {},
  ) {
    return apiRequest('/ai/analyze-batch', {
      method: 'POST',
      body: JSON.stringify({ imageUrls, userDirectives, previousReport, ...promptSelection }),
    });
  },

  async analyzeBatchEnhanced(
    imageUrls: string[],
    previousAnalysis: any,
    unreadableSections: string[],
    userDirectives?: string,
    promptSelection: AIPromptSelection = {},
  ) {
    return apiRequest('/ai/analyze-batch-enhanced', {
      method: 'POST',
      body: JSON.stringify({
        imageUrls,
        previousAnalysis,
        unreadableSections,
        userDirectives,
        ...promptSelection,
      }),
    });
  },
};
