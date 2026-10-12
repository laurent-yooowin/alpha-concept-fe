import assert from 'node:assert/strict';
import test from 'node:test';
import { PreventionGroupProcessingService } from './prevention-group-processing.service';
import { fetchPreventionGroupJson, PreventionGroupLlmTimeoutError, PreventionOnlyAiService } from '../ai/prevention-only-ai.service';
import { buildPreventionGroupInput, preventionGroupSourceHash } from './prevention-group-source';
import { PreventionPhotoDownloadService } from './prevention-photo-download.service';
import { createHash } from 'crypto';

const organizationId = '10000000-0000-4000-8000-000000000001';
const visitId = '20000000-0000-4000-8000-000000000001';
const missionId = '30000000-0000-4000-8000-000000000001';
const recoveryRunId = '40000000-0000-4000-8000-000000000001';

test('a photo group with meaningful SPS directives is staged as MIXED without a synthetic photo entry', () => {
  const { sourceKind } = buildPreventionGroupInput([{ groupId: 'g-1', s3Url: 'https://example.invalid/photo.jpg', userDirectives: 'Vérifier les protections collectives', analysis: { observation: ['Protection à vérifier'] } }]);
  assert.equal(sourceKind, 'MIXED');
});

function service(existing?: Record<string, unknown>) {
  const writes: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = {
    query: async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes('SELECT id,sourceHash,processingStatus')) return existing ? [existing] : [];
      writes.push({ sql, parameters });
      return [];
    },
  };
  const db = { transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager) };
  return { processor: new PreventionGroupProcessingService(db as any), writes };
}

test('an SPS group is staged PENDING independently of its SPS risk and phase fields', async () => {
  const { processor, writes } = service();
  const entries = [{ id: 'photo-1', groupId: 'group-1', s3Url: 'https://example.invalid/photo.jpg', analysis: {
    observation: ['Échafaudage incomplet'], recommendation: ['Sécuriser'], references: ['R. 4323-58'],
    riskLevel: 'faible', preventionPhase: 'FINITIONS_EXTERIEURES',
  } }];
  const result = await (processor as any).upsertGroup(organizationId, visitId, missionId, 'group-1', entries);
  assert.deepEqual(result, { status: 'PENDING', changed: true });
  assert.match(writes[0].sql, /INSERT INTO prevention_group_processing_jobs/);
  assert.equal(writes[0].parameters[6], 'PENDING');
  const payload = JSON.parse(String(writes[0].parameters[13]));
  assert.deepEqual(payload.entries[0].observationTexts, ['Échafaudage incomplet']);
  assert.deepEqual(payload.entries[0].recommendationTexts, ['Sécuriser']);
  assert.deepEqual(payload.entries[0].referenceTexts, ['R. 4323-58']);
  assert.equal(JSON.stringify(payload).includes('preventionPhase'), false);
  assert.deepEqual(entries[0].analysis.observation, ['Échafaudage incomplet']);
});

test('a changed persisted photo URL invalidates the Prevention group version', () => {
  const { processor } = service();
  const initial = [{ id: 'photo-1', s3Url: 'https://example.invalid/one.jpg', analysis: { observation: ['Danger'] } }];
  const changed = [{ ...initial[0], s3Url: 'https://example.invalid/two.jpg' }];
  const hash = preventionGroupSourceHash('group-1', initial);
  assert.equal(processor.matchesCurrentSource('group-1', initial, hash), true);
  assert.equal(processor.matchesCurrentSource('group-1', changed, hash), false);
});

test('a multi-photo source hash survives the visit JSON persistence round-trip', () => {
  const sharedAnalysis = {
    observation: ['Protection collective absente'],
    recommendation: ['Installer un garde-corps'],
    references: ['R. 4323-59'],
    riskLevel: 'eleve',
    confidence: 91,
  };
  const entries = [
    { id: 'photo-1', groupId: 'group-1', s3Url: 'https://example.invalid/one.jpg', analysis: sharedAnalysis },
    { id: 'photo-2', groupId: 'group-1', s3Url: 'https://example.invalid/two.jpg', analysis: sharedAnalysis },
  ];
  const persistedEntries = JSON.parse(JSON.stringify(entries));

  assert.equal(
    preventionGroupSourceHash('group-1', entries),
    preventionGroupSourceHash('group-1', persistedEntries),
  );
  assert.deepEqual(buildPreventionGroupInput(entries), buildPreventionGroupInput(persistedEntries));
});

test('a later photo or text edit cannot restage the Prevention LLM job', async () => {
  const initial = [{ id: 'photo-1', groupId: 'group-1', s3Url: 'https://example.invalid/one.jpg',
    analysis: { observation: ['Danger'] } }];
  const changed = [{ ...initial[0], s3Url: 'https://example.invalid/two.jpg' }];
  const processor = new PreventionGroupProcessingService({ query: async () => [{ missionId, photos: changed }] } as any);
  const payload = { organizationId, visitId, sourceGroupId: 'group-1',
    sourceHash: preventionGroupSourceHash('group-1', initial) };
  assert.equal(await (processor as any).loadCurrentInput(payload), 'STALE');
});

