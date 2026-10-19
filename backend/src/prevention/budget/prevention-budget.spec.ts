import assert from 'node:assert/strict';
import test from 'node:test';
import { UnrecoverableError } from 'bullmq';
import { calculatePreventionBudget } from './prevention-budget.calculator';
import { appendMissingLockedBudgetLines, assertPreventionBudgetScenarioVersion, budgetPeriodPredicate, canReusePublishedGlobalRun, loadPreventionBudgetRawSourceVersion, loadPreventionBudgetSourceVersion, mergeGlobalBudgetSources, PreventionBudgetService, preventionBudgetJobId, preventionBudgetSourceKey, preventionBudgetStableRecommendationKey, selectGlobalBudgetRows, validatePreventionBudgetPayload } from './prevention-budget.service';
import { PREVENTION_BUDGET_GLOBAL_JOB, PREVENTION_BUDGET_RECALCULATE_ITEM_JOB, PREVENTION_BUDGET_RECALCULATE_JOB } from './prevention-budget.types';
import { budgetActionGroup } from './prevention-budget-grouping';
import { budgetClientActionKey, budgetClientIdentity } from './prevention-budget-client';
import { isWithinPreventionBulkWindow } from '../scheduler/prevention-bulk.config';
import { materializedActionScopeKey } from './prevention-budget-materialized';

const org = '11111111-1111-4111-8111-111111111111';
const scenario = '22222222-2222-4222-8222-222222222222';

test('Hyper Admin recovery reuses only a published global run with the same source snapshot', () => {
  assert.equal(canReusePublishedGlobalRun({ status: 'PUBLISHED', sourceVersion: 'source-v1' }, 'source-v1'), true);
  assert.equal(canReusePublishedGlobalRun({ status: 'PUBLISHED', sourceVersion: 'source-v1' }, 'source-v2'), false);
  assert.equal(canReusePublishedGlobalRun({ status: 'FAILED', sourceVersion: 'source-v1' }, 'source-v1'), false);
});

test('ALL budget worker predicates omit date filtering while bounded rows retain it', () => {
  assert.deepEqual(budgetPeriodPredicate('ALL', null, null), { sql: '', args: [] });
  assert.deepEqual(budgetPeriodPredicate('BOUNDED', '2026-01-01', '2026-12-31'), {
    sql: 'AND f.businessDate BETWEEN ? AND ?', args: ['2026-01-01', '2026-12-31'],
  });
  assert.throws(() => budgetPeriodPredicate('BOUNDED', null, null), UnrecoverableError);
});

test('global budget payloads require a tenant-scoped run and year', () => {
  const payload = validatePreventionBudgetPayload(PREVENTION_BUDGET_GLOBAL_JOB, {
    organizationId: org, runId: '44444444-4444-4444-8444-444444444444',
    scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'source-v1', year: 2026,
  });
  assert.equal(payload.runId, '44444444-4444-4444-8444-444444444444');
  assert.throws(() => validatePreventionBudgetPayload(PREVENTION_BUDGET_GLOBAL_JOB, {
    organizationId: org, runId: 'bad', scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'source-v1', year: 2026,
  }), UnrecoverableError);
});

test('bounded bulk budget payloads carry an execution mode and durable run identity', () => {
  const payload = validatePreventionBudgetPayload(PREVENTION_BUDGET_RECALCULATE_JOB, {
    organizationId: org, runId: '44444444-4444-4444-8444-444444444444', scenarioId: scenario,
    scenarioVersion: 1, sourceVersion: 'source-v1', executionMode: 'SCHEDULED',
  });
  assert.equal(payload.executionMode, 'SCHEDULED');
  assert.throws(() => validatePreventionBudgetPayload(PREVENTION_BUDGET_RECALCULATE_JOB, {
    organizationId: org, runId: '44444444-4444-4444-8444-444444444444', scenarioId: scenario,
    scenarioVersion: 1, sourceVersion: 'source-v1', executionMode: 'LATER',
  }), UnrecoverableError);
});

test('global consolidation uses MAX per client/action, preserves locked human lines and merges sources', () => {
  const rows = [
    { itemKey: 'client-a|action-x', totalHt: '100.00', status: 'ESTIME', year: 2024 },
    { itemKey: 'client-a|action-x', totalHt: '125.00', status: 'ESTIME', year: 2025 },
    { itemKey: 'client-b|action-y', totalHt: '999.00', status: 'ESTIME', year: 2024 },
    { itemKey: 'client-b|action-y', totalHt: '10.00', status: 'VALIDE', lockedManual: 1, year: 2025 },
  ];
  const previous = [{ itemKey: 'client-c|action-z', totalHt: '75.00', status: 'VALIDE', lockedManual: 1 }];
  const selected = selectGlobalBudgetRows(rows, previous);
  assert.deepEqual(selected.map((row) => [row.itemKey, row.totalHt]), [
    ['client-a|action-x', '125.00'], ['client-b|action-y', '10.00'], ['client-c|action-z', '75.00'],
  ]);
  const sources = mergeGlobalBudgetSources(
    [{ itemKey: 'client-a|action-x', sourceKind: 'REPORT', sourceKey: 'annual' }],
    [{ itemKey: 'client-a|action-x', sourceKind: 'REPORT', sourceKey: 'historical' }],
  );
  assert.deepEqual(sources.get('client-a|action-x')?.map((source) => source.sourceKey), ['annual', 'historical']);
});

