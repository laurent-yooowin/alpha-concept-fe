import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetReportEstimateInputHash, parseBudgetReportEstimate } from './prevention-budget-report-estimate';
import type { PreventionBudgetEstimateInput } from './prevention-budget-estimation-ai.service';
import { PreventionBudgetService } from './prevention-budget.service';
import { UnrecoverableError } from 'bullmq';

const input: PreventionBudgetEstimateInput = {
  itemKey: 'report-action', pricingCohortKey: 'client-action', reportId: 'report-a',
  title: 'Protection collective', categoryKey: 'Hauteur', priority: 'HIGH',
  occurrenceCount: 2, reportCount: 1,
  recommendations: ['Sécuriser la trémie', 'Installer un garde-corps'],
  metricEvidence: [{ quantity: '2', unit: 'unités', basis: 'trémies', confidence: 80 }],
  adminPrompt: null, catalogReference: null,
};

test('report estimate identity ignores finding order and prompt but separates source and client-action', () => {
  const hash = budgetReportEstimateInputHash(input);
  assert.equal(hash, budgetReportEstimateInputHash({ ...input, recommendations: [...input.recommendations].reverse() }));
  assert.notEqual(hash, budgetReportEstimateInputHash({ ...input, reportId: 'report-b' }));
  assert.notEqual(hash, budgetReportEstimateInputHash({ ...input, pricingCohortKey: 'other-client-action' }));
  assert.equal(hash, budgetReportEstimateInputHash({ ...input, adminPrompt: 'Autre prix' }));
  assert.notEqual(hash, budgetReportEstimateInputHash({ ...input, metricEvidence: [] }));
});

test('only complete persisted AI estimates are reusable', () => {
  assert.equal(parseBudgetReportEstimate('{invalid'), null);
  assert.equal(parseBudgetReportEstimate({ totalHt: '100.00' }), null);
  assert.equal(parseBudgetReportEstimate({ quantity: '1', unitCostHt: '100.00', totalHt: '100.00', details: { kind: 'AI_ESTIMATE' } })?.totalHt, '100.00');
});

test('automatic reconciliation reuses a matching report price; explicit recalculation refreshes it', async () => {
  const cached = { quantity: '1', unit: 'FORFAIT', unitCostHt: '100.00', totalHt: '100.00', details: { kind: 'AI_ESTIMATE' } };
  const fresh = { ...cached, unitCostHt: '120.00', totalHt: '120.00' };
  let calls = 0;
  const service: any = Object.create(PreventionBudgetService.prototype);
  service.dataSource = { query: async () => [{ id: 'cached-id', estimate: JSON.stringify(cached) }] };
  service.estimateAi = { estimate: async () => { calls++; return new Map([[input.itemKey, fresh]]); } };
  const automatic = await service.prepareReportEstimates('tenant-a', [input], false);
  assert.equal(automatic.estimates.get(input.itemKey)?.totalHt, '100.00');
  assert.equal(automatic.prepared[0].fresh, false);
  assert.equal(calls, 0);
  const explicit = await service.prepareReportEstimates('tenant-a', [input], true);
  assert.equal(explicit.estimates.get(input.itemKey)?.totalHt, '120.00');
  assert.equal(explicit.prepared[0].fresh, true);
  assert.equal(calls, 1);
});

test('older recalculation cannot publish over a newer report price', async () => {
  const service: any = Object.create(PreventionBudgetService.prototype);
  let inserted = false;
  const manager = { query: async (sql: string) => {
    if (sql.startsWith('SELECT id,requestOrder')) return [{ id: 'newer', requestOrder: '200' }];
    if (sql.startsWith('INSERT INTO')) inserted = true;
    return [];
  } };
  await assert.rejects(() => service.publishReportEstimates(manager, 'tenant-a', [{
    input, inputHash: budgetReportEstimateInputHash(input), previousId: null,
    estimate: { quantity: '1', unit: 'FORFAIT', unitCostHt: '100.00', totalHt: '100.00', details: { kind: 'AI_ESTIMATE' } }, fresh: true,
  }], true, 100, 199), UnrecoverableError);
  assert.equal(inserted, false);
});

test('published price fans out once per affected scenario and never loops back to its source', async () => {
  const service: any = Object.create(PreventionBudgetService.prototype);
  const enqueued: any[] = [];
  service.dataSource = { query: async () => [{ reportId: 'report-a' }, { reportId: 'report-b' }] };
  service.captureReconcileTargetsForReport = async () => [
    { organizationId: 'tenant-a', scenarioId: 'published', scenarioVersion: 2, sourceVersion: 'self' },
    { organizationId: 'tenant-a', scenarioId: 'all-scope', scenarioVersion: 3, sourceVersion: 'global' },
  ];
  service.enqueue = async (_name: string, payload: unknown) => { enqueued.push(payload); };
  await service.propagateReportPrices('tenant-a', 'published', 'recalculation-1');
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].scenarioId, 'all-scope');
  assert.equal(enqueued[0].scenarioVersion, 3);
});
