import { apiRequest } from '../lib/api';

export interface AIPromptSelection {
  visitId?: string;
  missionType?: string;
  customPromptIds?: string[];
}

export interface AIAnalysis {
  observations: string[];
  recommendations: string[];
  references: string[];
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
  unreadableSections?: string[];
  appliedCustomPrompts?: Array<{ id: string; name: string; content: string }>;
}

const parseArrayField = (val: unknown): string[] => {
  if (val === null || val === undefined || val === '') return [];
  const values = Array.isArray(val) ? val : [val];
  const partitioned: string[] = [];

  values.forEach((item) => {
    const normalized = String(item)
      .replace(/\r/g, '')
      .replace(/[ \t]+(?=[•▪◦]\s*)/g, '\n')
      .replace(/[ \t]+(?=\d{1,2}[.)]\s+[A-ZÀ-Ÿ])/g, '\n')
      .replace(/[ \t]+(?=(?:dangers?|risques?)\s*:)/gi, '\n');

    normalized.split(/\n+/).forEach((rawLine) => {
      const line = rawLine.replace(/^\s*(?:[-*•▪◦]+|\d{1,2}[.)])\s*/, '').trim();
      if (!line) return;
      if (/^(?:danger|dangers|risque|risques)\b/i.test(line) && partitioned.length > 0) {
        partitioned[partitioned.length - 1] += '\n' + line;
      } else {
        partitioned.push(line);
      }
    });
  });

  return partitioned.filter(Boolean);
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
    appliedCustomPrompts: Array.isArray(data.appliedCustomPrompts) ? data.appliedCustomPrompts : [],
  };
};

export const aiService = {
  async analyzePhoto(imageUrl: string, promptSelection: AIPromptSelection = {}): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-photo', {
      method: 'POST',
      body: JSON.stringify({ imageUrl, ...promptSelection }),
    });
    return parseAIResponse(response);
  },

  async analyzePhotoWithDirectives(imageUrl: string, userDirectives: string, previousReport: string, promptSelection: AIPromptSelection = {}): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-photo-directives', {
      method: 'POST',
      body: JSON.stringify({ imageUrl, userDirectives, previousReport, ...promptSelection }),
    });
    return parseAIResponse(response);
  },

  async analyzeDirectives(userDirectives: string, missionContext?: any, previousReport?: string, promptSelection: AIPromptSelection = {}): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-directives', {
      method: 'POST',
      body: JSON.stringify({ userDirectives, missionContext, previousReport, ...promptSelection }),
    });
    return parseAIResponse(response);
  },

  async analyzeBatchPhotos(imageUrls: string[], userDirectives?: string, previousReport?: string, promptSelection: AIPromptSelection = {}): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-batch', {
      method: 'POST',
      body: JSON.stringify({ imageUrls, userDirectives, previousReport, ...promptSelection }),
    });
    return parseAIResponse(response);
  },

  async analyzeBatchEnhanced(imageUrls: string[], previousAnalysis: any, unreadableSections: string[], userDirectives?: string, promptSelection: AIPromptSelection = {}): Promise<AIAnalysis> {
    const response = await apiRequest('/ai/analyze-batch-enhanced', {
      method: 'POST',
      body: JSON.stringify({ imageUrls, previousAnalysis, unreadableSections, userDirectives, ...promptSelection }),
    });
    return parseAIResponse(response);
  },
};