test('global worker resumes a PROCESSING checkpoint idempotently', async () => {
  const runId = '44444444-4444-4444-8444-444444444444';
  const scenarioId = '55555555-5555-4555-8555-555555555555';
  const sourceRow = { reportCount: 1, reportUpdatedAt: '2026-01-01', findingCount: 2, findingCreatedAt: '2026-01-02', catalogVersion: 1 };
  const writes: string[] = [];
  let enforcedWindow: boolean | undefined;
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.dataSource = {
    query: async (sql: string) => {
      if (sql.includes('SELECT y.*,r.status')) return [{ id: 'year-row', status: 'PROCESSING', scenarioId: null, runStatus: 'PROCESSING', executionMode: 'IMMEDIATE' }];
      if (sql.includes('SELECT sourceVersion FROM prevention_budget_global_runs')) return [{ sourceVersion: await loadPreventionBudgetSourceVersion(service.dataSource, org) }];
      if (sql.includes('catalogVersion')) return [sourceRow];
      if (sql.includes('SELECT y.id,y.year,s.id scenarioId')) return [];
      writes.push(sql);
      return [];
    },
    transaction: async (callback: (manager: any) => Promise<any>) => callback({ query: async (sql: string) => {
      writes.push(sql);
      if (sql.includes('SELECT * FROM prevention_budget_global_years')) return [{ id: 'year-row', status: 'PROCESSING', scenarioId: null }];
      return [];
    } }),
  };
  service.bulkAdmission = {
    admit: async () => ({ admitted: true, lease: { organizationId: org, runId, workKind: 'BUDGET', leaseToken: 'lease' } }),
    withLease: async (_lease: any, operation: () => Promise<any>) => operation(),
    assertLease: async () => undefined,
    release: async () => undefined,
  };
  service.rebuildScenario = async (_payload: unknown, _action: unknown, _assert: unknown, options: { enforceWindow: boolean }) => {
    enforcedWindow = options.enforceWindow;
    return { id: scenarioId, version: 2 };
  };
  service.finalizeGlobalRun = async () => null;
  const result = await service.processGlobalYear({ organizationId: org, runId, scenarioId, scenarioVersion: 1, sourceVersion: 'source-v1', year: 2026 });
  assert.deepEqual(result, { id: scenarioId, version: 2 });
  assert.equal(enforcedWindow, false);
  assert.ok(writes.some((sql) => sql.includes("status='PROCESSING'")));
  assert.ok(writes.some((sql) => sql.includes("status='CALCULATED'")));
});

test('global worker publishes one atomic ALL scenario with MAX lines and preserves a later human action validation', async () => {
  const runId = '44444444-4444-4444-8444-444444444444';
  const annualRows = [
    { itemKey: 'client-a|action-x', totalHt: '100.00', status: 'ESTIME', year: 2024, categoryKey: 'CAT', title: 'Action', priority: 'HIGH', quantity: '1', unit: 'ACTION', unitCostHt: '100.00', clientKey: 'client-a', clientLabel: 'A', categoryId: null, catalogId: null, justification: null, aiEstimateDetails: null, adminPrompt: null, adminPromptActorId: null, priceSource: 'annual', lockedManual: 0 },
    { itemKey: 'client-a|action-x', totalHt: '125.00', status: 'ESTIME', year: 2025, categoryKey: 'CAT', title: 'Action', priority: 'HIGH', quantity: '1', unit: 'ACTION', unitCostHt: '125.00', clientKey: 'client-a', clientLabel: 'A', categoryId: null, catalogId: null, justification: null, aiEstimateDetails: null, adminPrompt: null, adminPromptActorId: null, priceSource: 'annual', lockedManual: 0 },
    { itemKey: 'client-b|action-y', totalHt: '500.00', status: 'ESTIME', year: 2024, categoryKey: 'CAT', title: 'Locked', priority: 'HIGH', quantity: '1', unit: 'ACTION', unitCostHt: '500.00', clientKey: 'client-b', clientLabel: 'B', categoryId: null, catalogId: null, justification: null, aiEstimateDetails: null, adminPrompt: null, adminPromptActorId: null, priceSource: 'annual', lockedManual: 0 },
    { itemKey: 'client-b|action-y', totalHt: '10.00', status: 'VALIDE', year: 2025, categoryKey: 'CAT', title: 'Locked', priority: 'HIGH', quantity: '1', unit: 'ACTION', unitCostHt: '10.00', clientKey: 'client-b', clientLabel: 'B', categoryId: null, catalogId: null, justification: null, aiEstimateDetails: null, adminPrompt: null, adminPromptActorId: null, priceSource: 'human', lockedManual: 1 },
  ];
  const sourceRows = [
    { itemKey: 'client-a|action-x', sourceKind: 'REPORT', sourceKey: 'r-annual', findingId: null, reportId: 'r1' },
    { itemKey: 'client-a|action-x', sourceKind: 'REPORT', sourceKey: 'r-history', findingId: null, reportId: 'r2' },
    { itemKey: 'client-b|action-y', sourceKind: 'REPORT', sourceKey: 'r-locked', findingId: null, reportId: 'r3' },
  ];
  const insertedItems: unknown[][] = [];
  const insertedSources: unknown[][] = [];
  const actionLock = { ...annualRows[1], id: 'human-action-item', scenarioKey: materializedActionScopeKey(org, 'client-a|action-x'), totalHt: '77.00',
    unitCostHt: '77.00', status: 'VALIDE', lockedManual: 1, priceSource: 'human', scenarioCreatedAt: '2026-09-01' };
  const disappearedActionLock = { ...actionLock, id: 'disappeared-action-item', itemKey: 'client-c|action-z',
    clientKey: 'client-c', clientLabel: 'C', scenarioKey: materializedActionScopeKey(org, 'client-c|action-z'), totalHt: '44.00', unitCostHt: '44.00' };
  const scopedMissionId = '30000000-0000-4000-8000-000000000001';
  const otherMissionId = '30000000-0000-4000-8000-000000000002';
  const scopedLock = { ...actionLock, id: 'scoped-human-item', actionMissionId: scopedMissionId,
    scenarioKey: materializedActionScopeKey(org, 'client-a|action-x', scopedMissionId) };
  const otherMissionLock = { ...scopedLock, id: 'other-mission-item', actionMissionId: otherMissionId,
    scenarioKey: materializedActionScopeKey(org, 'client-a|action-x', otherMissionId), totalHt: '999.00' };
  let runFilters = { clientKeys: [] as string[], categoryId: null, severity: null, missionId: null as string | null, contingencyRatePercent: '0.00' };
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.dataSource = {
    query: async (sql: string) => sql.includes('catalogVersion')
      ? [{ reportCount: 1, reportUpdatedAt: '2026-01-01', findingCount: 2, findingCreatedAt: '2026-01-02', catalogVersion: 1 }]
      : [],
    transaction: async (callback: (manager: any) => Promise<any>) => callback({ query: async (sql: string, args?: unknown[]) => {
      if (sql.includes('SELECT * FROM prevention_budget_global_runs')) return [{ id: runId, status: 'PROCESSING', scenarioKey: 'global-key', sourceVersion: await loadPreventionBudgetSourceVersion(service.dataSource, org), filters: JSON.stringify(runFilters), adminPrompt: null }];
      if (sql.includes("status<>'CALCULATED'")) return [];
      if (sql.includes('SELECT i.*,y.year')) return annualRows;
      if (sql.includes('SELECT s.*,i.itemKey')) return sourceRows;
      if (sql.includes('SELECT i.*,s.scenarioKey')) return runFilters.missionId ? [scopedLock, otherMissionLock] : [actionLock, disappearedActionLock];
      if (sql.includes('SELECT src.*,i.itemKey')) return [{ itemKey: 'client-a|action-x', sourceKind: 'REPORT', sourceKey: 'r-action-human', reportId: 'r4', findingId: null }];
      if (sql.includes("periodMode='ALL'")) return [];
      if (sql.includes('COALESCE(MAX(version)')) return [{ version: 0 }];
      if (sql.startsWith('INSERT INTO prevention_budget_items')) { insertedItems.push(args ?? []); return []; }
      if (sql.startsWith('INSERT IGNORE INTO prevention_budget_item_sources')) { insertedSources.push(args ?? []); return []; }
      return [];
    } }),
  };
  const result = await service.finalizeGlobalRun(org, runId);
  assert.equal(result?.version, 1);
  assert.deepEqual(insertedItems.map((args) => [args[3], args[14], args[15]]), [
    ['client-a|action-x', '77.00', 'VALIDE'], ['client-b|action-y', '10.00', 'VALIDE'], ['client-c|action-z', '44.00', 'VALIDE'],
  ]);
  assert.equal(insertedSources.length, 4);
  runFilters = { ...runFilters, missionId: scopedMissionId };
  insertedItems.length = 0;
  insertedSources.length = 0;
  await service.finalizeGlobalRun(org, runId);
  assert.deepEqual(insertedItems.map((args) => [args[3], args[14], args[15]]), [
    ['client-a|action-x', '77.00', 'VALIDE'], ['client-b|action-y', '10.00', 'VALIDE'],
  ]);
});

