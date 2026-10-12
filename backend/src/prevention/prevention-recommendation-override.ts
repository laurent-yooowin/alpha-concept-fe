import { createHash } from 'crypto';
import { isPreventionActionType, normalizePreventionActionMetric, PreventionActionMetric, PreventionActionType } from './prevention-action-types';

export type RecommendationOverride = {
  riskLevel: 'faible' | 'moyen' | 'eleve';
  confidence: number;
  actionType: PreventionActionType;
  actionTypeConfidence: number;
  actionTypeVersion: string;
  actionMetric: PreventionActionMetric | null;
};

export function recommendationTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function parseRecommendationOverrides(value: unknown): Record<string, RecommendationOverride> {
  let raw = value;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return {}; } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, RecommendationOverride> = {};
  for (const [hash, candidate] of Object.entries(raw)) {
    if (!/^[0-9a-f]{64}$/.test(hash) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    if (!['faible', 'moyen', 'eleve'].includes(String(item.riskLevel)) ||
      typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 100 ||
      !isPreventionActionType(item.actionType) ||
      typeof item.actionTypeConfidence !== 'number' || !Number.isFinite(item.actionTypeConfidence) ||
      item.actionTypeConfidence < 0 || item.actionTypeConfidence > 100 ||
      typeof item.actionTypeVersion !== 'string' || item.actionTypeVersion.length > 16) continue;
    result[hash] = {
      riskLevel: item.riskLevel as RecommendationOverride['riskLevel'], confidence: item.confidence,
      actionType: item.actionType, actionTypeConfidence: item.actionTypeConfidence,
      actionTypeVersion: item.actionTypeVersion,
      actionMetric: normalizePreventionActionMetric(item.actionMetric),
    } as RecommendationOverride;
  }
  return result;
}