test('manual recommendation edit schedules a dedicated versioned job without restaging the group', async () => {
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: ['Nouvelle mesure'] } }];
  const added: Array<{ name: string; payload: any; jobId: string }> = [];
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM reports r')) return [{ visitId, photos }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [{
      sourceGroupId: 'group-1', sourcePayload: { entries: [{ recommendationTexts: ['Ancienne mesure'] }] },
      recommendationOverrides: null,
    }];
    throw new Error('Unexpected query');
  } };
  const processor = new PreventionGroupProcessingService(db as any);
  const queue = { add: async (name: string, payload: any, options: any) => {
    added.push({ name, payload, jobId: options.jobId });
  } } as any;
  const queued = await processor.enqueueEditedRecommendationsForReport(organizationId,
    '40000000-0000-4000-8000-000000000001', queue, '50000000-0000-4000-8000-000000000001');
  assert.equal(queued, 1);
  assert.equal(added[0].name, 'prevention.recommendation.assess');
  assert.deepEqual(Object.keys(added[0].payload).sort(), ['organizationId', 'recommendationHash', 'sourceGroupId', 'visitId']);
  await processor.enqueueEditedRecommendationsForReport(organizationId,
    '40000000-0000-4000-8000-000000000001', queue, '50000000-0000-4000-8000-000000000002');
  assert.notEqual(added[0].jobId, added[1].jobId, 'a later A edit must survive an active earlier A job');
});

test('scheduled report reread alone assesses an original recommendation while its action type is missing', async () => {
  const recommendation = 'Installer des garde-corps';
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: [recommendation] } }];
  const job = { sourceGroupId: 'group-1', sourcePayload: { entries: [{ recommendationTexts: [recommendation] }] },
    riskAssessments: { recommendations: [{ index: 0, riskLevel: 'eleve' }] }, recommendationOverrides: null as unknown };
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM reports r')) return [{ visitId, photos }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [job];
    throw new Error('Unexpected query');
  } };
  const added: unknown[] = [];
  const queue = { add: async (_name: string, payload: unknown) => { added.push(payload); } } as any;
  const processor = new PreventionGroupProcessingService(db as any);
  const reportId = '40000000-0000-4000-8000-000000000001';
  const eventId = '50000000-0000-4000-8000-000000000001';
  assert.equal(await processor.enqueueEditedRecommendationsForReport(organizationId, reportId, queue, eventId), 0);
  assert.equal(await processor.enqueueEditedRecommendationsForReport(organizationId, reportId, queue, eventId, true), 1);
  assert.equal((added[0] as any).recoveryMode, 'SCHEDULED_MISSING_TYPES');
  job.riskAssessments.recommendations[0] = { index: 0, riskLevel: 'eleve', actionType: 'height-protection' } as any;
  assert.equal(await processor.enqueueEditedRecommendationsForReport(organizationId, reportId, queue, eventId, true), 0);
  job.riskAssessments.recommendations[0] = { index: 0, riskLevel: 'eleve', actionType: 'A_CLASSER' } as any;
  assert.equal(await processor.enqueueEditedRecommendationsForReport(organizationId, reportId, queue, eventId, true), 1);
  assert.equal(added.length, 2);
});

test('targeted recommendation assessment persists only a version-matched override and publishes a report event', async () => {
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: ['Nouvelle mesure'] } }];
  const recommendationHash = createHash('sha256').update(JSON.stringify(['Nouvelle mesure'])).digest('hex');
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  let events = 0;
  const job = { id: 'job-1', sourcePayload: { entries: [{ recommendationTexts: ['Ancienne mesure'] }] }, recommendationOverrides: null };
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM visits')) return [{ photos }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [job];
    if (sql.includes('FROM reports')) return [{ id: '40000000-0000-4000-8000-000000000001' }];
    writes.push({ sql, args });
    return [];
  } };
  const db = {
    query: async (sql: string) => sql.includes('FROM visits') ? [{ photos }] : [job],
    transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
  };
  const processor = new PreventionGroupProcessingService(db as any, undefined, undefined, undefined,
    { enqueueReportEvent: async () => { events += 1; } } as any);
  const result = await processor.processEditedRecommendations({ organizationId, visitId,
    sourceGroupId: 'group-1', recommendationHash }, { assessEditedRecommendations: async () => [{
      index: 0, riskLevel: 'eleve', confidence: 85, actionType: 'waste-management',
      actionTypeConfidence: 92, actionTypeVersion: 'v1',
    }] } as any);
  assert.equal(result, 'READY');
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /SET recommendationOverrides=/);
  assert.equal(Object.values(JSON.parse(String(writes[0].args[0])))[0]['actionType'], 'waste-management');
  assert.equal(events, 1);
});