test('global worker fails closed when the source fingerprint changes', async () => {
  const runId = '44444444-4444-4444-8444-444444444444';
  const service: any = Object.create(PreventionBudgetService.prototype);
  const updates: string[] = [];
  service.dataSource = {
    query: async (sql: string) => {
      if (sql.includes('SELECT y.*,r.status')) return [{ id: 'year-row', status: 'PENDING', runStatus: 'PENDING', executionMode: 'SCHEDULED' }];
      if (sql.includes('SELECT sourceVersion FROM prevention_budget_global_runs')) return [{ sourceVersion: 'stale-source' }];
      if (sql.includes('catalogVersion')) return [{ reportCount: 9, reportUpdatedAt: '2026-02-01', findingCount: 9, findingCreatedAt: '2026-02-02', catalogVersion: 2 }];
      updates.push(sql);
      return [];
    },
  };
  await assert.rejects(() => service.processGlobalYear({
    organizationId: org, runId, scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'source-v1', year: 2026,
  }), UnrecoverableError);
  assert.ok(updates.some((sql) => sql.includes("status='FAILED'")));
});

test('global source fingerprint changes for in-place finding and catalogue mutations', async () => {
  let finding = { id: 'finding-1', content: 'Constat initial', actionType: 'PROTECTION', riskLevel: 'moyen' };
  let catalogue = { id: 'catalog-1', version: 1, label: 'Location', unitCostHt: '10.00', isActive: 1 };
  const db = { query: async (sql: string) => {
    if (sql.startsWith('SELECT id,snapshotId')) return [{ ...finding }];
    if (sql.includes('FROM prevention_cost_catalog')) return [{ ...catalogue }];
    return [{ reportCount: 1, reportUpdatedAt: '2026-01-01', findingCount: 1, findingCreatedAt: '2026-01-01', catalogVersion: catalogue.version }];
  } };
  const initial = await loadPreventionBudgetSourceVersion(db, org);
  finding = { ...finding, content: 'Constat modifié en place' };
  const findingChanged = await loadPreventionBudgetSourceVersion(db, org);
  catalogue = { ...catalogue, isActive: 0, label: 'Location désactivée' };
  const catalogueChanged = await loadPreventionBudgetSourceVersion(db, org);
  assert.notEqual(initial, findingChanged);
  assert.notEqual(findingChanged, catalogueChanged);
});

test('raw source fingerprint stays stable when group-derived action metadata changes', async () => {
  let finding = { id: 'finding-raw', content: 'Recommandation', actionType: 'PROTECTION', actionTypeVersion: 'v1', actionMetric: null as unknown };
  let photosHash = 'source-photo-v1';
  const db = { query: async (sql: string) => {
    if (sql.includes('SHA2(COALESCE(CAST(v.photos AS CHAR)')) return [{ id: 'report-raw', visitId: 'visit-raw', status: 'brouillon', photosHash }];
    if (sql.startsWith('SELECT id,snapshotId')) return [{ ...finding }];
    if (sql.includes('FROM prevention_cost_catalog')) return [];
    return [{ reportCount: 1, reportUpdatedAt: '2026-01-01', findingCount: 1, findingCreatedAt: '2026-01-01', catalogVersion: 0 }];
  } };
  const initial = await loadPreventionBudgetRawSourceVersion(db, org);
  finding = { ...finding, actionType: 'waste-management', actionTypeVersion: 'v2', actionMetric: { quantity: '2', unit: 'UNITE' }, content: 'Derived reindex' };
  const derivedChanged = await loadPreventionBudgetRawSourceVersion(db, org);
  assert.equal(initial, derivedChanged);
  photosHash = 'source-photo-v2';
  assert.notEqual(initial, await loadPreventionBudgetRawSourceVersion(db, org));
});

