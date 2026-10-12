import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetClientActionKey, budgetClientIdentity, parseBudgetClientKeys, storedBudgetClientKeys } from './prevention-budget-client';
import { maximumReportBudgetEstimate } from './prevention-budget-report-maximum';

test('client identity normalizes case and spaces without merging distinct clients', () => {
  assert.equal(budgetClientIdentity(' ÉDF  ').key, budgetClientIdentity('édF').key);
  assert.notEqual(budgetClientIdentity('EDF').key, budgetClientIdentity('ENGIE').key);
  assert.notEqual(budgetClientActionKey(budgetClientIdentity('EDF').key, 'height-protection'),
    budgetClientActionKey(budgetClientIdentity('ENGIE').key, 'height-protection'));
  assert.equal(budgetClientIdentity(' \n ').key, 'unassigned');
  assert.deepEqual(parseBudgetClientKeys(['unassigned', 'unassigned']), ['unassigned']);
  assert.deepEqual(storedBudgetClientKeys('["unassigned"]'), ['unassigned']);
  assert.throws(() => parseBudgetClientKeys(['foreign-client']));
});

test('a client action uses the maximum report estimate, never their sum', () => {
  const make = (totalHt: string) => ({ quantity: '1', unit: 'FORFAIT', unitCostHt: totalHt, totalHt,
    details: { kind: 'AI_ESTIMATE' as const, model: 'test', generatedAt: '2026-10-05', confidence: 60,
      rangeLowHt: totalHt, rangeHighHt: totalHt, rationale: 'Quantité indicative.', assumptions: ['À vérifier'],
      components: [{ label: 'EPI', amountHt: totalHt, explanation: 'Dotation indicative' }],
      catalogBenchmark: null, sourceRecommendations: [], sourceObservations: [], inputsToConfirm: [] } });
  const result = maximumReportBudgetEstimate([
    { reportId: 'rapport-un-casque', estimate: make('80.00') },
    { reportId: 'rapport-deux-casques', estimate: make('160.00') },
  ]);
  assert.equal(result.totalHt, '160.00');
  assert.equal(result.details.governingReportId, 'rapport-deux-casques');
  assert.equal(result.details.aggregationRule, 'MAX_PER_CLIENT_ACTION_REPORT');
  assert.equal(result.details.sourceReportEstimates?.length, 2);
});