test('targeted recovery classifies an unchanged original recommendation without changing its risk or phase', async () => {
  const recommendation = 'Installer des garde-corps';
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: [recommendation] } }];
  const recommendationHash = createHash('sha256').update(JSON.stringify([recommendation])).digest('hex');
  const job = { id: 'job-1', sourcePayload: { entries: [{ recommendationTexts: [recommendation] }] },
    riskAssessments: { observations: [{ index: 0, riskLevel: 'faible', confidence: 70 }],
      recommendations: [{ index: 0, riskLevel: 'eleve', confidence: 85 }] },
    recommendationOverrides: null };
  let updated: Record<string, unknown> | null = null;
  let events = 0;
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM visits')) return [{ photos }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [job];
    if (sql.includes('FROM reports')) return [{ id: '40000000-0000-4000-8000-000000000001' }];
    if (sql.startsWith('UPDATE prevention_group_processing_jobs')) {
      assert.match(sql, /SET riskAssessments=\?/);
      updated = JSON.parse(String(args[0]));
      return [];
    }
    throw new Error('Unexpected query');
  } };
  const db = { query: async (sql: string) => sql.includes('FROM visits') ? [{ photos }] : [job],
    transaction: async (work: any) => work(manager) };
  const processor = new PreventionGroupProcessingService(db as any, undefined, undefined, undefined,
    { enqueueReportEvent: async () => { events += 1; } } as any);
  const result = await processor.processEditedRecommendations({ organizationId, visitId,
    sourceGroupId: 'group-1', recommendationHash, recoveryMode: 'SCHEDULED_MISSING_TYPES' }, {
    classifyRecommendationActions: async () => [{ index: 0, actionType: 'height-protection',
      actionTypeConfidence: 92, actionTypeVersion: 'v2' }],
    assessEditedRecommendations: async () => { throw new Error('Must not reassess an unchanged risk'); },
  } as any);
  assert.equal(result, 'READY');
  assert.equal((updated as any).recommendations[0].actionType, 'height-protection');
  assert.equal((updated as any).recommendations[0].riskLevel, 'eleve');
  assert.equal((updated as any).recommendations[0].confidence, 85);
  assert.deepEqual((updated as any).observations, job.riskAssessments.observations);
  assert.equal(events, 1);
});

test('immediate missing-type recovery never reassesses a coexisting edited recommendation', async () => {
  const original = 'Installer des garde-corps';
  const edited = 'Ajouter une protection temporaire';
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: [original, edited] } }];
  const recommendationHash = createHash('sha256').update(JSON.stringify([original, edited])).digest('hex');
  const editedHash = createHash('sha256').update(edited).digest('hex');
  const job = { id: 'job-1', sourcePayload: { entries: [{ recommendationTexts: [original] }] },
    riskAssessments: { recommendations: [{ index: 0, riskLevel: 'eleve', confidence: 85 }] },
    recommendationOverrides: { [editedHash]: { riskLevel: 'faible', confidence: 60,
      actionType: 'A_CLASSER', actionTypeConfidence: 80, actionTypeVersion: 'v2', actionMetric: null } } };
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM visits')) return [{ photos }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [job];
    if (sql.includes('FROM reports')) return [{ id: '40000000-0000-4000-8000-000000000001' }];
    if (sql.startsWith('UPDATE prevention_group_processing_jobs')) { writes.push({ sql, args }); return []; }
    throw new Error('Unexpected query');
  } };
  const db = { query: manager.query, transaction: async (work: any) => work(manager) };
  const processor = new PreventionGroupProcessingService(db as any);
  const result = await processor.processEditedRecommendations({ organizationId, visitId,
    sourceGroupId: 'group-1', recommendationHash, recoveryMode: 'IMMEDIATE_MISSING_TYPES', classificationLimit: 2 }, {
    classifyRecommendationActions: async (texts: string[]) => texts.map((text, index) => ({ index,
      actionType: text === original ? 'height-protection' : 'traffic-plan',
      actionTypeConfidence: 92, actionTypeVersion: 'v2' })),
    assessEditedRecommendations: async () => { throw new Error('Edited recommendations must not be reassessed'); },
  } as any);
  assert.equal(result, 'READY');
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /SET riskAssessments=\?,recommendationOverrides=\?/);
  assert.equal((JSON.parse(String(writes[0].args[0])) as any).recommendations[0].riskLevel, 'eleve');
  const editedOverride = (JSON.parse(String(writes[0].args[1])) as any)[editedHash];
  assert.equal(editedOverride.actionType, 'traffic-plan');
  assert.equal(editedOverride.riskLevel, 'faible');
  assert.equal(editedOverride.confidence, 60);
});

test('targeted assessment cannot publish a result after a second manual edit', async () => {
  const initialPhotos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: ['Mesure A'] } }];
  const laterPhotos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: ['Mesure B'] } }];
  const recommendationHash = createHash('sha256').update(JSON.stringify(['Mesure A'])).digest('hex');
  let writes = 0;
  const job = { id: 'job-1', sourcePayload: { entries: [{ recommendationTexts: ['Ancienne mesure'] }] }, recommendationOverrides: null };
  const db = {
    query: async (sql: string) => sql.includes('FROM visits') ? [{ photos: initialPhotos }] : [job],
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({ query: async (sql: string) => {
      if (sql.includes('FROM visits')) return [{ photos: laterPhotos }];
      writes += 1;
      return [];
    } }),
  };
  const processor = new PreventionGroupProcessingService(db as any);
  const result = await processor.processEditedRecommendations({ organizationId, visitId,
    sourceGroupId: 'group-1', recommendationHash }, { assessEditedRecommendations: async () => [{
      index: 0, riskLevel: 'eleve', confidence: 85, actionType: 'traffic-plan',
      actionTypeConfidence: 90, actionTypeVersion: 'v1',
    }] } as any);
  assert.equal(result, 'STALE');
  assert.equal(writes, 0);
});