test('global estimate checkpoint resumes a partial page without re-estimating completed reports', async () => {
  const completed = { itemKey: 'item-1', reportId: 'report-1', sourceVersion: 'source-v1', estimate: JSON.stringify({ totalHt: '100.00' }) };
  const calls: string[][] = [];
  const writes: string[] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  const currentHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  service.bulkAdmission = { settings: { windowStartHour: (currentHour + 23) % 24, windowEndHour: (currentHour + 1) % 24 }, };
  service.estimateAi = { estimate: async (inputs: Array<any>) => {
    calls.push(inputs.map((input) => input.reportId));
    return new Map(inputs.map((input) => [input.itemKey, { totalHt: '200.00' }]));
  } };
  service.dataSource = {
    query: async (sql: string) => sql.includes('FROM prevention_budget_global_estimates') ? [completed] : [],
    transaction: async (callback: (manager: any) => Promise<any>) => callback({ query: async (sql: string) => { writes.push(sql); return []; } }),
  };
  const result = await service.estimateGlobalReportInputs([
    { itemKey: 'item-1', reportId: 'report-1', organizationId: org },
    { itemKey: 'item-2', reportId: 'report-2', organizationId: org },
  ], { organizationId: org, runId: '44444444-4444-4444-8444-444444444444', year: 2026, checkpointId: 'year-1', sourceVersion: 'source-v1', assertSourceStable: async () => undefined, storage: 'GLOBAL', enforceWindow: true });
  assert.deepEqual(calls, [['report-2']]);
  assert.equal(result.size, 2);
  assert.ok(writes.some((sql) => sql.includes('prevention_budget_global_estimates')));
  assert.ok(writes.some((sql) => sql.includes('estimateCursor')));
});

test('scheduled bounded budget uses the same durable estimate pages', async () => {
  const calls: string[][] = [];
  const writes: string[] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.bulkAdmission = { settings: { windowStartHour: 0, windowEndHour: 1 } };
  service.estimateAi = { estimate: async (inputs: Array<any>) => {
    calls.push(inputs.map((input) => input.reportId));
    return new Map(inputs.map((input) => [input.itemKey, { totalHt: '80.00' }]));
  } };
  service.dataSource = {
    query: async (sql: string) => sql.includes('prevention_budget_estimate_checkpoints') ? [] : [],
    transaction: async (callback: (manager: any) => Promise<any>) => callback({ query: async (sql: string) => { writes.push(sql); return []; } }),
  };
  const result = await service.estimateGlobalReportInputs([
    { itemKey: 'item-b1', reportId: 'report-b1' },
    { itemKey: 'item-b2', reportId: 'report-b2' },
  ], { organizationId: org, runId: '66666666-6666-4666-8666-666666666666', scenarioId: scenario, year: 0, checkpointId: scenario, sourceVersion: 'bounded-v1', assertSourceStable: async () => undefined, storage: 'BOUNDED', enforceWindow: false });
  assert.deepEqual(calls, [['report-b1', 'report-b2']]);
  assert.equal(result.size, 2);
  assert.ok(writes.some((sql) => sql.includes('prevention_budget_estimate_checkpoints')));
  assert.ok(writes.some((sql) => sql.includes('UPDATE prevention_budget_scenarios')));
});

test('global budget window rolls over at 06:00 Europe/Paris', () => {
  const settings = { windowStartHour: 22, windowEndHour: 6 } as any;
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-01-15T04:59:00.000Z'), settings), true);
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-01-15T05:00:00.000Z'), settings), false);
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-07-15T03:59:00.000Z'), settings), true);
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-07-15T04:00:00.000Z'), settings), false);
});

test('window suspension schedules a fresh continuation without retrying the active BullMQ job', async () => {
  let queued: any = null;
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.bulkQueue = { add: async (...args: any[]) => { queued = args; return { id: args[2].jobId }; } };
  const payload = { organizationId: org, scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'scheduled-v1', runId: '77777777-7777-4777-8777-777777777777', executionMode: 'SCHEDULED' };
  const next = new Date(Date.now() + 60_000);
  await service.enqueueBudgetContinuation(PREVENTION_BUDGET_RECALCULATE_JOB, payload, next);
  assert.equal(queued[0], PREVENTION_BUDGET_RECALCULATE_JOB);
  assert.equal(queued[1], payload);
  assert.equal(queued[2].attempts, 4);
  assert.ok(String(queued[2].jobId).includes('-resume-'));
  assert.ok(queued[2].delay >= 1_000);
});

test('window suspension persists the global checkpoint and run availability', async () => {
  const updates: string[] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.dataSource = { query: async (sql: string) => { updates.push(sql); return []; } };
  await service.suspendGlobalCheckpoint({ organizationId: org, scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'source-v1', runId: '88888888-8888-4888-8888-888888888888', year: 2026 }, '2026-10-07T20:00:00.000Z');
  assert.ok(updates.some((sql) => sql.includes("status='SUSPENDED'") && sql.includes('prevention_budget_global_years')));
  assert.ok(updates.some((sql) => sql.includes("status='SUSPENDED'") && sql.includes('prevention_budget_global_runs')));
});

test('budget calculation is deterministic to the cent and excludes unpriced lines', () => {
  const result = calculatePreventionBudget([
    {
      itemKey: 'a'.repeat(64), title: 'Garde-corps', categoryId: null, categoryKey: 'PROTECTION',
      priority: 'HIGH', quantity: '2', unit: 'ACTION',
      catalogMatch: { id: '33333333-3333-4333-8333-333333333333', unitCostHt: '125.50', priceSource: 'Devis D-1' },
    },
    {
      itemKey: 'b'.repeat(64), title: 'Accès', categoryId: null, categoryKey: 'CIRCULATION',
      priority: 'MEDIUM', quantity: '1', unit: 'ACTION', catalogMatch: null,
    },
  ], '10.00');
  assert.equal(result.lines[0].totalHt, '251.00');
  assert.equal(result.lines[1].status, 'A_CHIFFRER');
  assert.equal(result.totals.retainedBudgetHt, '251.00');
  assert.equal(result.totals.contingencyRatePercent, '0.00');
  assert.equal(result.totals.contingencyAmountHt, '0.00');
  assert.equal(result.totals.totalBudgetHt, '251.00');
});

test('locked manual values and statuses survive recalculation', () => {
  const priorEstimate = { kind: 'AI_ESTIMATE', rationale: 'Justification initiale' };
  const result = calculatePreventionBudget([{
    itemKey: 'a'.repeat(64), title: 'Action validée', categoryId: null, categoryKey: 'SECURITE',
    priority: 'LOW', quantity: '1', unit: 'ACTION', catalogMatch: null,
    manual: { quantity: '3', unit: 'FORFAIT', unitCostHt: '99.99', priceSource: 'Devis signé DS-1', status: 'VALIDE', priority: 'URGENT', aiEstimateDetails: priorEstimate },
  }], '0.00');
  assert.deepEqual(result.lines[0], {
    itemKey: 'a'.repeat(64), title: 'Action validée', categoryId: null, categoryKey: 'SECURITE',
    clientKey: null, clientLabel: null,
    priority: 'URGENT', quantity: '3', unit: 'FORFAIT', unitCostHt: '99.99', totalHt: '299.97',
    status: 'VALIDE', priceSource: 'Devis signé DS-1', lockedManual: true, aiEstimateDetails: priorEstimate,
  });
  assert.equal(result.totals.validatedBudgetHt, '299.97');
});

