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

type AnalysisLike = {
  observation?: unknown;
  observations?: unknown;
  recommendation?: unknown;
  recommendations?: unknown;
  references?: unknown;
  riskLevel?: unknown;
  confidence?: unknown;
};

type VisitEntryLike = {
  id?: unknown;
  groupId?: unknown;
  isDirectiveOnly?: unknown;
  analysis?: AnalysisLike | null;
};

export const MAX_PREVENTION_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_ENTRIES = 1_000;
const MAX_SOURCE_GROUPS = 500;
const MAX_FINDINGS = 1_000;
const MAX_ITEMS_PER_FIELD = 100;
const MAX_FINDING_TEXT_LENGTH = 10_000;
const MAX_REFERENCE_LENGTH = 2_000;

export class PreventionSourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreventionSourceValidationError';
  }
}

export function normalizePreventionList(
  value: unknown,
  maxItems = MAX_ITEMS_PER_FIELD,
  maxLength = MAX_FINDING_TEXT_LENGTH,
): string[] {
  if (value === null || value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > maxItems) {
    throw new PreventionSourceValidationError('Too many prevention analysis items');
  }
  const result: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') {
      throw new PreventionSourceValidationError('Prevention analysis items must be strings');
    }
    if (item.length > maxLength) {
      throw new PreventionSourceValidationError('Prevention analysis item is too long');
    }
    const text = String(item)
      .replace(/\r/g, '')
      .replace(/[ \t]+(?=[•▪◦]\s*)/g, '\n')
      .replace(/[ \t]+(?=\d{1,2}[.)]\s+[A-ZÀ-Ÿ])/g, '\n')
      .replace(/[ \t]+(?=(?:dangers?|risques?)\s*:)/gi, '\n');
    for (const rawLine of text.split(/\n+/)) {
      const line = rawLine
        .replace(/^\s*(?:[-*•▪◦]+|\d{1,2}[.)])\s*/, '')
        .replace(/^\[?\s*(?:anomalie|constat|observation|point)\s*(?:\d+|x)?\s*\]?\s*[:.\-–—]?\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!line) continue;
      if (/^(?:danger|dangers|risque|risques)\s*:/i.test(line) && result.length > 0) {
        result[result.length - 1] += `\n${line}`;
      } else {
        result.push(line);
      }
      if (result.length > maxItems) {
        throw new PreventionSourceValidationError('Too many normalized prevention items');
      }
    }
  }
  return result;
}

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

export function canonicalizePreventionSource(input: {
  reportId: string;
  visitId: string;
  missionId: string;
  sourceStatus?: string | null;
  visitDate: Date | string;
  missionType: string;
  entries: VisitEntryLike[] | null | undefined;
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
  for (const [groupId, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const source = entries.find((entry) => entry.analysis) ?? entries[0];
    const analysis = source?.analysis;
    if (!analysis) continue;
    if (typeof analysis !== 'object' || Array.isArray(analysis)) {
      throw new PreventionSourceValidationError('Visit analysis payload is invalid');
    }
    const sourceKind = source.isDirectiveOnly === true
      ? PreventionSourceKind.DIRECTIVE_ONLY
      : PreventionSourceKind.PHOTO_GROUP;
    const references = [
      ...new Set(normalizePreventionList(
        analysis.references,
        MAX_ITEMS_PER_FIELD,
        MAX_REFERENCE_LENGTH,
      )),
    ].sort();
    const level = riskLevel(analysis.riskLevel);
    if (level === null) continue;
    const score = confidence(analysis.confidence);
    const observations = normalizePreventionList(analysis.observation ?? analysis.observations);
    const recommendations = normalizePreventionList(
      analysis.recommendation ?? analysis.recommendations,
    );

    for (const observation of observations) {
      const parts = explicitObservationParts(observation);
      findings.push(buildFinding({
        groupId, sourceKind, findingType: PreventionFindingType.OBSERVATION,
        content: parts.content, danger: parts.danger, risk: parts.risk,
        riskLevel: level, confidence: score, references,
      }));
    }
    for (const recommendation of recommendations) {
      findings.push(buildFinding({
        groupId, sourceKind, findingType: PreventionFindingType.RECOMMENDATION,
        content: recommendation, danger: null, risk: null,
        riskLevel: level, confidence: score, references,
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
