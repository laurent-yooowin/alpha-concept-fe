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
import {
  classifyPreventionCategory,
  classifyPreventionFinding,
  PREVENTION_CATEGORY_CATALOG,
} from './prevention-category-classifier';
import { PreventionExtractionService } from './prevention-extraction.service';
import { preventionGroupSourceHash } from '../worker/prevention-group-source';
import { recommendationTextHash } from '../prevention-recommendation-override';

const baseInput = {
  reportId: '10000000-0000-4000-8000-000000000001',
  visitId: '20000000-0000-4000-8000-000000000001',
  missionId: '30000000-0000-4000-8000-000000000001',
  sourceStatus: 'brouillon',
  visitDate: '2026-08-21T09:00:00.000Z',
  missionType: 'CSPS',
};

test('approved RTE categories are deterministic and leave unmatched findings unclassified', () => {
  assert.deepEqual(
    PREVENTION_CATEGORY_CATALOG.map(({ code, label }) => ({ code, label })),
    [
      { code: 'Hauteur', label: 'Travaux en hauteur' },
      { code: 'Circulation', label: 'Circulation & Accès' },
      { code: 'EPI', label: 'EPI & Équipements' },
      { code: 'Éclairage', label: 'Éclairage' },
      { code: 'Levage', label: 'Levage & Manutention' },
      { code: 'Organisation', label: 'Organisation & Stockage' },
      { code: 'Incendie', label: 'Incendie' },
      { code: 'Admin', label: 'Admin.' },
      { code: 'Électrique', label: 'Électrique' },
    ],
  );
  assert.equal(classifyPreventionCategory('Garde-corps absent en toiture'), 'Hauteur');
  assert.equal(classifyPreventionCategory('Intervention sur une plateforme élévatrice'), 'Hauteur');
  assert.equal(classifyPreventionCategory('Protection des sols sur une plateforme stabilisée avec traitement des eaux boueuses'), null);
  assert.equal(classifyPreventionCategory('Flux piétons et circulation des engins'), 'Circulation');
  assert.equal(classifyPreventionCategory('Casque et gants non portés'), 'EPI');
  assert.equal(classifyPreventionCategory('Éclairage insuffisant dans la zone sombre'), 'Éclairage');
  assert.equal(classifyPreventionCategory('Charge suspendue pendant le levage'), 'Levage');
  assert.equal(classifyPreventionCategory('Stockage diffus et défaut de rangement'), 'Organisation');
  assert.equal(classifyPreventionCategory('Extincteur absent près de la base vie'), 'Incendie');
  assert.equal(classifyPreventionCategory('Organiser le tri et l’évacuation des déchets'), 'Organisation');
  assert.equal(classifyPreventionCategory('Prévoir un plan d’évacuation des personnes en cas d’incendie'), 'Incendie');
  assert.equal(classifyPreventionCategory('Attestation de conformité expirée'), 'Admin');
  assert.equal(classifyPreventionCategory('Habilitation électrique manquante'), 'Admin');
  assert.equal(classifyPreventionCategory('Armoire électrique ouverte avec câble dénudé'), 'Électrique');
  assert.equal(classifyPreventionCategory('Installation électrique non conforme avec câble dénudé'), 'Électrique');
  assert.equal(classifyPreventionCategory('Constat sans vocabulaire catégoriel'), null);
});

test('each finding is classified from its own evidence, not from another finding in the same group', () => {
  const findings = [
    {
      sourceGroupId: 'group-a',
      content: 'Une trémie ouverte expose les travailleurs à une chute de hauteur.',
      danger: null,
      risk: 'Chute dans la trémie.',
    },
    {
      sourceGroupId: 'group-a',
      content: 'Plusieurs contenants type IBC et bidons sont visibles en pied de chantier, posés directement sur le sol nu, sans dispositif de rétention clairement identifiable ni zone dédiée stabilisée.',
      danger: 'En cas de fuite, les liquides se déversent sur les terres nues.',
      risk: 'Pollution des sols et entraînement des polluants par les eaux de ruissellement.',
    },
    {
      sourceGroupId: 'group-a',
      content: 'Constat sans vocabulaire catégoriel.',
      danger: null,
      risk: null,
    },
  ];
  assert.deepEqual(findings.map(classifyPreventionFinding), ['Hauteur', 'Organisation', null]);
});