test('targeted assessment performs no write after tenant deactivation', async () => {
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: ['Mesure A'] } }];
  const recommendationHash = createHash('sha256').update(JSON.stringify(['Mesure A'])).digest('hex');
  let writes = 0;
  const job = { id: 'job-1', sourcePayload: { entries: [{ recommendationTexts: ['Ancienne mesure'] }] }, recommendationOverrides: null };
  const db = {
    query: async (sql: string) => sql.includes('FROM visits') ? [{ photos }] : [job],
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({ query: async (sql: string) => {
      if (sql.includes('FROM organizations')) return [{ isActive: 0, preventionEnabled: 1 }];
      writes += 1;
      return [];
    } }),
  };
  const processor = new PreventionGroupProcessingService(db as any, undefined, undefined,
    { isEnabled: async () => true } as any);
  const result = await processor.processEditedRecommendations({ organizationId, visitId,
    sourceGroupId: 'group-1', recommendationHash }, { assessEditedRecommendations: async () => [{
      index: 0, riskLevel: 'eleve', confidence: 85, actionType: 'traffic-plan',
      actionTypeConfidence: 90, actionTypeVersion: 'v1',
    }] } as any);
  assert.equal(result, 'SKIPPED_DISABLED');
  assert.equal(writes, 0);
});

test('staging rejects an oversized visit before creating Prevention jobs', async () => {
  const { processor } = service();
  const photos = Array.from({ length: 501 }, (_, index) => ({ id: `photo-${index}`, analysis: { observation: ['Danger'] } }));
  const db = { query: async () => [{ missionId, photos }] };
  (processor as any).db = db;
  await assert.rejects(processor.scheduleForVisit({ id: visitId, organizationId, missionId }), /too many entries to stage/);
});

test('historical staging rejects a group identifier longer than its database column', async () => {
  const photos = [{ groupId: 'g'.repeat(101), analysis: { observation: ['Danger'] } }];
  const processor = new PreventionGroupProcessingService({
    query: async () => [{ missionId, photos }],
    transaction: async () => { throw new Error('No persistence expected'); },
  } as any);
  await assert.rejects(processor.scheduleForVisit({ id: visitId, organizationId, missionId }),
    /identifier exceeds 100 characters/);
});

test('an unchanged READY group is not sent to the LLM again', async () => {
  const entries = [{ id: 'photo-1', analysis: { observation: ['Danger'] } }];
  const first = service();
  await (first.processor as any).upsertGroup(organizationId, visitId, missionId, 'group-1', entries);
  const inserted = first.writes[0].parameters;
  const resumed = service({ id: inserted[0], sourceHash: inserted[14], processingStatus: 'READY', phaseStatus: 'PROPOSED' });
  assert.deepEqual(await (resumed.processor as any).upsertGroup(organizationId, visitId, missionId, 'group-1', entries),
    { status: 'READY', changed: false });
  assert.equal(resumed.writes.length, 0);
});

test('a confirmed full recovery restages an unchanged READY group once without clearing human overrides', async () => {
  const entries = [{ id: 'photo-1', groupId: 'group-1', analysis: { observation: ['Danger'], recommendation: ['Protéger'] } }];
  const sourceHash = preventionGroupSourceHash('group-1', entries);
  const existing = { id: 'job-a', sourceHash, processingStatus: 'READY', phaseStatus: 'VALIDATED', effectivePhase: 'GROS_OEUVRE', recoveryRunId: null };
  const first = service(existing);
  assert.deepEqual(await (first.processor as any).upsertGroup(organizationId, visitId, missionId, 'group-1', entries,
    false, false, recoveryRunId), { status: 'PENDING', changed: true });
  assert.match(first.writes[0].sql, /recoveryRunId=\?/);
  assert.doesNotMatch(first.writes[0].sql, /recommendationOverrides=NULL/);
  assert.equal(first.writes[0].parameters.includes(recoveryRunId), true);
  assert.equal(first.writes[0].parameters.includes('GROS_OEUVRE'), true);

  const repeated = service({ ...existing, recoveryRunId, processingStatus: 'READY' });
  assert.deepEqual(await (repeated.processor as any).upsertGroup(organizationId, visitId, missionId, 'group-1', entries,
    false, false, recoveryRunId), { status: 'READY', changed: false });
  assert.equal(repeated.writes.length, 0);
});

test('full recovery counts every eligible visit group, including existing READY groups', async () => {
  const processor = new PreventionGroupProcessingService({ query: async (sql: string, args: unknown[]) => {
    assert.match(sql, /organizationId=\?/);
    assert.equal(args[0], organizationId);
    return [{ id: visitId, photos: [
      { groupId: 'group-a', analysis: { observation: ['Danger'] } },
      { groupId: 'group-a' },
      { groupId: 'group-b', analysis: { recommendation: ['Protéger'] } },
      { groupId: 'group-c' },
    ] }];
  } } as any);
  assert.equal(await processor.countEligibleGroups(organizationId, 10), 2);
});

test('full recovery persists new AI proposals while retaining a human-validated phase and overrides', async () => {
  const entries = [{ groupId: 'group-1', analysis: { observation: ['Danger'], recommendation: ['Protéger'] } }];
  const sourceHash = preventionGroupSourceHash('group-1', entries);
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const processor = new PreventionGroupProcessingService({ transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('SELECT photos FROM visits')) return [{ photos: entries }];
      if (sql.includes('SELECT id,phaseStatus')) return [{ id: 'job-a', phaseStatus: 'VALIDATED', effectivePhase: 'GROS_OEUVRE',
        validatedBy: 'human-user', validatedAt: '2026-10-01', recoveryRunId }];
      if (sql.includes('SELECT id FROM reports')) return [];
      writes.push({ sql, args });
      return [];
    },
  }) } as any);
  const result = await (processor as any).persistResult({ organizationId, visitId, sourceGroupId: 'group-1', sourceHash },
    { phase: 'SECOND_OEUVRE', confidence: 80, justification: 'Nouvelle analyse', observations: [], recommendations: [] }, 'claim');
  assert.equal(result, '');
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0].sql, /recommendationOverrides=NULL/);
  assert.equal(writes[0].args[1], 'SECOND_OEUVRE');
  assert.equal(writes[0].args[2], 'GROS_OEUVRE');
});