test('locked lines survive when their analytical source has disappeared', () => {
  const inputs = appendMissingLockedBudgetLines([], [{
    itemKey: 'c'.repeat(64), title: 'Action engagée', categoryId: null, categoryKey: 'SECURITE',
    priority: 'HIGH', quantity: '2.0000', unit: 'FORFAIT', unitCostHt: '80.00',
    priceSource: 'Commande C-1', status: 'ENGAGE', justification: 'Conservée après suppression',
  }]);
  const result = calculatePreventionBudget(inputs, '0.00');
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].status, 'ENGAGE');
  assert.equal(result.lines[0].totalHt, '160.00');
  assert.equal(result.lines[0].lockedManual, true);
});

test('an explicitly locked ESTIME line survives recalculation', () => {
  const result = calculatePreventionBudget([{
    itemKey: 'e'.repeat(64), title: 'Action estimée verrouillée', categoryId: null, categoryKey: 'SECURITE',
    priority: 'MEDIUM', quantity: '1', unit: 'FORFAIT', catalogMatch: null,
    manual: { quantity: '2', unit: 'FORFAIT', unitCostHt: '45.00', priceSource: 'Devis E-1', status: 'ESTIME', priority: 'MEDIUM', lockedManual: true },
  }], '10.00');
  assert.equal(result.lines[0].status, 'ESTIME');
  assert.equal(result.lines[0].lockedManual, true);
  assert.equal(result.lines[0].totalHt, '90.00');
});

test('AI estimates feed only the estimated total and preserve their explanation', () => {
  const details = { kind: 'AI_ESTIMATE', rationale: 'Location et pose de protections collectives' };
  const result = calculatePreventionBudget([{
    itemKey: 'f'.repeat(64), title: 'Installer un garde-corps', categoryId: null, categoryKey: 'HAUTEUR',
    priority: 'HIGH', quantity: '1', unit: 'FORFAIT', catalogMatch: { id: 'catalog', unitCostHt: '1.00', priceSource: 'Catalogue historique' },
    aiEstimate: { quantity: '2', unit: 'JOUR', unitCostHt: '180.00', totalHt: '360.00', details },
  }], '10.00');
  assert.equal(result.lines[0].totalHt, '360.00');
  assert.equal(result.lines[0].unit, 'JOUR');
  assert.equal(result.lines[0].status, 'ESTIME');
  assert.equal(result.lines[0].priceSource, 'Estimation IA — indicative, à valider');
  assert.deepEqual(result.lines[0].aiEstimateDetails, details);
  assert.equal(result.totals.estimatedBudgetHt, '360.00');
  assert.equal(result.totals.validatedBudgetHt, '0.00');
});

test('budget job payload contains only tenant identifiers and versions', () => {
  const payload = validatePreventionBudgetPayload(PREVENTION_BUDGET_RECALCULATE_JOB, {
    organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-2',
  });
  assert.equal(payload.scenarioVersion, 2);
  assert.throws(() => validatePreventionBudgetPayload(PREVENTION_BUDGET_RECALCULATE_JOB, {
    organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-2', content: 'secret',
  }), (error: unknown) => error instanceof UnrecoverableError);
});

test('targeted budget job payload requires a tenant-scoped item identifier', () => {
  const payload = validatePreventionBudgetPayload(PREVENTION_BUDGET_RECALCULATE_ITEM_JOB, {
    organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-2',
    itemId: '33333333-3333-4333-8333-333333333333',
  });
  assert.equal(payload.itemId, '33333333-3333-4333-8333-333333333333');
  assert.throws(() => validatePreventionBudgetPayload(PREVENTION_BUDGET_RECALCULATE_ITEM_JOB, {
    organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-2',
  }), UnrecoverableError);
  assert.throws(() => validatePreventionBudgetPayload(PREVENTION_BUDGET_RECALCULATE_ITEM_JOB, {
    organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-2', itemId: 'not-a-uuid',
  }), UnrecoverableError);
});


test('budget job identifiers are deterministic and isolate tenants/scenarios', () => {
  const payload = { organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-2' };
  assert.equal(preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, payload), preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, payload));
  assert.notEqual(preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, payload), preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, { ...payload, organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
});