test('phase metadata is canonicalized per analysis group without entering finding text', () => {
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries: [
      { id: 'photo-a', groupId: 'g-electric', analysis: {
        observation: 'Armoire électrique ouverte', riskLevel: 'eleve', confidence: 80,
        preventionPhase: 'INSTALLATION_ELECTRIQUE', preventionPhaseConfidence: 92,
        preventionPhaseJustification: 'Tableau et câbles visibles', preventionPhaseSource: 'PHOTO', modelVersion: 'rte-1',
      } },
      { id: 'directive-a', groupId: 'g-finishes', isDirectiveOnly: true, analysis: {
        observation: 'Peinture des façades', riskLevel: 'moyen', confidence: 70,
        constructionPhase: 'FINITIONS_EXTERIEURES', phaseConfidence: 74,
        phaseJustification: 'Directive de finition extérieure', phaseSource: 'DIRECTIVE',
      } },
    ] as any,
  });
  assert.deepEqual(source.analysisGroups.map((group) => group.proposedPhase), [
    'INSTALLATION_ELECTRIQUE', 'FINITIONS_EXTERIEURES',
  ]);
  assert.doesNotMatch(source.findings[0].content, /INSTALLATION_ELECTRIQUE/);
  assert.equal(preventionSourceHash(source), preventionSourceHash({ ...source, analysisGroups: [] }));
});

test('a human validated phase remains distinct from the AI proposal', () => {
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries: [{ id: 'photo-a', groupId: 'g-a', analysis: {
      observation: 'Câbles et tableaux en cours de pose', riskLevel: 'moyen', confidence: 80,
      preventionPhase: 'SECOND_OEUVRE', preventionPhaseEffective: 'INSTALLATION_ELECTRIQUE',
      preventionPhaseConfidence: 65, preventionPhaseJustification: 'Équipements techniques visibles',
      preventionPhaseSource: 'PHOTO', preventionPhaseStatus: 'VALIDATED',
      preventionPhaseValidatedBy: '10000000-0000-4000-8000-000000000009',
      preventionPhaseValidatedAt: '2026-09-24T12:00:00.000Z',
    } }] as any,
  });
  assert.equal(source.analysisGroups[0].proposedPhase, 'SECOND_OEUVRE');
  assert.equal(source.analysisGroups[0].effectivePhase, 'INSTALLATION_ELECTRIQUE');
  assert.equal(source.analysisGroups[0].status, 'VALIDATED');
});

test('Prevention observation risk is independent of the SPS group risk', () => {
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries: [{ id: 'photo-a', groupId: 'g-a', analysis: {
      observation: ['Échafaudage incomplet', 'Stockage ordonné'],
      riskLevel: 'moyen', confidence: 80,
      prevention: {
        phase: 'GROS_OEUVRE', confidence: 80, justification: 'Structure en cours',
        observations: [
          { index: 0, riskLevel: 'eleve', confidence: 90 },
          { index: 1, riskLevel: 'faible', confidence: 75 },
        ],
      },
    } }] as any,
  });
  assert.equal(source.findings.find((finding) => finding.content === 'Échafaudage incomplet')?.riskLevel, 'eleve');
  assert.equal(source.findings.find((finding) => finding.content === 'Stockage ordonné')?.riskLevel, 'faible');
});

test('a READY Prevention assessment supplies recommendation risk without inheriting SPS risk', () => {
  const entries = [{ id: 'photo-a', groupId: 'g-a', analysis: {
    observation: [], recommendation: ['Sécuriser le tableau'], references: [], riskLevel: 'faible', confidence: 80,
  } }];
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries,
    assessments: { 'g-a': {
      processingStatus: 'READY', phaseStatus: 'PROPOSED', proposedPhase: 'INSTALLATION_ELECTRIQUE',
      effectivePhase: 'INSTALLATION_ELECTRIQUE', confidence: 87, justification: 'Tableau visible',
      sourceKind: 'PHOTO', riskAssessments: { observations: [],
        recommendations: [{ index: 0, riskLevel: 'eleve', confidence: 91 }] },
      validatedBy: null, validatedAt: null, sourceHash: preventionGroupSourceHash('g-a', entries),
    } },
  });
  assert.equal(source.findings.length, 1);
  assert.equal(source.findings[0].riskLevel, 'eleve');
  assert.equal(source.findings[0].confidence, 91);
});

