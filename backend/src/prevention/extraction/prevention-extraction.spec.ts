import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnrecoverableError } from 'bullmq';
import {
  canonicalizePreventionSource,
  PreventionSourceValidationError,
  preventionSourceHash,
} from './prevention-canonicalizer';
import {
  PreventionFindingType,
  PreventionSourceKind,
} from '../entities/prevention.enums';
import {
  PreventionReportConsumerService,
  validatePreventionReportPayload,
} from '../worker/prevention-report-consumer.service';
import { PREVENTION_UPSERT_JOB } from '../outbox/prevention-outbox.types';

const baseInput = {
  reportId: '10000000-0000-4000-8000-000000000001',
  visitId: '20000000-0000-4000-8000-000000000001',
  missionId: '30000000-0000-4000-8000-000000000001',
  sourceStatus: 'brouillon',
  visitDate: '2026-08-21T09:00:00.000Z',
  missionType: 'CSPS',
};

test('photo and directive-only groups produce the same finding model', () => {
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries: [
      {
        id: 'photo-a', groupId: 'group-photo', uri: 'excluded' as any,
        analysis: {
          observation: ['Garde-corps endommagé\nDanger : chute de hauteur\nRisque : blessure grave'],
          recommendation: 'Remettre le garde-corps en état.',
          references: 'Code du travail R4323-59', riskLevel: 'eleve', confidence: 91,
        },
      },
      {
        id: 'directive-a', groupId: 'group-directive', isDirectiveOnly: true,
        userDirectives: 'excluded' as any,
        analysis: {
          observations: 'Circulation non matérialisée.',
          recommendations: ['Matérialiser le cheminement.'],
          references: ['Code du travail R4534-10'], riskLevel: 'moyen', confidence: '85',
        },
      },
    ] as any,
  });
  assert.equal(source.findings.length, 4);
  const observation = source.findings.find(
    (finding) => finding.sourceGroupId === 'group-photo' &&
      finding.findingType === PreventionFindingType.OBSERVATION,
  );
  assert.equal(observation?.danger, 'chute de hauteur');
  assert.equal(observation?.risk, 'blessure grave');
  assert.equal(observation?.content, 'Garde-corps endommagé');
  assert.ok(source.findings.some((finding) => finding.sourceKind === PreventionSourceKind.DIRECTIVE_ONLY));
});

test('source hash ignores forbidden source fields and input ordering', () => {
  const entries = [
    {
      id: 'a', groupId: 'g', uri: 's3://first', userDirectives: 'secret',
      appliedCustomPrompts: [{ content: 'secret prompt' }],
      analysis: { observation: 'Constat stable', recommendation: 'Action stable', riskLevel: 'faible' },
    },
  ];
  const first = canonicalizePreventionSource({ ...baseInput, entries: entries as any });
  const second = canonicalizePreventionSource({
    ...baseInput,
    entries: [{ ...entries[0], uri: 's3://changed', userDirectives: 'changed', appliedCustomPrompts: [] }] as any,
  });
  assert.equal(preventionSourceHash(first), preventionSourceHash(second));
  assert.doesNotMatch(JSON.stringify(first), /s3:|secret|prompt/i);
});

test('source hash depends on analytical findings only', () => {
  const entries = [{
    id: 'a', groupId: 'g',
    analysis: { observation: 'Constat stable', riskLevel: 'faible', confidence: 90 },
  }];
  const first = canonicalizePreventionSource({ ...baseInput, entries });
  const second = canonicalizePreventionSource({
    ...baseInput,
    reportId: '10000000-0000-4000-8000-000000000002',
    visitId: '20000000-0000-4000-8000-000000000002',
    missionId: '30000000-0000-4000-8000-000000000002',
    sourceStatus: 'valide',
    visitDate: '2026-09-01T09:00:00.000Z',
    missionType: 'AEU',
    entries,
  });
  assert.equal(preventionSourceHash(first), preventionSourceHash(second));
});

test('unknown risks are omitted and invalid confidence values are not coerced', () => {
  for (const invalidRisk of [undefined, 'critique', true, [], {}]) {
    const source = canonicalizePreventionSource({
      ...baseInput,
      entries: [{ groupId: 'g', analysis: { observation: 'Constat', riskLevel: invalidRisk } }],
    });
    assert.equal(source.findings.length, 0);
  }
  for (const invalidConfidence of [true, [], {}, '12x']) {
    const source = canonicalizePreventionSource({
      ...baseInput,
      entries: [{
        groupId: 'g',
        analysis: { observation: 'Constat visible', riskLevel: 'moyen', confidence: invalidConfidence },
      }],
    });
    assert.equal(source.findings[0].confidence, null);
  }
});

test('payload validation rejects extra fields and mismatched event type', () => {
  const payload = {
    eventId: '40000000-0000-4000-8000-000000000001',
    organizationId: '50000000-0000-4000-8000-000000000001',
    reportId: '60000000-0000-4000-8000-000000000001',
    eventType: 'REPORT_UPSERTED',
    aggregateVersion: 'v1',
    occurredAt: '2026-08-21T10:00:00.000Z',
  };
  assert.equal(validatePreventionReportPayload(PREVENTION_UPSERT_JOB, payload).reportId, payload.reportId);
  assert.throws(
    () => validatePreventionReportPayload(PREVENTION_UPSERT_JOB, { ...payload, content: 'forbidden' }),
    UnrecoverableError,
  );
  assert.throws(
    () => validatePreventionReportPayload(PREVENTION_UPSERT_JOB, { ...payload, eventType: 'REPORT_DELETED' }),
    UnrecoverableError,
  );
});

test('source validation bounds entries, identifiers and finding fields', () => {
  assert.throws(
    () => canonicalizePreventionSource({
      ...baseInput,
      entries: Array.from({ length: 1_001 }, (_, index) => ({ id: `entry-${index}` })),
    }),
    PreventionSourceValidationError,
  );
  assert.throws(
    () => canonicalizePreventionSource({
      ...baseInput,
      entries: [{ groupId: 'g'.repeat(101), analysis: { observation: 'Constat' } }],
    }),
    PreventionSourceValidationError,
  );
  assert.throws(
    () => canonicalizePreventionSource({
      ...baseInput,
      entries: [{
        groupId: 'g',
        analysis: { observation: { text: 'Constat' }, riskLevel: 'moyen' },
      }],
    }),
    PreventionSourceValidationError,
  );
  assert.throws(
    () => canonicalizePreventionSource({
      ...baseInput,
      entries: [{
        groupId: 'g',
        analysis: { observation: 'x'.repeat(10_001), riskLevel: 'moyen' },
      }],
    }),
    PreventionSourceValidationError,
  );
});

test('invalid source data becomes an unrecoverable BullMQ failure', async () => {
  const extraction = {
    indexReport: async () => {
      throw new PreventionSourceValidationError('invalid source');
    },
  };
  const consumer = new PreventionReportConsumerService(
    {} as any, extraction as any, {} as any, { handles: () => false } as any,
  );
  const payload = {
    eventId: '40000000-0000-4000-8000-000000000001',
    organizationId: '50000000-0000-4000-8000-000000000001',
    reportId: '60000000-0000-4000-8000-000000000001',
    eventType: 'REPORT_UPSERTED',
    aggregateVersion: 'v1',
    occurredAt: '2026-08-21T10:00:00.000Z',
  };
  await assert.rejects(
    () => (consumer as any).process({ name: PREVENTION_UPSERT_JOB, data: payload }),
    UnrecoverableError,
  );
});
