import { createHash } from 'crypto';
import {
  PreventionFindingType,
  PreventionRiskLevel,
  PreventionSourceKind,
} from '../entities/prevention.enums';
import {
  CanonicalPreventionFinding,
  CanonicalPreventionSource,
} from './prevention-extraction.types';
import {
  isPreventionConstructionPhase,
  PreventionConstructionPhase,
  PreventionPhaseSource,
} from '../prevention-phase';
import { CanonicalPreventionAnalysisGroup } from './prevention-extraction.types';
import { preventionGroupSourceHash, PreventionGroupEntry } from '../worker/prevention-group-source';
import { normalizePreventionList, PreventionSourceValidationError } from './prevention-text-normalizer';
import { isPreventionActionType, normalizePreventionActionMetric, PreventionActionMetric, PreventionActionType } from '../prevention-action-types';
import { parseRecommendationOverrides, recommendationTextHash } from '../prevention-recommendation-override';

export { normalizePreventionList, PreventionSourceValidationError } from './prevention-text-normalizer';

type AnalysisLike = {
  observation?: unknown;
  observations?: unknown;
  recommendation?: unknown;
  recommendations?: unknown;
  references?: unknown;
  riskLevel?: unknown;
  confidence?: unknown;
  phase?: unknown;
  constructionPhase?: unknown;
  phaseChantier?: unknown;
  phaseConfidence?: unknown;
  phaseJustification?: unknown;
  phaseSource?: unknown;
  preventionPhase?: unknown;
  preventionPhaseEffective?: unknown;
  preventionPhaseConfidence?: unknown;
  preventionPhaseJustification?: unknown;
  preventionPhaseSource?: unknown;
  preventionPhaseStatus?: unknown;
  preventionPhaseValidatedBy?: unknown;
  preventionPhaseValidatedAt?: unknown;
  prevention?: unknown;
  modelVersion?: unknown;
};

type VisitEntryLike = {
  id?: unknown;
  groupId?: unknown;
  isDirectiveOnly?: unknown;
  analysis?: AnalysisLike | null;
};

export type PersistedGroupAssessment = {
  processingStatus: string;
  phaseStatus: string;
  proposedPhase: string | null;
  effectivePhase: string | null;
  confidence: number | string | null;
  justification: string | null;
  sourceKind: 'PHOTO' | 'DIRECTIVE' | 'MIXED';
  riskAssessments: unknown;
  recommendationOverrides?: unknown;
  validatedBy: string | null;
  validatedAt: Date | string | null;
  sourceHash: string;
  sourcePayload?: unknown;
};

function assessedTexts(payload: unknown, field: 'observationTexts' | 'recommendationTexts'): string[] | null {
  const parsed = typeof payload === 'string' ? (() => { try { return JSON.parse(payload); } catch { return null; } })() : payload;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { entries?: unknown }).entries)) return null;
  const entry = (parsed as { entries: unknown[] }).entries.find((item) => item && typeof item === 'object' &&
    Array.isArray((item as Record<string, unknown>)[field])) as Record<string, unknown> | undefined;
  return entry ? normalizePreventionList(entry[field]) : [];
}

function matchedRiskIndexes(current: string[], assessed: string[]): Array<number | null> {
  const used = new Set<number>();
  return current.map((text) => {
    const index = assessed.findIndex((candidate, candidateIndex) => candidate === text && !used.has(candidateIndex));
    if (index < 0) return null;
    used.add(index);
    return index;
  });
}

export const MAX_PREVENTION_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_ENTRIES = 1_000;
const MAX_SOURCE_GROUPS = 500;
const MAX_FINDINGS = 1_000;
const MAX_ITEMS_PER_FIELD = 100;
const MAX_REFERENCE_LENGTH = 2_000;
const MAX_PHASE_JUSTIFICATION_LENGTH = 1_000;

function explicitObservationParts(value: string): {
  content: string;
  danger: string | null;
  risk: string | null;
} {
  const contentLines: string[] = [];
  const dangerLines: string[] = [];
  const riskLines: string[] = [];
  for (const line of value.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
    const danger = line.match(/^dangers?\s*:\s*(.+)$/i);
    const risk = line.match(/^risques?\s*:\s*(.+)$/i);
    if (danger) dangerLines.push(danger[1].trim());
    else if (risk) riskLines.push(risk[1].trim());
    else contentLines.push(line);
  }
  return {
    content: contentLines.join('\n') || value,
    danger: dangerLines.length ? dangerLines.join('\n') : null,
    risk: riskLines.length ? riskLines.join('\n') : null,
  };
}