test('a READY mixed assessment preserves its source kind without a synthetic directive entry', () => {
  const entries = [{ id: 'photo-a', groupId: 'g-a', userDirectives: 'Contrôler les protections', analysis: {
    observation: ['Garde-corps incomplet'], recommendation: ['Compléter le garde-corps'], references: [],
    riskLevel: 'eleve', confidence: 82,
  } }];
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries,
    assessments: { 'g-a': {
      processingStatus: 'READY', phaseStatus: 'PROPOSED', proposedPhase: 'GROS_OEUVRE',
      effectivePhase: 'GROS_OEUVRE', confidence: 79, justification: 'Structure visible',
      sourceKind: 'MIXED', riskAssessments: {
        observations: [{ index: 0, riskLevel: 'eleve', confidence: 88 }],
        recommendations: [{ index: 0, riskLevel: 'moyen', confidence: 77 }],
      },
      validatedBy: null, validatedAt: null, sourceHash: preventionGroupSourceHash('g-a', entries),
    } },
  });

  assert.equal(source.analysisGroups[0].sourceKind, 'MIXED');
  assert.equal(source.analysisGroups[0].source, 'MIXED');
});

test('manual text edits retain the prior phase but never inherit a stale Prevention risk', () => {
  const entries = [{ id: 'photo-a', groupId: 'g-a', analysis: {
    observation: ['Constat inchangé', 'Constat corrigé à la main'],
    recommendation: ['Action inchangée'], references: [], riskLevel: 'faible', confidence: 80,
  } }];
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries,
    assessments: { 'g-a': {
      processingStatus: 'READY', phaseStatus: 'PROPOSED', proposedPhase: 'INSTALLATION_ELECTRIQUE',
      effectivePhase: 'INSTALLATION_ELECTRIQUE', confidence: 87, justification: 'Tableau visible',
      sourceKind: 'PHOTO', riskAssessments: {
        observations: [{ index: 0, riskLevel: 'eleve', confidence: 91 },
          { index: 1, riskLevel: 'moyen', confidence: 82 }],
        recommendations: [{ index: 0, riskLevel: 'moyen', confidence: 78 }],
      },
      sourcePayload: { entries: [{ observationTexts: ['Constat inchangé', 'Ancien constat'],
        recommendationTexts: ['Action inchangée'] }] },
      validatedBy: null, validatedAt: null, sourceHash: preventionGroupSourceHash('g-a', [{
        id: 'photo-a', groupId: 'g-a', analysis: { observation: ['Constat inchangé', 'Ancien constat'],
          recommendation: ['Action inchangée'], riskLevel: 'faible', confidence: 80 },
      }]),
    } },
  });
  assert.equal(source.analysisGroups[0].effectivePhase, 'INSTALLATION_ELECTRIQUE');
  assert.deepEqual(source.findings.map((finding) => finding.content).sort(), ['Action inchangée', 'inchangé']);
  assert.equal(source.findings.find((finding) => finding.content === 'inchangé')?.riskLevel, 'eleve');
});

