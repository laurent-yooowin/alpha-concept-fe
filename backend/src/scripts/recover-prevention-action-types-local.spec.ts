import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverPreventionActionTypesLocal } from './recover-prevention-action-types-local';

const organizationId = '10000000-0000-4000-8000-000000000001';
const reportId = '40000000-0000-4000-8000-000000000001';
const visitId = '20000000-0000-4000-8000-000000000001';

function fixture(options: { active?: boolean; reportCount?: number; missingCount?: number;
  actionType?: string | null; growDuringSelection?: boolean } = {}) {
  const added: Array<{ name: string; payload: any; options: any }> = [];
  const risk = { recommendations: [{ index: 0, riskLevel: 'eleve', actionType: options.actionType ?? null }] };
  const queries: string[] = [];
  let inventories = 0;
  const db = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith('SELECT isActive,preventionEnabled')) return [{ isActive: options.active === false ? 0 : 1,
      preventionEnabled: 1 }];
    if (sql.includes('COUNT(DISTINCT f.reportId)')) {
      inventories += 1;
      return options.growDuringSelection && inventories > 2
        ? [{ reportCount: 20, missingCount: 31 }]
        : [{ reportCount: options.reportCount ?? 1, missingCount: options.missingCount ?? 1 }];
    }
    if (sql.includes('COUNT(*) AS missingCount')) return [{ missingCount: options.missingCount ?? 1 }];
    if (sql.includes('SELECT DISTINCT f.reportId')) return queries.filter((query) => query.includes('SELECT DISTINCT f.reportId')).length === 1
      ? [{ reportId }] : [];
    if (sql.includes('FROM reports r')) return [{ visitId, photos: [{ id: 'photo-1', groupId: 'group-1',
      analysis: { recommendation: ['Installer des garde-corps'] } }] }];
    if (sql.includes('FROM prevention_group_processing_jobs')) return [{ sourceGroupId: 'group-1',
      sourcePayload: { entries: [{ recommendationTexts: ['Installer des garde-corps'] }] },
      riskAssessments: risk, recommendationOverrides: null }];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const queue = { add: async (name: string, payload: any, queueOptions: any) => {
    added.push({ name, payload, options: queueOptions });
  } };
  return { db, queue, added, risk, queries };
}

test('local recovery dry-run inventories without publishing a job', async () => {
  const { db, queue, added } = fixture();
  const result = await recoverPreventionActionTypesLocal(db, organizationId, false, queue as any);
  assert.deepEqual(result, { reportCount: 1, missingCount: 1, queuedGroups: 0, dryRun: true });
  assert.equal(added.length, 0);
});

test('local recovery publishes only missing types with a deterministic immediate job', async () => {
  const { db, queue, added, risk } = fixture();
  const result = await recoverPreventionActionTypesLocal(db, organizationId, true, queue as any);
  assert.deepEqual(result, { reportCount: 1, missingCount: 1, queuedGroups: 1, dryRun: false });
  assert.equal(added.length, 1);
  assert.equal(added[0].name, 'prevention.recommendation.assess');
  assert.equal(added[0].payload.organizationId, organizationId);
  assert.equal(added[0].payload.recoveryMode, 'IMMEDIATE_MISSING_TYPES');
  assert.equal(added[0].payload.classificationLimit, 1);
  const firstJobId = added[0].options.jobId;
  risk.recommendations[0].actionType = 'height-protection';
  const repeated = await recoverPreventionActionTypesLocal(db, organizationId, true, queue as any);
  assert.equal(repeated.queuedGroups, 0);
  assert.equal(added.length, 1);
  assert.match(firstJobId, /^prevention-recommendation-[0-9a-f]{64}$/);
});

test('local recovery refuses disabled tenants and oversized runs before enqueue', async () => {
  const disabled = fixture({ active: false });
  await assert.rejects(recoverPreventionActionTypesLocal(disabled.db, organizationId, true, disabled.queue as any),
    /not active/);
  assert.equal(disabled.added.length, 0);
  const oversized = fixture({ reportCount: 20, missingCount: 31 });
  await assert.rejects(recoverPreventionActionTypesLocal(oversized.db, organizationId, true, oversized.queue as any),
    /immediate limit/);
  assert.equal(oversized.added.length, 0);
  const concurrentGrowth = fixture({ growDuringSelection: true });
  await assert.rejects(recoverPreventionActionTypesLocal(concurrentGrowth.db, organizationId, true,
    concurrentGrowth.queue as any), /volume changed/);
  assert.equal(concurrentGrowth.added.length, 0);
});

test('local recovery counts classifications across uneven reports without double-counting', async () => {
  const firstReport = '40000000-0000-4000-8000-000000000001';
  const secondReport = '40000000-0000-4000-8000-000000000002';
  const queued: any[] = [];
  let reportPage = 0;
  const db = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith('SELECT isActive,preventionEnabled')) return [{ isActive: 1, preventionEnabled: 1 }];
    if (sql.includes('COUNT(DISTINCT f.reportId)')) return [{ reportCount: 2, missingCount: 25 }];
    if (sql.includes('SELECT DISTINCT f.reportId')) return reportPage++ === 0
      ? [{ reportId: firstReport }, { reportId: secondReport }] : [];
    if (sql.includes('COUNT(*) AS missingCount')) return [{ missingCount: args[1] === firstReport ? 24 : 1 }];
    if (sql.includes('FROM reports r')) {
      const count = args[1] === firstReport ? 24 : 1;
      const texts = Array.from({ length: count }, (_, index) => `Mesure ${index + 1}`);
      return [{ visitId: args[1] === firstReport ? visitId : '20000000-0000-4000-8000-000000000002',
        photos: [{ id: 'photo-1', groupId: 'group-1', analysis: { recommendation: texts } }] }];
    }
    if (sql.includes('FROM prevention_group_processing_jobs')) {
      const count = args[1] === visitId ? 24 : 1;
      const texts = Array.from({ length: count }, (_, index) => `Mesure ${index + 1}`);
      return [{ sourceGroupId: 'group-1', sourcePayload: { entries: [{ recommendationTexts: texts }] },
        riskAssessments: { recommendations: texts.map((_, index) => ({ index, riskLevel: 'eleve' })) },
        recommendationOverrides: null }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const queue = { add: async (_name: string, payload: any) => { queued.push(payload); } };
  const result = await recoverPreventionActionTypesLocal(db, organizationId, true, queue as any, 50);
  assert.equal(result.queuedGroups, 2);
  assert.deepEqual(queued.map((payload) => payload.classificationLimit), [24, 1]);
});
