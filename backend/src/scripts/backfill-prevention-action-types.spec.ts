import assert from 'node:assert/strict';
import test from 'node:test';
import { backfillPreventionActionTypes } from './backfill-prevention-action-types';
import { preventionGroupSourceHash } from '../prevention/worker/prevention-group-source';

const organizationId = '10000000-0000-4000-8000-000000000001';
const visitId = '20000000-0000-4000-8000-000000000001';

test('action-type dry-run inventories current pilot jobs without LLM calls or writes', async () => {
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: {
    observation: [], recommendation: ['Organiser le tri des déchets'], riskLevel: 'moyen', confidence: 90,
  } }];
  const job = { id: '30000000-0000-4000-8000-000000000001', organizationId, visitId,
    sourceGroupId: 'group-1', sourceHash: preventionGroupSourceHash('group-1', photos), photos,
    riskAssessments: { observations: [], recommendations: [{ index: 0, riskLevel: 'moyen', confidence: 90 }] },
    sourcePayload: { entries: [{ recommendationTexts: ['Organiser le tri des déchets'] }] },
  };
  const queries: string[] = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    queries.push(sql);
    if (sql.includes('FROM organizations')) return [{ isActive: 1, preventionEnabled: 1 }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return args[1] ? [] : [job];
    throw new Error('Unexpected query');
  } };
  const events: Record<string, unknown>[] = [];
  const result = await backfillPreventionActionTypes(db as any, null, organizationId, false,
    async (event) => { events.push(event); });
  assert.deepEqual(result, { inspected: 1, missing: 1, updated: 0, stale: 0 });
  assert.equal(queries.length, 3);
  assert.equal(events.length, 0);
});

test('action backfill accepts changed photo metadata only when current recommendation texts are identical', async () => {
  const originalPhotos = [{ id: 'photo-1', groupId: 'group-1', s3Url: 'old-photo', analysis: {
    recommendation: ['Installer des garde-corps'],
  } }];
  const job = { id: '30000000-0000-4000-8000-000000000001', organizationId, visitId,
    sourceGroupId: 'group-1', sourceHash: preventionGroupSourceHash('group-1', originalPhotos),
    riskAssessments: { observations: [], recommendations: [{ index: 0, riskLevel: 'eleve' }] },
    sourcePayload: { entries: [{ recommendationTexts: ['Installer des garde-corps'] }] },
  };
  const inspect = async (photos: unknown[]) => backfillPreventionActionTypes({ query: async (sql: string, args: unknown[]) => {
    if (sql.includes('FROM organizations')) return [{ isActive: 1, preventionEnabled: 1 }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return args[1] ? [] : [{ ...job, photos }];
    throw new Error('Unexpected query');
  } } as any, null, organizationId, false, async () => {});
  assert.deepEqual(await inspect([{ ...originalPhotos[0], s3Url: 'new-photo' }]),
    { inspected: 1, missing: 1, updated: 0, stale: 0 });
  assert.deepEqual(await inspect([{ ...originalPhotos[0], analysis: { recommendation: ['Installer une autre protection'] } }]),
    { inspected: 1, missing: 1, updated: 0, stale: 1 });
});

test('action-type apply refuses an inactive organization before any classification', async () => {
  const db = { query: async () => [{ isActive: 0, preventionEnabled: 1 }] };
  await assert.rejects(backfillPreventionActionTypes(db as any, {} as any, organizationId, true,
    async () => {}), /not active/);
});

test('partial backfill classifies only missing recommendations and preserves existing types', async () => {
  const recommendations = ['Installer des garde-corps', 'Organiser le tri des déchets'];
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { observation: [], recommendation: recommendations } }];
  const job = { id: '30000000-0000-4000-8000-000000000001', organizationId, visitId,
    sourceGroupId: 'group-1', sourceHash: preventionGroupSourceHash('group-1', photos), photos,
    riskAssessments: { observations: [], recommendations: [
      { index: 0, riskLevel: 'eleve', actionType: 'height-protection', actionTypeConfidence: 90, actionTypeVersion: 'v1' },
      { index: 1, riskLevel: 'moyen' },
    ] },
    sourcePayload: { entries: [{ recommendationTexts: recommendations }] },
  };
  let updated: any;
  const manager = { query: async (sql: string, args: any[]) => {
    if (sql.includes('FROM organizations')) return [{ isActive: 1, preventionEnabled: 1 }];
    if (sql.startsWith('SELECT photos FROM visits')) return [{ photos }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [job];
    if (sql.startsWith('UPDATE prevention_group_processing_jobs')) { updated = JSON.parse(args[0]); return {}; }
    if (sql.startsWith('SELECT id FROM reports')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const db = { query: async (sql: string, args: any[]) => {
    if (sql.includes('FROM organizations')) return [{ isActive: 1, preventionEnabled: 1 }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return args[1] ? [] : [job];
    throw new Error(`Unexpected query: ${sql}`);
  }, transaction: async (work: any) => work(manager) };
  const requested: string[][] = [];
  const ai = { classifyRecommendationActions: async (texts: string[]) => {
    requested.push(texts);
    return [{ index: 0, actionType: 'waste-management', actionTypeConfidence: 82, actionTypeVersion: 'v1' }];
  } };
  const result = await backfillPreventionActionTypes(db as any, ai as any, organizationId, true, async () => {}, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(requested, [[recommendations[1]]]);
  assert.deepEqual(updated.recommendations[0], job.riskAssessments.recommendations[0]);
  assert.equal(updated.recommendations[1].actionType, 'waste-management');
});

test('action backfill refuses a recommendation edited after classification but before its transaction', async () => {
  const photos = [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: ['Installer des garde-corps'] } }];
  const job = { id: '30000000-0000-4000-8000-000000000001', organizationId, visitId,
    sourceGroupId: 'group-1', sourceHash: preventionGroupSourceHash('group-1', photos), photos,
    riskAssessments: { observations: [], recommendations: [{ index: 0, riskLevel: 'eleve' }] },
    sourcePayload: { entries: [{ recommendationTexts: ['Installer des garde-corps'] }] },
  };
  let writes = 0;
  const db = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes('FROM organizations')) return [{ isActive: 1, preventionEnabled: 1 }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return args[1] ? [] : [job];
    throw new Error('Unexpected query');
  }, transaction: async (work: any) => work({ query: async (sql: string) => {
    if (sql.includes('FROM organizations')) return [{ isActive: 1, preventionEnabled: 1 }];
    if (sql.startsWith('SELECT photos FROM visits')) return [{ photos: [{ ...photos[0], analysis: { recommendation: ['Modifier la protection'] } }] }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [job];
    writes += 1;
    throw new Error('Unexpected write');
  } }) };
  const ai = { classifyRecommendationActions: async () => [{ index: 0, actionType: 'height-protection', actionTypeConfidence: 90, actionTypeVersion: 'v2' }] };
  const result = await backfillPreventionActionTypes(db as any, ai as any, organizationId, true, async () => {});
  assert.deepEqual(result, { inspected: 1, missing: 1, updated: 0, stale: 1 });
  assert.equal(writes, 0);
});