test('recommendation action type follows only its exact assessed text', () => {
  const assessed = [{ id: 'photo-a', groupId: 'g-a', analysis: {
    observation: [], recommendation: ['Organiser le tri des déchets'], riskLevel: 'moyen', confidence: 80,
  } }];
  const assessment = {
    processingStatus: 'READY', phaseStatus: 'PROPOSED', proposedPhase: 'GROS_OEUVRE',
    effectivePhase: 'GROS_OEUVRE', confidence: 80, justification: 'Travaux de chantier', sourceKind: 'PHOTO' as const,
    riskAssessments: { observations: [], recommendations: [{ index: 0, riskLevel: 'moyen', confidence: 85,
      actionType: 'waste-management', actionTypeConfidence: 91, actionTypeVersion: 'v1',
      actionMetric: { quantity: '2', unit: 'PERSONNE', basis: 'Deux opérateurs explicitement concernés', confidence: 78 } }] },
    sourcePayload: { entries: [{ observationTexts: [], recommendationTexts: ['Organiser le tri des déchets'] }] },
    validatedBy: null, validatedAt: null, sourceHash: preventionGroupSourceHash('g-a', assessed),
  };
  const original = canonicalizePreventionSource({ ...baseInput, entries: assessed, assessments: { 'g-a': assessment } });
  assert.equal(original.findings[0].actionType, 'waste-management');
  assert.equal(original.findings[0].actionTypeConfidence, 91);
  assert.deepEqual(original.findings[0].actionMetric, { quantity: '2', unit: 'PERSONNE', basis: 'Deux opérateurs explicitement concernés', confidence: 78 });
  const humanCorrected = canonicalizePreventionSource({ ...baseInput, entries: assessed, assessments: { 'g-a': {
    ...assessment, recommendationOverrides: {
      [recommendationTextHash('Organiser le tri des déchets')]: {
        riskLevel: 'eleve', confidence: 99, actionType: 'fire-protection',
        actionTypeConfidence: 99, actionTypeVersion: 'v1',
      },
    },
  } } });
  assert.equal(humanCorrected.findings[0].riskLevel, 'eleve');
  assert.equal(humanCorrected.findings[0].actionType, 'fire-protection');
  const edited = canonicalizePreventionSource({ ...baseInput, entries: [{ ...assessed[0], analysis: {
    ...assessed[0].analysis, recommendation: ['Évacuer les personnes en cas d’incendie'],
  } }], assessments: { 'g-a': assessment } });
  assert.equal(edited.findings.length, 0);
  const withTargetedAssessment = canonicalizePreventionSource({ ...baseInput, entries: [{ ...assessed[0], analysis: {
    ...assessed[0].analysis, recommendation: ['Évacuer les personnes en cas d’incendie'],
  } }], assessments: { 'g-a': { ...assessment, recommendationOverrides: {
    [recommendationTextHash('Évacuer les personnes en cas d’incendie')]: {
      riskLevel: 'eleve', confidence: 87, actionType: 'fire-protection',
      actionTypeConfidence: 94, actionTypeVersion: 'v1',
    },
  } } } });
  assert.equal(withTargetedAssessment.analysisGroups[0].effectivePhase, 'GROS_OEUVRE');
  assert.equal(withTargetedAssessment.findings[0].riskLevel, 'eleve');
  assert.equal(withTargetedAssessment.findings[0].actionType, 'fire-protection');
});

test('invalid indicative recommendation metrics are omitted', () => {
  const entries = [{ id: 'photo-a', groupId: 'g-a', analysis: {
    observation: [], recommendation: ['Installer une protection'], riskLevel: 'moyen', confidence: 80,
  } }];
  const source = canonicalizePreventionSource({ ...baseInput, entries, assessments: { 'g-a': {
    processingStatus: 'READY', phaseStatus: 'PROPOSED', proposedPhase: 'GROS_OEUVRE', effectivePhase: 'GROS_OEUVRE',
    confidence: 80, justification: 'Travaux', sourceKind: 'PHOTO',
    riskAssessments: { observations: [], recommendations: [{ index: 0, riskLevel: 'moyen', confidence: 80,
      actionType: 'specific-action', actionTypeConfidence: 70,
      actionMetric: { quantity: '0', unit: 'M', basis: 'non mesurable', confidence: 50 } }] },
    sourcePayload: { entries: [{ observationTexts: [], recommendationTexts: ['Installer une protection'] }] },
    validatedBy: null, validatedAt: null, sourceHash: preventionGroupSourceHash('g-a', entries),
  } } });
  assert.equal(source.findings[0].actionMetric, null);
});

test('a pending Prevention group does not expose the SPS risk as a Prevention finding', () => {
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries: [{ id: 'photo-a', groupId: 'g-a', analysis: {
      observation: 'Échafaudage incomplet', riskLevel: 'moyen', confidence: 80,
      prevention: { processingStatus: 'PENDING' },
    } }] as any,
  });
  assert.equal(source.findings.length, 0);
  assert.equal(source.analysisGroups.length, 0);
});