test('an explicit SPS reanalysis retries an unchanged FAILED Prevention group', async () => {
  const entries = [{ id: 'photo-1', groupId: 'group-1', s3Url: 'https://example.invalid/photo.jpg',
    analysis: { observation: ['Danger'] } }];
  const sourceHash = preventionGroupSourceHash('group-1', entries);
  const writes: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('SELECT id,sourceHash,processingStatus')) return [{
      id: 'job-a', sourceHash, processingStatus: 'FAILED', phaseStatus: 'PROPOSED', effectivePhase: null,
    }];
    writes.push({ sql, parameters });
    return [];
  } };
  const processor = new PreventionGroupProcessingService({} as any);
  const result = await processor.stageExplicitGroupInTransaction(
    manager, organizationId, visitId, missionId, 'group-1', entries,
  );
  assert.deepEqual(result, { status: 'PENDING', changed: true });
  assert.ok(writes.some(({ sql }) => sql.includes("processingStatus='PENDING'")));
  assert.ok(writes.some(({ sql }) => sql.includes('recoveryRunId=NULL')));
  assert.ok(writes.every(({ sql }) => !sql.includes('recommendationOverrides=NULL')));
});

test('operator backfill cannot re-evaluate an existing group after a manual edit', async () => {
  const { processor, writes } = service({ id: 'job-a', sourceHash: 'a'.repeat(64),
    processingStatus: 'READY', phaseStatus: 'PROPOSED' });
  const result = await (processor as any).upsertGroup(organizationId, visitId, missionId, 'group-1',
    [{ id: 'photo-1', analysis: { observation: ['Changed by a user'] } }], false, true);
  assert.deepEqual(result, { status: 'READY', changed: false });
  assert.equal(writes.length, 0);
});

test('a tenant deactivated after the initial check cannot stage a group', async () => {
  let wrote = false;
  const manager = { query: async (sql: string) => {
    if (sql.includes('FROM organizations')) return [{ isActive: 0, preventionEnabled: 1 }];
    wrote = true;
    return [];
  } };
  const db = { transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager) };
  const processor = new PreventionGroupProcessingService(db as any, undefined, undefined, { isEnabled: async () => true } as any);
  const result = await (processor as any).upsertGroup(organizationId, visitId, missionId, 'group-1',
    [{ id: 'photo-1', analysis: { observation: ['Danger'] } }]);
  assert.deepEqual(result, { status: 'DISABLED', changed: false });
  assert.equal(wrote, false);
});

test('dispatcher selects jobs only for active Prevention organizations', async () => {
  const queries: string[] = [];
  const processor = new PreventionGroupProcessingService({ query: async (sql: string) => {
    queries.push(sql);
    return [];
  } } as any, { add: async () => { throw new Error('No job expected'); } } as any);
  assert.equal(await processor.enqueueDue(), 0);
  assert.ok(queries.some((sql) => sql.includes('o.isActive=1 AND o.preventionEnabled=1')));
});

test('worker does not claim a job after the organization is deactivated', async () => {
  let claimed = false;
  const manager = { query: async (sql: string) => {
    if (sql.includes('FROM organizations')) return [{ isActive: 0, preventionEnabled: 1 }];
    claimed = true;
    return [];
  } };
  const db = {
    query: async () => [{ id: 'job-1', processingStatus: 'PENDING' }],
    transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
  };
  const processor = new PreventionGroupProcessingService(db as any, undefined, undefined, { isEnabled: async () => true } as any);
  const result = await processor.process({ organizationId, visitId, sourceGroupId: 'group-1', sourceHash: 'a'.repeat(64) },
    { analyze: async () => { throw new Error('AI must not run'); } } as any);
  assert.equal(result, 'SKIPPED');
  assert.equal(claimed, false);
});

test('terminal group failure logs its recovery correlation and safe cause', async () => {
  const sourceHash = 'a'.repeat(64);
  const current = { id: 'job-1', sourceHash, processingStatus: 'PENDING', attempts: 4, recoveryRunId };
  const writes: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('SELECT * FROM prevention_group_processing_jobs')) return [current];
    writes.push({ sql, parameters });
    return [{ affectedRows: 1 }];
  } };
  const db = {
    query: async () => [current],
    transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
  };
  const processor = new PreventionGroupProcessingService(db as any);
  let event: Record<string, unknown> | undefined;
  (processor as any).logger = { warn: (value: Record<string, unknown>) => { event = value; } };
  (processor as any).loadCurrentInput = async () => ({ entries: [] });
  await assert.rejects(processor.process({ organizationId, visitId, sourceGroupId: 'group-1', sourceHash },
    { analyze: async () => { throw new Error('Prevention LLM returned an invalid recommendation risk vector'); } } as any));
  assert.equal(event?.event, 'PREVENTION_GROUP_EVALUATION_FAILED');
  assert.equal(event?.recoveryRunId, recoveryRunId);
  assert.equal(event?.terminal, true);
  assert.equal(event?.errorCode, 'AI_INVALID_RECOMMENDATION_RISK_VECTOR');
  assert.doesNotMatch(JSON.stringify(event), /invalid recommendation risk vector/i);
  assert.ok(writes.some(({ sql, parameters }) => sql.includes('SET processingStatus=?') && parameters[0] === 'FAILED'));
});