test('scenario versions and source keys are validated deterministically', () => {
  assert.doesNotThrow(() => assertPreventionBudgetScenarioVersion(3, 3));
  assert.throws(() => assertPreventionBudgetScenarioVersion(3, 2), UnrecoverableError);
  assert.equal(preventionBudgetSourceKey('RECOMMENDATION', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001').length, 64);
});

test('worker materializes chantier, category and severity scope on recalculation', async () => {
  const insertArgs: unknown[][] = [];
  const findingQueries: Array<{ sql: string; args: unknown[] }> = [];
  const base = {
    id: scenario, organizationId: org, scenarioKey: 'scenario-key', version: 2, sourceVersion: 'source-v2',
    periodStart: '2026-01-01', periodEnd: '2026-01-31', missionId: '33333333-3333-4333-8333-333333333333',
    categoryId: '44444444-4444-4444-8444-444444444444', severity: 'critique', contingencyRatePercent: '10.00',
  };
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes('WHERE id=? AND organizationId=? FOR UPDATE')) return [base];
    if (sql.includes('sourceVersion=?')) return [];
    if (sql.includes('ORDER BY version DESC LIMIT 1 FOR UPDATE')) return [base];
    if (sql.includes('FROM prevention_findings')) return [];
    if (sql.includes('FROM prevention_cost_catalog')) return [];
    if (sql.includes('FROM prevention_budget_items')) return [];
    if (sql.includes('FROM prevention_budget_item_sources')) return [];
    if (sql.includes('INSERT INTO prevention_budget_scenarios')) { insertArgs.push(args); return []; }
    return [];
  } };
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.config = { get: (_name: string, fallback: string) => fallback };
  service.dataSource = {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return [base];
      if (sql.includes('sourceVersion=?')) return [];
      if (sql.includes('ORDER BY version DESC LIMIT 1')) return [base];
      if (sql.includes('FROM prevention_findings')) { findingQueries.push({ sql, args }); return []; }
      if (sql.includes('FROM prevention_cost_catalog')) return [];
      if (sql.includes('FROM prevention_budget_items')) return [];
      if (sql.includes('FROM prevention_budget_item_sources')) return [];
      return [];
    },
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager),
  };
  await service.rebuildScenario({ organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-v3' }, 'RECALCULATE');
  assert.equal(insertArgs.length, 1);
  assert.equal(insertArgs[0][7], 'BOUNDED');
  assert.equal(insertArgs[0][8], base.missionId);
  assert.equal(insertArgs[0][9], base.categoryId);
  assert.equal(insertArgs[0][10], 'critique');
  assert.match(findingQueries[0].sql, /COALESCE\(\(SELECT MAX\(ps.score\)/);
  assert.equal(findingQueries[0].args.at(-1), 80);
});

test('worker groups one client action and retains the maximum of its report estimates', async () => {
  const reportA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const reportB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const findings = [
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reportId: reportA, patternKey: 'a'.repeat(64), normalizedKey: 'a'.repeat(64), content: 'Installer des garde-corps complets autour de la trémie.', categoryId: null, categoryKey: 'Hauteur', riskLevel: 'eleve', actionType: 'height-protection', client: 'EDF' },
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reportId: reportB, patternKey: 'b'.repeat(64), normalizedKey: 'b'.repeat(64), content: 'Mettre en place un platelage stable et fixé pour protéger la trémie.', categoryId: null, categoryKey: 'Hauteur', riskLevel: 'eleve', actionType: 'height-protection', client: 'EDF' },
  ];
  const base = { id: scenario, organizationId: org, scenarioKey: 'scenario-key', version: 1, sourceVersion: 'original', periodStart: '2026-01-01', periodEnd: '2026-12-31', missionId: null, categoryId: null, contingencyRatePercent: '0.00' };
  const insertedItems: unknown[][] = [];
  const insertedSources: unknown[][] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.config = { get: (_name: string, fallback: string) => fallback };
  service.estimateAi = { estimate: async (requests: Array<{ itemKey: string; reportId: string; reportCount: number; occurrenceCount: number }>) => {
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.reportCount === 1 && request.occurrenceCount === 1));
    return new Map(requests.map((request) => {
      const amount = request.reportId === reportA ? '100.00' : '180.00';
      return [request.itemKey, { quantity: '1', unit: 'FORFAIT', unitCostHt: amount, totalHt: amount,
        details: { kind: 'AI_ESTIMATE', rangeLowHt: amount, rangeHighHt: amount, rationale: 'Estimation par rapport.' } }];
    }));
  } };
  service.dataSource = {
    query: async (sql: string) => {
      if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return [base];
      if (sql.includes('sourceVersion=?')) return [];
      if (sql.includes('ORDER BY version DESC LIMIT 1')) return [base];
      if (sql.includes("f.findingType='RECOMMENDATION'")) return findings;
      return [];
    },
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback({ query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('WHERE id=? AND organizationId=? FOR UPDATE')) return [base];
      if (sql.includes('sourceVersion=?')) return [];
      if (sql.includes('ORDER BY version DESC LIMIT 1 FOR UPDATE')) return [base];
      if (sql.includes('INSERT INTO prevention_budget_items')) insertedItems.push(args);
      if (sql.includes('INSERT INTO prevention_budget_item_sources')) insertedSources.push(args);
      return [];
    } }),
  };
  await service.rebuildScenario({ organizationId: org, scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'grouping-v1' }, 'RECALCULATE');
  assert.equal(insertedItems.length, 1);
  assert.equal(insertedItems[0][9], 'Protections collectives contre les chutes');
  assert.equal(insertedItems[0][8], 'EDF');
  assert.equal(insertedItems[0][14], '180.00');
  assert.equal(insertedSources.length, 2);
  assert.deepEqual(new Set(insertedSources.map((args) => args[5])), new Set([reportA, reportB]));
});