test('a READY assessment does not hide historical groups without a Prevention job', () => {
  const assessedEntries = [{ id: 'photo-a', groupId: 'g-assessed', analysis: {
    observation: ['Garde-corps incomplet'], recommendation: [], references: [], riskLevel: 'eleve', confidence: 82,
  } }];
  const source = canonicalizePreventionSource({
    ...baseInput,
    entries: [
      ...assessedEntries,
      { id: 'photo-b', groupId: 'g-historical', analysis: {
        observation: ['Stockage à réorganiser'], recommendation: [], references: [], riskLevel: 'moyen', confidence: 70,
      } },
    ],
    assessments: { 'g-assessed': {
      processingStatus: 'READY', phaseStatus: 'PROPOSED', proposedPhase: 'GROS_OEUVRE',
      effectivePhase: 'GROS_OEUVRE', confidence: 79, justification: 'Structure visible', sourceKind: 'PHOTO',
      riskAssessments: { observations: [{ index: 0, riskLevel: 'eleve', confidence: 88 }], recommendations: [] },
      validatedBy: null, validatedAt: null,
      sourceHash: preventionGroupSourceHash('g-assessed', assessedEntries),
    } },
  });

  assert.equal(source.findings.some((finding) => finding.sourceGroupId === 'g-assessed'), true);
  assert.equal(source.findings.some((finding) => finding.sourceGroupId === 'g-historical'), true);
});

test('extraction never overwrites a phase already validated by a human', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const manager = {
    query: async (sql: string, args: unknown[]) => {
      calls.push({ sql, args });
      if (sql.includes('SELECT id,sourceGroupId,status')) {
        return [{ id: 'analysis-group-a', sourceGroupId: 'g-a', status: 'VALIDATED' }];
      }
      return [];
    },
  };
  const service = Object.create(PreventionExtractionService.prototype) as PreventionExtractionService;
  await (service as any).upsertAnalysisGroups(manager, 'org-a', {
    reportId: 'report-a', visitId: 'visit-a', missionId: 'mission-a',
    analysisGroups: [{
      sourceGroupId: 'g-a', sourceKind: 'PHOTO', proposedPhase: 'SECOND_OEUVRE',
      effectivePhase: 'SECOND_OEUVRE', status: 'PROPOSED', confidence: 90,
      justification: 'Nouvelle proposition IA', source: 'PHOTO', modelVersion: null,
      validatedBy: null, validatedAt: null, sourceHash: 'a'.repeat(64),
    }],
  });
  const updates = calls.filter((call) => call.sql.includes('UPDATE prevention_analysis_groups'));
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /SET missionId=\?,reportId=\?,sourceKind=\?/);
  assert.doesNotMatch(updates[0].sql, /effectivePhase|status=/);
});

test('deleting a group removes its visible validated phase without changing its durable assessment', async () => {
  const calls: string[] = [];
  const manager = { query: async (sql: string) => {
    calls.push(sql);
    return sql.includes('SELECT id,sourceGroupId,status')
      ? [{ id: 'analysis-group-a', sourceGroupId: 'g-a', status: 'VALIDATED' }] : [];
  } };
  const service = Object.create(PreventionExtractionService.prototype) as PreventionExtractionService;
  await (service as any).upsertAnalysisGroups(manager, 'org-a', {
    reportId: 'report-a', visitId: 'visit-a', missionId: 'mission-a', analysisGroups: [],
  });
  assert.ok(calls.some((sql) => sql.includes('DELETE FROM prevention_analysis_groups')));
  assert.ok(!calls.some((sql) => sql.includes('prevention_group_processing_jobs')));
});

test('phase metadata is strictly validated when supplied', () => {
  assert.throws(() => canonicalizePreventionSource({
    ...baseInput,
    entries: [{ groupId: 'g', analysis: {
      observation: 'Constat', riskLevel: 'moyen', constructionPhase: 'UNKNOWN',
      phaseConfidence: 50, phaseJustification: 'invalid',
    } } as any],
  }), PreventionSourceValidationError);
});

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