test('the group request waits past its first deadline without issuing another HTTP call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let complete!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url: unknown, options: any) => {
    calls += 1;
    signal = options.signal;
    return new Promise<Response>((resolve) => { complete = resolve; });
  }) as typeof fetch;
  try {
    const pending = fetchPreventionGroupJson('https://example.invalid', {}, 30);
    await new Promise((resolve) => setTimeout(resolve, 42));
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, false);
    complete({ ok: true, json: async () => ({ result: 'ready' }) } as Response);
    assert.deepEqual(await pending, { result: 'ready' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('the same group request aborts only after three timeout windows', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url: unknown, options: any) => {
    calls += 1;
    signal = options.signal;
    return new Promise<Response>(() => undefined);
  }) as typeof fetch;
  try {
    const started = Date.now();
    await assert.rejects(fetchPreventionGroupJson('https://example.invalid', {}, 30), PreventionGroupLlmTimeoutError);
    assert.ok(Date.now() - started >= 85);
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('a group HTTP error propagates immediately without retrying', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return { ok: false, status: 503 } as Response; }) as typeof fetch;
  try {
    await assert.rejects(fetchPreventionGroupJson('https://example.invalid', {}, 30), /Prevention LLM request failed \(503\)/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('the group deadline also bounds a response body that never finishes', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url: unknown, options: any) => {
    calls += 1;
    signal = options.signal;
    return { ok: true, json: async () => new Promise(() => undefined) } as Response;
  }) as typeof fetch;
  try {
    await assert.rejects(fetchPreventionGroupJson('https://example.invalid', {}, 30), PreventionGroupLlmTimeoutError);
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('an exhausted group timeout becomes terminal without a BullMQ retry', async () => {
  const sourceHash = 'a'.repeat(64);
  const current = { id: 'job-1', sourceHash, processingStatus: 'PENDING', attempts: 0, recoveryRunId };
  const writes: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('SELECT * FROM prevention_group_processing_jobs')) return [current];
    writes.push({ sql, parameters });
    return [{ affectedRows: 1 }];
  } };
  const db = { query: async () => [current], transaction: async (callback: (value: typeof manager) => Promise<unknown>) => callback(manager) };
  const processor = new PreventionGroupProcessingService(db as any);
  (processor as any).logger = { warn: () => undefined };
  (processor as any).loadCurrentInput = async () => ({ entries: [] });
  await assert.rejects(processor.process({ organizationId, visitId, sourceGroupId: 'group-1', sourceHash },
    { analyze: async () => { throw new PreventionGroupLlmTimeoutError(); } } as any),
    (error: any) => error?.name === 'UnrecoverableError');
  assert.ok(writes.some(({ sql, parameters }) => sql.includes('SET processingStatus=?') && parameters[0] === 'FAILED'));
});

test('Prevention-only LLM receives persisted photos and SPS text without invoking SPS analysis', async () => {
  const originalFetch = globalThis.fetch;
  let request: any;
  globalThis.fetch = (async (_url: unknown, options: any) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      preventionPhase: 'GROS_OEUVRE', preventionPhaseConfidence: 80,
      preventionPhaseJustification: 'Coffrage visible',
      observations: [{ index: 0, riskLevel: 'eleve', confidence: 85 }],
      recommendations: [{ index: 0, riskLevel: 'moyen', confidence: 78,
        actionType: 'height-protection', actionTypeConfidence: 92 }],
    }) } }] }) } as Response;
  }) as typeof fetch;
  try {
    const config = { get: (key: string, fallback?: string) => key === 'OPENAI_API_KEY' ? 'test-key' : fallback };
    let downloaded = false;
    const downloads = { downloadGroup: async (org: string, visit: string, group: string) => {
      assert.deepEqual([org, visit, group], [organizationId, visitId, 'group-1']);
      downloaded = true;
      return [{ contentType: 'image/jpeg', base64: 'aGVsbG8=' }];
    } };
    const ai = new PreventionOnlyAiService(config as any, downloads as any);
    const result = await ai.analyze({ sourceKind: 'PHOTO', entries: [{ observationTexts: ['Échafaudage incomplet'],
      recommendationTexts: ['Sécuriser'], referenceTexts: ['R. 4323-58'] }] }, organizationId, visitId, 'group-1');
    assert.equal(result.phase, 'GROS_OEUVRE');
    assert.equal(result.recommendations[0].riskLevel, 'moyen');
    assert.equal(result.recommendations[0].actionType, 'height-protection');
    assert.equal(result.recommendations[0].actionTypeVersion, 'v2');
    assert.equal(downloaded, true);
    assert.match(JSON.stringify(request.messages[1]), /Sécuriser/);
    assert.match(request.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown action type fails closed without discarding a valid Prevention risk', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    preventionPhase: 'SECOND_OEUVRE', preventionPhaseConfidence: 70,
    preventionPhaseJustification: 'Travaux intérieurs', observations: [],
    recommendations: [{ index: 0, riskLevel: 'eleve', confidence: 72,
      actionType: 'fire-protection-but-not-valid', actionTypeConfidence: 99 }],
  }) } }] }) } as Response)) as typeof fetch;
  try {
    const ai = new PreventionOnlyAiService({ get: (key: string, fallback?: string) => key === 'OPENAI_API_KEY' ? 'test-key' : fallback } as any,
      { downloadGroup: async () => [] } as any);
    const result = await ai.analyze({ sourceKind: 'DIRECTIVE', entries: [{ recommendationTexts: ['Évacuer les déchets'] }] },
      organizationId, visitId, 'directive-1');
    assert.equal(result.recommendations[0].riskLevel, 'eleve');
    assert.equal(result.recommendations[0].actionType, 'specific-action');
  } finally { globalThis.fetch = originalFetch; }
});

