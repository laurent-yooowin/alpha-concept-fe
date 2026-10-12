import { createHash } from 'crypto';
import { normalizePreventionList } from '../extraction/prevention-text-normalizer';
import { PreventionOnlyInput } from '../ai/prevention-only-ai.service';

export type PreventionGroupEntry = {
  s3Url?: unknown;
  uri?: unknown;
  isDirectiveOnly?: unknown;
  groupId?: unknown;
  id?: unknown;
  userDirectives?: unknown;
  analysis?: Record<string, unknown> | null;
};

export function preventionEntryGroupId(entry: PreventionGroupEntry, index: number): string {
  return typeof entry.groupId === 'string' && entry.groupId ? entry.groupId
    : typeof entry.id === 'string' && entry.id ? entry.id : `entry-${index}`;
}

function normalizeTexts(value: unknown): string[] {
  return normalizePreventionList(value).map((item) => item.slice(0, 2000));
}

export function buildPreventionGroupInput(entries: PreventionGroupEntry[]): {
  sourceKind: 'PHOTO' | 'DIRECTIVE' | 'MIXED'; input: PreventionOnlyInput;
} {
  const hasDirective = entries.some((entry) => entry.isDirectiveOnly === true) ||
    entries.some((entry) => typeof entry.userDirectives === 'string' && entry.userDirectives.trim().length > 0);
  const hasPhoto = entries.some((entry) => entry.isDirectiveOnly !== true);
  const sourceKind = hasPhoto && hasDirective ? 'MIXED' : hasDirective ? 'DIRECTIVE' : 'PHOTO';
  const referenceIndex = entries.findIndex((entry) => Boolean(entry.analysis));
  const referenceAnalysis = referenceIndex >= 0 ? entries[referenceIndex].analysis : undefined;
  const observationTexts = normalizeTexts(referenceAnalysis?.observation ?? referenceAnalysis?.observations);
  const recommendationTexts = normalizeTexts(referenceAnalysis?.recommendation ?? referenceAnalysis?.recommendations);
  const referenceTexts = normalizeTexts(referenceAnalysis?.references);
  const input: PreventionOnlyInput = {
    sourceKind,
    entries: entries.map((entry, index) => ({
      isDirectiveOnly: entry.isDirectiveOnly === true,
      ...(typeof entry.userDirectives === 'string' ? { userDirectives: entry.userDirectives.slice(0, 12000) } : {}),
      ...(index === referenceIndex ? { observationTexts, recommendationTexts, referenceTexts } : {}),
    })),
    directives: [...new Set(entries.map((entry) => typeof entry.userDirectives === 'string' ? entry.userDirectives.trim() : '')
      .filter(Boolean))].join('\n').slice(0, 12000),
  };
  return { sourceKind, input };
}

export function preventionGroupSourceHash(sourceGroupId: string, entries: PreventionGroupEntry[]): string {
  const { input } = buildPreventionGroupInput(entries);
  const analyticalVersion = entries.map((entry, index) => ({
    index,
    observation: entry.analysis?.observation ?? entry.analysis?.observations ?? null,
    recommendation: entry.analysis?.recommendation ?? entry.analysis?.recommendations ?? null,
    references: entry.analysis?.references ?? null,
    s3Url: entry.s3Url ?? null,
    uri: entry.uri ?? null,
    riskLevel: entry.analysis?.riskLevel ?? null,
    confidence: entry.analysis?.confidence ?? null,
    nonConformities: entry.analysis?.nonConformities ?? null,
  }));
  return createHash('sha256').update(JSON.stringify({ sourceGroupId, input, analyticalVersion })).digest('hex');
}
