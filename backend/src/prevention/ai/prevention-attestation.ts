import { createHash, createHmac, timingSafeEqual } from 'crypto';

type Candidate = {
  phase: string;
  confidence: number;
  justification: string;
  observations: unknown[];
};

export function preventionInputDigest(imageUrls: string[], directives?: string): string {
  return createHash('sha256').update(JSON.stringify([
    [...new Set(imageUrls.filter((url) => typeof url === 'string' && url.trim()).map((url) => url.trim()))].sort(),
    (directives ?? '').trim(),
  ])).digest('hex');
}

function message(
  expiresAt: number,
  userId: string,
  organizationId: string,
  visitId: string | undefined,
  sourceGroupId: string,
  observationTexts: string[],
  candidate: Candidate,
  inputDigest: string,
): string {
  return JSON.stringify([
    'prevention-attestation-v2', expiresAt, userId, organizationId, visitId ?? null, sourceGroupId, inputDigest,
    observationTexts, candidate.phase, candidate.confidence, candidate.justification,
    candidate.observations,
  ]);
}

export function signPreventionCandidate(
  secret: string,
  userId: string,
  organizationId: string,
  visitId: string | undefined,
  sourceGroupId: string,
  observationTexts: string[],
  candidate: Candidate,
  inputDigest: string,
  now = Date.now(),
): string {
  const expiresAt = now + 60 * 60 * 1000;
  const signature = createHmac('sha256', secret)
    .update(message(expiresAt, userId, organizationId, visitId, sourceGroupId, observationTexts, candidate, inputDigest))
    .digest('hex');
  return `v2.${expiresAt}.${signature}`;
}

export function verifyPreventionCandidate(
  secret: string | undefined,
  proof: unknown,
  userId: string | undefined,
  organizationId: string,
  visitId: string,
  sourceGroupId: string,
  observationTexts: string[],
  candidate: Candidate,
  inputDigest: string,
  now = Date.now(),
): boolean {
  if (!secret || !userId || !sourceGroupId || typeof proof !== 'string') return false;
  const match = /^v2\.(\d{13})\.([0-9a-f]{64})$/.exec(proof);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt < now || expiresAt > now + 60 * 60 * 1000) return false;
  const actual = Buffer.from(match[2], 'hex');
  const expected = createHmac('sha256', secret)
    .update(message(expiresAt, userId, organizationId, visitId, sourceGroupId, observationTexts, candidate, inputDigest))
    .digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