test('Prevention-only LLM requests exact risk vector counts and rejects missing recommendations', async () => {
  const originalFetch = globalThis.fetch;
  let request: any;
  globalThis.fetch = (async (_url: unknown, options: any) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      preventionPhase: 'SECOND_OEUVRE', preventionPhaseConfidence: 70,
      preventionPhaseJustification: 'Travaux intérieurs', observations: [], recommendations: [],
    }) } }] }) } as Response;
  }) as typeof fetch;
  try {
    const ai = new PreventionOnlyAiService({ get: (key: string, fallback?: string) => key === 'OPENAI_API_KEY' ? 'test-key' : fallback } as any,
      { downloadGroup: async () => [] } as any);
    await assert.rejects(ai.analyze({ sourceKind: 'DIRECTIVE', entries: [{ recommendationTexts: ['Mettre en place une protection'] }] },
      organizationId, visitId, 'directive-1'), (error: any) => {
      assert.equal(error.vectorReason, 'COUNT_MISMATCH');
      assert.equal(error.vectorExpectedCount, 1);
      assert.equal(error.vectorActualCount, 0);
      return true;
    });
    assert.match(request.messages[1].content, /exactement 0 entrée\(s\) dans observations et 1 entrée\(s\) dans recommendations/);
  } finally { globalThis.fetch = originalFetch; }
});