test('targeted worker reapplies the admin prompt to every report of one client/action, retains the maximum and preserves other lines', async () => {
  const targetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const lockedId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const reportId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const secondReportId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const base = { id: scenario, organizationId: org, scenarioKey: 'scenario-key', version: 4, sourceVersion: 'source-v4', status: 'DRAFT', periodStart: '2026-01-01', periodEnd: '2026-12-31', contingencyRatePercent: '0.00', clientKeys: null, adminPrompt: null, adminPromptActorId: null };
  const target = { id: targetId, organizationId: org, scenarioId: scenario, itemKey: budgetClientActionKey(budgetClientIdentity('EDF').key, budgetActionGroup({ categoryKey: 'Hauteur', content: 'Installer un garde-corps autour de la trémie.', actionType: 'height-protection' }).itemKey), title: 'Protections collectives contre les chutes', categoryId: null, categoryKey: 'Hauteur', clientKey: budgetClientIdentity('EDF').key, clientLabel: 'EDF', priority: 'HIGH', quantity: '1', unit: 'ACTION', unitCostHt: null, totalHt: '0.00', status: 'A_CHIFFRER', justification: 'Initial', aiEstimateDetails: null, adminPrompt: 'Sécuriser rapidement', adminPromptActorId: 'admin', priceSource: null, lockedManual: 0 };
  const other = { id: otherId, organizationId: org, scenarioId: scenario, itemKey: 'b'.repeat(64), title: 'Autre action', categoryId: null, categoryKey: 'Organisation', clientKey: 'client-a', clientLabel: 'EDF', priority: 'MEDIUM', quantity: '1', unit: 'FORFAIT', unitCostHt: '50.00', totalHt: '50.00', status: 'ESTIME', justification: 'Conserver', aiEstimateDetails: { kind: 'AI_ESTIMATE' }, adminPrompt: null, adminPromptActorId: null, priceSource: 'Estimation IA — indicative, à valider', lockedManual: 0 };
  const locked = { id: lockedId, organizationId: org, scenarioId: scenario, itemKey: 'c'.repeat(64), title: 'Montant validé', categoryId: null, categoryKey: 'EPI', clientKey: 'client-b', clientLabel: 'ENGIE', priority: 'HIGH', quantity: '2', unit: 'FORFAIT', unitCostHt: '150.00', totalHt: '300.00', status: 'VALIDE', justification: 'Ne pas toucher', aiEstimateDetails: null, adminPrompt: null, adminPromptActorId: null, priceSource: 'Devis validé', lockedManual: 1 };
  const targetSource = { itemId: targetId, sourceKind: 'RECOMMENDATION', findingId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', reportId };
  const secondSource = { itemId: targetId, sourceKind: 'RECOMMENDATION', findingId: '99999999-9999-4999-8999-999999999999', reportId: secondReportId };
  const finding = { id: targetSource.findingId, reportId, sourceGroupId: 'group-a', normalizedKey: 'finding-a', patternKey: 'pattern-a', client: 'EDF', content: 'Installer un garde-corps complet autour de la trémie.', categoryId: null, categoryKey: 'Hauteur', actionType: 'height-protection', actionMetric: null, riskLevel: 'eleve' };
  const secondFinding = { ...finding, id: secondSource.findingId, reportId: secondReportId, sourceGroupId: 'group-b', normalizedKey: 'finding-b', patternKey: 'pattern-b', content: 'Installer un garde-corps autour de la deuxième trémie.' };
  const foreignClientFinding = { ...secondFinding, id: '88888888-8888-4888-8888-888888888888', client: 'ENGIE' };
  const insertedItems: unknown[][] = []; const insertedSources: unknown[][] = []; const aiInputs: any[] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.config = { get: (_name: string, fallback: string) => fallback };
  service.estimateAi = { estimate: async (inputs: any[]) => {
    aiInputs.push(...inputs);
    return new Map(inputs.map((input) => {
      const amount = input.reportId === secondReportId ? '200.00' : '120.00';
      return [input.itemKey, { quantity: '1', unit: 'FORFAIT', unitCostHt: amount, totalHt: amount, details: { kind: 'AI_ESTIMATE', rangeLowHt: amount, rangeHighHt: amount, rationale: `Protection collective du rapport ${input.reportId}.` } }];
    }));
  } };
  const query = async (sql: string, args: unknown[] = []) => {
    if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return [base];
    if (sql.includes('sourceVersion=?')) return [];
    if (sql.includes('FROM prevention_budget_items WHERE id=?')) return [target];
    if (sql.startsWith('SELECT findingId,reportId FROM prevention_budget_item_sources')) return [targetSource];
    if (sql.includes('JOIN prevention_findings f')) return [finding];
    if (sql.includes('FROM prevention_findings f')) {
      assert.match(sql, /f\.organizationId=\?/);
      assert.match(sql, /f\.businessDate BETWEEN \? AND \?/);
      return [finding, secondFinding, foreignClientFinding];
    }
    return [];
  };
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes('WHERE id=? AND organizationId=? FOR UPDATE')) return [base];
    if (sql.includes('ORDER BY version DESC LIMIT 1 FOR UPDATE')) return [base];
    if (sql.includes('sourceVersion=?')) return [];
    if (sql.includes('FROM prevention_budget_items WHERE organizationId=? AND scenarioId=? ORDER BY')) return [target, other, locked];
    if (sql.includes('FROM prevention_budget_item_sources WHERE organizationId=? AND itemId IN')) return [targetSource];
    if (sql.startsWith('INSERT INTO prevention_budget_items')) { insertedItems.push(args); return []; }
    if (/INSERT(?: IGNORE)? INTO prevention_budget_item_sources/.test(sql)) { insertedSources.push(args); return []; }
    return [];
  } };
  service.dataSource = { query, transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) };
  const result = await service.recalculateScenarioItem({ organizationId: org, scenarioId: scenario, scenarioVersion: 4, sourceVersion: 'target-v1', itemId: targetId });
  assert.equal(aiInputs.length, 2);
  assert.deepEqual(new Set(aiInputs.map((input) => input.reportId)), new Set([reportId, secondReportId]));
  assert.ok(aiInputs.every((input) => input.adminPrompt === target.adminPrompt));
  assert.equal(insertedItems.length, 3);
  const targetInsert = insertedItems.find((args) => args[3] === target.itemKey)!;
  const otherInsert = insertedItems.find((args) => args[3] === other.itemKey)!;
  const lockedInsert = insertedItems.find((args) => args[3] === locked.itemKey)!;
  assert.equal(targetInsert[14], '200.00');
  assert.equal(otherInsert[14], other.totalHt);
  assert.equal(lockedInsert[14], locked.totalHt);
  assert.equal(lockedInsert[15], locked.status);
  assert.equal(lockedInsert[21], 1);
  assert.equal(insertedSources.length, 2);
  assert.equal(result.version, 5);
});

test('targeted worker fails closed when a recommendation source disappeared', async () => {
  const base = { id: scenario, organizationId: org, scenarioKey: 'scenario-key', version: 4, sourceVersion: 'source-v4', status: 'DRAFT', periodStart: '2026-01-01', periodEnd: '2026-12-31', contingencyRatePercent: '0.00' };
  const target = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', scenarioId: scenario, itemKey: 'a'.repeat(64), status: 'ESTIME', lockedManual: 0 };
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.dataSource = { query: async (sql: string) => {
    if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return [base];
    if (sql.includes('sourceVersion=?')) return [];
    if (sql.includes('FROM prevention_budget_items WHERE id=?')) return [target];
    if (sql.startsWith('SELECT findingId,reportId FROM prevention_budget_item_sources')) return [{ findingId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }];
    if (sql.includes('JOIN prevention_findings f')) return [];
    return [];
  } };
  await assert.rejects(() => service.recalculateScenarioItem({ organizationId: org, scenarioId: scenario, scenarioVersion: 4, sourceVersion: 'target-v2', itemId: target.id }), UnrecoverableError);
});