function riskLevel(value: unknown): PreventionRiskLevel | null {
  if (typeof value !== 'string') return null;
  const normalized = String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'faible' || normalized === 'low') return PreventionRiskLevel.LOW;
  if (normalized === 'moyen' || normalized === 'medium') return PreventionRiskLevel.MEDIUM;
  if (normalized === 'eleve' || normalized === 'high') return PreventionRiskLevel.HIGH;
  return null;
}

function observationRisks(value: unknown, expectedCount: number): Array<{ riskLevel: PreventionRiskLevel; confidence: number }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = (value as { observations?: unknown }).observations;
  if (!Array.isArray(entries) || entries.length !== expectedCount) return null;
  const result: Array<{ riskLevel: PreventionRiskLevel; confidence: number }> = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.index !== index) return null;
    const level = riskLevel(entry.riskLevel);
    const itemConfidence = confidence(entry.confidence);
    if (!level || itemConfidence === null || itemConfidence < 0 || itemConfidence > 100) return null;
    result.push({ riskLevel: level, confidence: itemConfidence });
  }
  return result;
}

function confidence(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function phaseSource(value: unknown): PreventionPhaseSource | null {
  if (value === 'PHOTO' || value === 'DIRECTIVE' || value === 'MIXED') return value;
  return null;
}

function phaseMetadata(analysis: AnalysisLike): {
  proposedPhase: PreventionConstructionPhase;
  effectivePhase: PreventionConstructionPhase;
  status: 'PROPOSED' | 'VALIDATED';
  confidence: number;
  justification: string;
  source: PreventionPhaseSource;
  modelVersion: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
} | null {
  const value = analysis.preventionPhase ?? analysis.constructionPhase ?? analysis.phaseChantier ?? analysis.phase;
  if (value === undefined || value === null || value === '') return null;
  if (!isPreventionConstructionPhase(value)) {
    throw new PreventionSourceValidationError('Prevention construction phase is invalid');
  }
  const parsedConfidence = confidence(
    analysis.preventionPhaseConfidence ?? analysis.phaseConfidence ?? analysis.confidence,
  );
  const rawJustification = analysis.preventionPhaseJustification ?? analysis.phaseJustification;
  const justification = typeof rawJustification === 'string'
    ? rawJustification.replace(/\s+/g, ' ').trim().slice(0, MAX_PHASE_JUSTIFICATION_LENGTH)
    : '';
  if (parsedConfidence === null) {
    throw new PreventionSourceValidationError('Prevention construction phase confidence is invalid');
  }
  if (!justification) {
    throw new PreventionSourceValidationError('Prevention construction phase justification is required');
  }
  const rawSource = analysis.preventionPhaseSource ?? analysis.phaseSource;
  if (rawSource !== undefined && phaseSource(rawSource) === null) {
    throw new PreventionSourceValidationError('Prevention construction phase source is invalid');
  }
  const status = analysis.preventionPhaseStatus ?? 'PROPOSED';
  if (status !== 'PROPOSED' && status !== 'VALIDATED') {
    throw new PreventionSourceValidationError('Prevention construction phase status is invalid');
  }
  const rawEffectivePhase = analysis.preventionPhaseEffective ?? value;
  if (!isPreventionConstructionPhase(rawEffectivePhase)) {
    throw new PreventionSourceValidationError('Prevention effective construction phase is invalid');
  }
  const validatedBy = typeof analysis.preventionPhaseValidatedBy === 'string'
    ? analysis.preventionPhaseValidatedBy.trim().slice(0, 36)
    : null;
  const validatedAt = analysis.preventionPhaseValidatedAt instanceof Date
    ? new Date(analysis.preventionPhaseValidatedAt.getTime())
    : typeof analysis.preventionPhaseValidatedAt === 'string'
      ? new Date(analysis.preventionPhaseValidatedAt)
      : null;
  if (status === 'VALIDATED' && (!validatedBy || !validatedAt || Number.isNaN(validatedAt.getTime()))) {
    throw new PreventionSourceValidationError('Validated prevention construction phase audit is invalid');
  }
  return {
    proposedPhase: value,
    effectivePhase: rawEffectivePhase,
    status,
    confidence: parsedConfidence,
    justification,
    source: phaseSource(rawSource) ?? 'PHOTO',
    modelVersion: typeof analysis.modelVersion === 'string' ? analysis.modelVersion.slice(0, 100) : null,
    validatedBy: status === 'VALIDATED' ? validatedBy : null,
    validatedAt: status === 'VALIDATED' ? validatedAt : null,
  };
}

export function canonicalizePreventionSource(input: {
  reportId: string;
  visitId: string;
  missionId: string;
  sourceStatus?: string | null;
  visitDate: Date | string;
  missionType: string;
  entries: VisitEntryLike[] | null | undefined;
  assessments?: Record<string, PersistedGroupAssessment>;
}): CanonicalPreventionSource {
  if (input.entries !== null && input.entries !== undefined && !Array.isArray(input.entries)) {
    throw new PreventionSourceValidationError('Visit analysis source must be an array');
  }
  if ((input.entries?.length ?? 0) > MAX_SOURCE_ENTRIES) {
    throw new PreventionSourceValidationError('Visit analysis source has too many entries');
  }
  const groups = new Map<string, VisitEntryLike[]>();
  for (const [index, entry] of (input.entries ?? []).entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new PreventionSourceValidationError('Visit analysis entry is invalid');
    }
    const fallback = typeof entry.id === 'string' && entry.id ? entry.id : `entry-${index}`;
    const groupId = typeof entry.groupId === 'string' && entry.groupId ? entry.groupId : fallback;
    if (groupId.length > 100) {
      throw new PreventionSourceValidationError('Visit analysis group identifier is too long');
    }
    const group = groups.get(groupId) ?? [];
    group.push(entry);
    groups.set(groupId, group);
    if (groups.size > MAX_SOURCE_GROUPS) {
      throw new PreventionSourceValidationError('Visit analysis source has too many groups');
    }
  }

  const findings: CanonicalPreventionFinding[] = [];
  const analysisGroups: CanonicalPreventionAnalysisGroup[] = [];
  for (const [groupId, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const source = entries.find((entry) => entry.analysis) ?? entries[0];
    const analysis = source?.analysis;
    if (!analysis) continue;
    if (typeof analysis !== 'object' || Array.isArray(analysis)) {
      throw new PreventionSourceValidationError('Visit analysis payload is invalid');
    }
    // A newly staged group must not be materialized from the legacy SPS risk
    // while its independent Prevention assessment is still pending or failed.
    // Historical groups without a processing status retain legacy behavior.
    const assessment = input.assessments?.[groupId];
    if (assessment && assessment.processingStatus !== 'READY') continue;
    const processing = analysis.prevention && typeof analysis.prevention === 'object' && !Array.isArray(analysis.prevention)
      ? (analysis.prevention as { processingStatus?: unknown }).processingStatus : undefined;
    if (!assessment && processing && processing !== 'READY') continue;
    const sourceKind = source.isDirectiveOnly === true
      ? PreventionSourceKind.DIRECTIVE_ONLY
      : PreventionSourceKind.PHOTO_GROUP;
    const sourceKinds = new Set(entries.map((entry) => entry.isDirectiveOnly === true ? 'DIRECTIVE' : 'PHOTO'));
    const persistedGroupSource: PreventionPhaseSource = sourceKinds.size > 1
      ? 'MIXED'
      : sourceKinds.has('DIRECTIVE') ? 'DIRECTIVE' : 'PHOTO';
    // A photo group carrying meaningful directives has no synthetic directive
    // entry. Its durable READY assessment is therefore the authoritative
    // source classification after the independent Prevention analysis.
    const groupSource: PreventionPhaseSource = assessment?.sourceKind ?? persistedGroupSource;
    const phaseEntries = assessment ? [{
      preventionPhase: assessment.proposedPhase,
      preventionPhaseEffective: assessment.effectivePhase,
      preventionPhaseConfidence: assessment.confidence,
      preventionPhaseJustification: assessment.justification,
      preventionPhaseSource: assessment.sourceKind,
      preventionPhaseStatus: assessment.phaseStatus,
      preventionPhaseValidatedBy: assessment.validatedBy,
      preventionPhaseValidatedAt: assessment.validatedAt,
    }] : entries.map((entry) => entry.analysis);
    const candidates = phaseEntries
      .map((value) => value ? phaseMetadata(value) : null)
      .filter((candidate): candidate is NonNullable<ReturnType<typeof phaseMetadata>> => candidate !== null)
      .sort((left, right) => Number(right.status === 'VALIDATED') - Number(left.status === 'VALIDATED') ||
        right.confidence - left.confidence || left.proposedPhase.localeCompare(right.proposedPhase));
    const selectedPhase = candidates[0];
    if (selectedPhase) {
      analysisGroups.push({
        sourceGroupId: groupId,
        sourceKind: groupSource,
        proposedPhase: selectedPhase.proposedPhase,
        effectivePhase: selectedPhase.effectivePhase,
        status: selectedPhase.status,
        confidence: selectedPhase.confidence,
        justification: selectedPhase.justification,
        source: selectedPhase.source === 'PHOTO' && groupSource !== 'PHOTO' ? groupSource : selectedPhase.source,
        modelVersion: selectedPhase.modelVersion,
        validatedBy: selectedPhase.validatedBy,
        validatedAt: selectedPhase.validatedAt,
        sourceHash: stableHash(JSON.stringify({
          groupId, sourceKind: groupSource, phase: selectedPhase.proposedPhase,
          confidence: selectedPhase.confidence, justification: selectedPhase.justification,
          source: selectedPhase.source, modelVersion: selectedPhase.modelVersion,
        })),
      });
    }
    const references = [
      ...new Set(normalizePreventionList(
        analysis.references,
        MAX_ITEMS_PER_FIELD,
        MAX_REFERENCE_LENGTH,
      )),
    ].sort();
    const level = riskLevel(analysis.riskLevel);
    if (!assessment && level === null) continue;
    const score = confidence(analysis.confidence);
    const observations = normalizePreventionList(analysis.observation ?? analysis.observations);
    const recommendations = normalizePreventionList(
      analysis.recommendation ?? analysis.recommendations,
    );

    const rawRisks = assessment?.riskAssessments;
    const persistedRisks = typeof rawRisks === 'string' ? (() => {
      try { return JSON.parse(rawRisks); } catch { return null; }
    })() : rawRisks;
    const sourceStillMatches = assessment && preventionGroupSourceHash(groupId, entries as PreventionGroupEntry[]) === assessment.sourceHash;
    const assessedObservations = assessment ? assessedTexts(assessment.sourcePayload, 'observationTexts') ??
      (sourceStillMatches ? observations : []) : [];
    const assessedRecommendations = assessment ? assessedTexts(assessment.sourcePayload, 'recommendationTexts') ??
      (sourceStillMatches ? recommendations : []) : [];
    const preventionRisks = assessment
      ? observationRisks(persistedRisks, assessedObservations.length)
      : observationRisks(analysis.prevention, observations.length);
    const recommendationRisks = assessment ? observationRisks({ observations: (persistedRisks as { recommendations?: unknown } | null)?.recommendations }, assessedRecommendations.length) : null;
    if (assessment && (!preventionRisks || !recommendationRisks)) continue;
    const observationRiskIndexes = assessment ? matchedRiskIndexes(observations, assessedObservations) : [];
    const recommendationRiskIndexes = assessment ? matchedRiskIndexes(recommendations, assessedRecommendations) : [];
    const persistedRecommendations = assessment && persistedRisks && typeof persistedRisks === 'object' &&
      Array.isArray((persistedRisks as { recommendations?: unknown }).recommendations)
      ? (persistedRisks as { recommendations: Array<Record<string, unknown>> }).recommendations : [];
    const recommendationOverrides = assessment ? parseRecommendationOverrides(assessment.recommendationOverrides) : {};
    const recommendationRisk = !assessment && preventionRisks?.length
      ? preventionRisks.reduce((highest, item) => item.riskLevel === PreventionRiskLevel.HIGH ||
          (item.riskLevel === PreventionRiskLevel.MEDIUM && highest === PreventionRiskLevel.LOW)
          ? item.riskLevel : highest, PreventionRiskLevel.LOW)
      : level;
    for (const [index, observation] of observations.entries()) {
      const riskIndex = assessment ? observationRiskIndexes[index] : index;
      if (assessment && riskIndex === null) continue;
      const parts = explicitObservationParts(observation);
      findings.push(buildFinding({
        groupId, sourceKind, findingType: PreventionFindingType.OBSERVATION,
        content: parts.content, danger: parts.danger, risk: parts.risk,
        riskLevel: assessment ? preventionRisks![riskIndex!].riskLevel : preventionRisks?.[index]?.riskLevel ?? level!,
        confidence: preventionRisks?.[riskIndex!]?.confidence ?? score, references,
      }));
    }
    for (const [index, recommendation] of recommendations.entries()) {
      const riskIndex = assessment ? recommendationRiskIndexes[index] : index;
      const override = assessment ? recommendationOverrides[recommendationTextHash(recommendation)] : null;
      if (assessment && riskIndex === null && !override) continue;
      const typed = override ?? persistedRecommendations[riskIndex!];
      const actionType = typed && isPreventionActionType(typed.actionType) ? typed.actionType : null;
      const actionTypeConfidence = typed && typeof typed.actionTypeConfidence === 'number' &&
        Number.isFinite(typed.actionTypeConfidence) && typed.actionTypeConfidence >= 0 && typed.actionTypeConfidence <= 100
        ? typed.actionTypeConfidence : null;
      const actionTypeVersion = typed && typeof typed.actionTypeVersion === 'string' && typed.actionTypeVersion.length <= 16
        ? typed.actionTypeVersion : null;
      const actionMetric = typed ? normalizePreventionActionMetric(typed.actionMetric) : null;
      findings.push(buildFinding({
        groupId, sourceKind, findingType: PreventionFindingType.RECOMMENDATION,
        content: recommendation, danger: null, risk: null,
        riskLevel: override ? riskLevel(override.riskLevel)! : assessment ? recommendationRisks![riskIndex!].riskLevel : recommendationRisk!,
        confidence: override ? override.confidence : recommendationRisks?.[riskIndex!]?.confidence ?? score, references,
        actionMetric,
        actionType, actionTypeConfidence, actionTypeVersion,
      }));
    }
    if (findings.length > MAX_FINDINGS) {
      throw new PreventionSourceValidationError('Visit analysis source has too many findings');
    }
  }

  findings.sort((a, b) =>
    `${a.sourceGroupId}|${a.findingType}|${a.normalizedKey}`.localeCompare(
      `${b.sourceGroupId}|${b.findingType}|${b.normalizedKey}`,
    ),
  );
  const date = new Date(input.visitDate);
  if (Number.isNaN(date.getTime())) throw new Error('Visit date is invalid');
  const uniqueFindings = [
    ...new Map(
      findings.map((finding) => [
        `${finding.findingType}:${finding.normalizedKey}`,
        finding,
      ]),
    ).values(),
  ];
  return {
    reportId: input.reportId,
    visitId: input.visitId,
    missionId: input.missionId,
    sourceStatus: input.sourceStatus ?? null,
    businessDate: date.toISOString().slice(0, 10),
    missionType: String(input.missionType),
    findings: uniqueFindings,
    analysisGroups,
  };
}

function buildFinding(input: {
  groupId: string;
  sourceKind: PreventionSourceKind;
  findingType: PreventionFindingType;
  content: string;
  danger: string | null;
  risk: string | null;
  riskLevel: PreventionRiskLevel;
  confidence: number | null;
  references: string[];
  actionType?: PreventionActionType | null;
  actionTypeConfidence?: number | null;
  actionTypeVersion?: string | null;
  actionMetric?: PreventionActionMetric | null;
}): CanonicalPreventionFinding {
  const canonicalText = input.content.toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim();
  return {
    sourceGroupId: input.groupId,
    sourceKind: input.sourceKind,
    findingType: input.findingType,
    content: input.content,
    danger: input.danger,
    risk: input.risk,
    riskLevel: input.riskLevel,
    confidence: input.confidence,
    actionType: input.actionType ?? null,
    actionTypeConfidence: input.actionTypeConfidence ?? null,
    actionTypeVersion: input.actionTypeVersion ?? null,
    actionMetric: input.actionMetric ?? null,
    regulatoryReferences: [...input.references],
    normalizedKey: stableHash(
      `${input.sourceKind}|${input.groupId}|${input.findingType}|${canonicalText}`,
    ),
    patternKey: stableHash(`${input.findingType}|${canonicalText}`),
  };
}

export function preventionSourceHash(source: CanonicalPreventionSource): string {
  return stableHash(JSON.stringify(source.findings));
}