test('classification-only validates index and leaves phase and risk untouched', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    recommendations: [{ index: 0, actionType: 'waste-management', actionTypeConfidence: 93 }],
  }) } }] }) } as Response)) as typeof fetch;
  try {
    const ai = new PreventionOnlyAiService({ get: (key: string, fallback?: string) => key === 'OPENAI_API_KEY' ? 'test-key' : fallback } as any,
      { downloadGroup: async () => [] } as any);
    const result = await ai.classifyRecommendationActions(['Organiser le tri et l’évacuation des déchets']);
    assert.deepEqual(result, [{ index: 0, actionType: 'waste-complete', actionTypeConfidence: 93, actionTypeVersion: 'v2' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('edited recommendation assessment returns a new risk and action without a phase', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    recommendations: [{ index: 0, riskLevel: 'eleve', confidence: 89,
      actionType: 'waste-management', actionTypeConfidence: 94 }],
  }) } }] }) } as Response)) as typeof fetch;
  try {
    const ai = new PreventionOnlyAiService({ get: (key: string, fallback?: string) => key === 'OPENAI_API_KEY' ? 'test-key' : fallback } as any,
      { downloadGroup: async () => { throw new Error('No photo request expected'); } } as any);
    const result = await ai.assessEditedRecommendations(['Organiser l’évacuation des déchets']);
    assert.deepEqual(result, [{ index: 0, riskLevel: 'eleve', confidence: 89,
      actionType: 'waste-disposal', actionTypeConfidence: 94, actionTypeVersion: 'v2' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('Prevention-only LLM continues with SPS text when persisted photos are unavailable', async () => {
  const originalFetch = globalThis.fetch;
  let request: any;
  globalThis.fetch = (async (_url: unknown, options: any) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      preventionPhase: 'SECOND_OEUVRE', preventionPhaseConfidence: 70,
      preventionPhaseJustification: 'Le texte SPS reste exploitable',
      observations: [{ index: 0, riskLevel: 'moyen', confidence: 75 }],
      recommendations: [],
    }) } }] }) } as Response;
  }) as typeof fetch;
  try {
    const ai = new PreventionOnlyAiService({
      get: (key: string, fallback?: string) => key === 'OPENAI_API_KEY' ? 'test-key' : fallback,
    } as any, { downloadGroup: async () => { throw new Error('S3 object unavailable'); } } as any);
    const result = await ai.analyze({ sourceKind: 'PHOTO', entries: [{
      observationTexts: ['Protection collective absente'],
    }] }, organizationId, visitId, 'group-1');
    assert.equal(result.phase, 'SECOND_OEUVRE');
    assert.equal(result.observations[0].riskLevel, 'moyen');
    assert.equal(typeof request.messages[1].content, 'string');
    assert.match(request.messages[1].content, /Protection collective absente/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a recommendation-only group gets its risk from the Prevention LLM', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    preventionPhase: 'SECOND_OEUVRE', preventionPhaseConfidence: 61,
    preventionPhaseJustification: 'Travaux intérieurs', observations: [],
    recommendations: [{ index: 0, riskLevel: 'eleve', confidence: 72 }],
  }) } }] }) } as Response)) as typeof fetch;
  try {
    const ai = new PreventionOnlyAiService({ get: (key: string, fallback?: string) => key === 'OPENAI_API_KEY' ? 'test-key' : fallback } as any,
      { downloadGroup: async () => [] } as any);
    const result = await ai.analyze({ sourceKind: 'DIRECTIVE', entries: [{ recommendationTexts: ['Mettre en place une protection'] }] },
      organizationId, visitId, 'directive-1');
    assert.deepEqual(result.observations, []);
    assert.equal(result.recommendations[0].riskLevel, 'eleve');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('worker photo download selects only the persisted visit group and rejects another bucket', async () => {
  const config = { get: (key: string) => ({ AWS_S3_BUCKET: 'test-bucket', AWS_REGION: 'eu-west-3' } as Record<string, string>)[key] };
  const db = { query: async () => [{ photos: [
    { groupId: 'other-group', s3Url: 'https://test-bucket.s3.eu-west-3.amazonaws.com/visits/photos/10000000-0000-4000-8000-000000000001.jpg' },
    { groupId: 'group-1', s3Url: 'https://other-bucket.s3.eu-west-3.amazonaws.com/visits/photos/10000000-0000-4000-8000-000000000002.jpg' },
  ] }] };
  const downloads = new PreventionPhotoDownloadService(db as any, config as any);
  let s3Calls = 0;
  (downloads as any).s3 = { send: async () => { s3Calls += 1; throw new Error('Unexpected S3 call'); } };
  await assert.rejects(downloads.downloadGroup(organizationId, visitId, 'group-1'), /outside the configured visit photo bucket/);
  assert.equal(s3Calls, 0);
});

test('worker photo download enforces the tenant registry before any S3 call', async () => {
  const config = { get: (key: string) => ({ AWS_S3_BUCKET: 'test-bucket', AWS_REGION: 'eu-west-3' } as Record<string, string>)[key] };
  const db = { query: async () => [{ photos: [{ groupId: 'group-1',
    s3Url: 'https://test-bucket.s3.eu-west-3.amazonaws.com/visits/photos/10000000-0000-4000-8000-000000000004.jpg',
  }] }] };
  const assets = { assertWorkerAccess: async () => { throw new Error('foreign verified asset'); } };
  const downloads = new PreventionPhotoDownloadService(db as any, config as any, undefined, assets as any);
  let s3Calls = 0;
  (downloads as any).s3 = { send: async () => { s3Calls += 1; throw new Error('Unexpected S3 call'); } };
  await assert.rejects(downloads.downloadGroup(organizationId, visitId, 'group-1'), /foreign verified asset/);
  assert.equal(s3Calls, 0);
});

test('worker photo download rejects a declared oversized object before buffering it', async () => {
  const config = { get: (key: string) => ({ AWS_S3_BUCKET: 'test-bucket', AWS_REGION: 'eu-west-3' } as Record<string, string>)[key] };
  const db = { query: async () => [{ photos: [{ groupId: 'group-1',
    s3Url: 'https://test-bucket.s3.eu-west-3.amazonaws.com/visits/photos/10000000-0000-4000-8000-000000000001.jpg',
  }] }] };
  const downloads = new PreventionPhotoDownloadService(db as any, config as any);
  let bytesRead = false;
  (downloads as any).s3 = { send: async () => ({ ContentType: 'image/jpeg', ContentLength: 11 * 1024 * 1024,
    Body: { destroy: () => undefined, [Symbol.asyncIterator]: async function* () { bytesRead = true; yield Buffer.from('x'); } },
  }) };
  await assert.rejects(downloads.downloadGroup(organizationId, visitId, 'group-1'), /oversized/);
  assert.equal(bytesRead, false);
});

test('worker photo download retrieves every persisted photo of the group and no other entry', async () => {
  const config = { get: (key: string) => ({ AWS_S3_BUCKET: 'test-bucket', AWS_REGION: 'eu-west-3' } as Record<string, string>)[key] };
  const url = (id: string) => `https://test-bucket.s3.eu-west-3.amazonaws.com/visits/photos/${id}.jpg`;
  const db = { query: async () => [{ photos: [
    { groupId: 'group-1', s3Url: url('10000000-0000-4000-8000-000000000001') },
    { groupId: 'other-group', s3Url: url('10000000-0000-4000-8000-000000000002') },
    { groupId: 'group-1', isDirectiveOnly: true, userDirectives: 'Texte seul' },
    { groupId: 'group-1', s3Url: url('10000000-0000-4000-8000-000000000003') },
  ] }] };
  const downloads = new PreventionPhotoDownloadService(db as any, config as any);
  const keys: string[] = [];
  (downloads as any).s3 = { send: async (command: any) => {
    keys.push(command.input.Key);
    return {
      ContentType: 'image/jpeg', ContentLength: 3,
      Body: { [Symbol.asyncIterator]: async function* () { yield Buffer.from([0xff, 0xd8, 0xff]); } },
    };
  } };
  const result = await downloads.downloadGroup(organizationId, visitId, 'group-1');
  assert.equal(result.length, 2);
  assert.deepEqual(keys, [
    'visits/photos/10000000-0000-4000-8000-000000000001.jpg',
    'visits/photos/10000000-0000-4000-8000-000000000003.jpg',
  ]);
});