test('a validated client action keeps one line, its human amount and all new report sources', async () => {
  const first = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sourceGroupId: 'group-a', patternKey: 'a'.repeat(64), normalizedKey: 'a'.repeat(64), content: 'Installer des garde-corps complets autour de la trémie.', categoryId: null, categoryKey: 'Hauteur', riskLevel: 'eleve', actionType: 'height-protection' };
  const second = { ...first, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reportId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', patternKey: 'b'.repeat(64), normalizedKey: 'b'.repeat(64), content: 'Mettre en place un platelage stable et fixé pour protéger la trémie.' };
  const lockedKey = budgetClientActionKey(budgetClientIdentity(null).key, budgetActionGroup(first).itemKey);
  const old = { itemKey: lockedKey, title: 'Protections collectives contre les chutes', categoryId: null, categoryKey: 'Hauteur', priority: 'HIGH', quantity: '1', unit: 'FORFAIT', unitCostHt: '700.00', status: 'VALIDE', priceSource: 'Devis confirmé', lockedManual: 1, justification: 'Validation humaine', catalogId: null, aiEstimateDetails: null };
  // The finding UUID changed during reindexing, but its source identity did not.
  const source = { itemKey: lockedKey, sourceKind: 'RECOMMENDATION', sourceKey: preventionBudgetStableRecommendationKey(first), findingId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', reportId: first.reportId };
  const base = { id: scenario, organizationId: org, scenarioKey: 'scenario-key', version: 2, sourceVersion: 'previous', periodStart: '2026-01-01', periodEnd: '2026-12-31', missionId: null, categoryId: null, contingencyRatePercent: '0.00' };
  const items: unknown[][] = [];
  const links: unknown[][] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.config = { get: (_name: string, fallback: string) => fallback };
  service.estimateAi = { estimate: async () => { throw new Error('A locked amount must not be re-estimated'); } };
  service.dataSource = {
    query: async (sql: string) => {
      if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return [base];
      if (sql.includes('sourceVersion=?')) return [];
      if (sql.includes('ORDER BY version DESC LIMIT 1')) return [base];
      if (sql.includes("f.findingType='RECOMMENDATION'")) return [first, second];
      if (sql.includes('SELECT * FROM prevention_budget_items')) return [old];
      if (sql.includes('SELECT s.*,i.itemKey')) return [source];
      return [];
    },
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback({ query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('WHERE id=? AND organizationId=? FOR UPDATE')) return [base];
      if (sql.includes('sourceVersion=?')) return [];
      if (sql.includes('ORDER BY version DESC LIMIT 1 FOR UPDATE')) return [base];
      if (sql.includes('INSERT INTO prevention_budget_items')) items.push(args);
      if (/INSERT(?: IGNORE)? INTO prevention_budget_item_sources/.test(sql)) links.push(args);
      return [];
    } }),
  };
  await service.rebuildScenario({ organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'grouping-v2' }, 'RECALCULATE');
  assert.equal(items.length, 1);
  assert.equal(items[0][3], lockedKey);
  assert.equal(items[0][14], '700.00');
  assert.equal(items[0][15], 'VALIDE');
  assert.equal(items[0][19], 1);
  const itemForReport = new Map(links.map((args) => [args[args.length - 1], args[2]]));
  assert.deepEqual(new Set(itemForReport.keys()), new Set([first.reportId, second.reportId]));
  assert.equal(new Set(itemForReport.values()).size, 1);
});

test('deleted report budget links are discovered without an SPS transaction write', async () => {
  const service: any = Object.create(PreventionBudgetService.prototype);
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  service.dataSource = { query: async (sql: string, args: unknown[]) => {
    queries.push({ sql, args });
    if (sql.includes('FROM prevention_budget_item_sources src')) return [{
      reportId: 'report-deleted', scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-v2',
    }];
    return [];
  } };
  let processed = 0;
  service.processDeletionReconciliation = async () => { processed += 1; return 1; };
  assert.equal(await service.reconcileOrphanedReportSources(org, 'report-deleted'), 1);
  assert.equal(processed, 1);
  assert.match(queries[0].sql, /LEFT JOIN reports r/);
  assert.match(queries[1].sql, /INSERT INTO prevention_budget_reconciliation_intents/);
  assert.equal(queries[1].args[1], org);
});

test('report changes target only budget scopes matching their mission, category and severity', async () => {
  const service: any = Object.create(PreventionBudgetService.prototype);
  let sql = ''; let args: unknown[] = [];
  service.dataSource = { query: async (statement: string, values: unknown[]) => {
    sql = statement; args = values; return [];
  } };
  const targets = await service.captureReconcileTargetsForReport(org, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.deepEqual(targets, []);
  assert.match(sql, /s\.missionId IS NULL OR f\.missionId=s\.missionId/);
  assert.match(sql, /s\.categoryId IS NULL OR f\.categoryId=s\.categoryId/);
  assert.match(sql, /s\.severity IS NULL OR s\.severity=CASE/);
  assert.deepEqual(args, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', org]);
});

test('terminal targeted worker failure marks its draft retryable', async () => {
  const updates: string[] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.activation = undefined;
  service.dataSource = { query: async (sql: string) => {
    if (sql.startsWith('UPDATE prevention_budget_scenarios')) updates.push(sql);
    return [];
  } };
  const job = {
    name: PREVENTION_BUDGET_RECALCULATE_ITEM_JOB,
    data: { organizationId: org, scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'retry-v1', itemId: '33333333-3333-4333-8333-333333333333' },
    attemptsMade: 3,
    opts: { attempts: 4 },
  } as any;
  await assert.rejects(() => service.process(job), UnrecoverableError);
  assert.equal(updates.length, 1);
  assert.match(updates[0], /failedAt=COALESCE/);
});

test('a retryable targeted worker failure is not marked before its final attempt', async () => {
  const updates: string[] = [];
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.activation = undefined;
  service.dataSource = { query: async (sql: string) => {
    if (sql.startsWith('SELECT id FROM prevention_budget_items')) return [{ id: '33333333-3333-4333-8333-333333333333' }];
    if (sql.startsWith('UPDATE prevention_budget_scenarios')) updates.push(sql);
    return [];
  } };
  service.recalculateScenarioItem = async () => { throw new Error('Transient estimator failure'); };
  const job = {
    name: PREVENTION_BUDGET_RECALCULATE_ITEM_JOB,
    data: { organizationId: org, scenarioId: scenario, scenarioVersion: 1, sourceVersion: 'retry-v2', itemId: '33333333-3333-4333-8333-333333333333' },
    attemptsMade: 0,
    opts: { attempts: 4 },
  } as any;
  await assert.rejects(() => service.process(job), /Transient estimator failure/);
  assert.equal(updates.length, 0);
});
