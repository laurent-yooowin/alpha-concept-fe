import assert from 'node:assert/strict';
import test from 'node:test';
import { UnrecoverableError } from 'bullmq';
import { calculatePreventionBudget } from './prevention-budget.calculator';
import { preventionBudgetJobId, validatePreventionBudgetPayload } from './prevention-budget.service';
import { PREVENTION_BUDGET_RECALCULATE_JOB } from './prevention-budget.types';

const org = '11111111-1111-4111-8111-111111111111';
const scenario = '22222222-2222-4222-8222-222222222222';

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
  assert.equal(result.totals.contingencyAmountHt, '25.10');
  assert.equal(result.totals.totalBudgetHt, '276.10');
});

test('locked manual values and statuses survive recalculation', () => {
  const result = calculatePreventionBudget([{
    itemKey: 'a'.repeat(64), title: 'Action validée', categoryId: null, categoryKey: 'SECURITE',
    priority: 'LOW', quantity: '1', unit: 'ACTION', catalogMatch: null,
    manual: { quantity: '3', unit: 'FORFAIT', unitCostHt: '99.99', priceSource: 'Devis signé DS-1', status: 'VALIDE', priority: 'URGENT' },
  }], '0.00');
  assert.deepEqual(result.lines[0], {
    itemKey: 'a'.repeat(64), title: 'Action validée', categoryId: null, categoryKey: 'SECURITE',
    priority: 'URGENT', quantity: '3', unit: 'FORFAIT', unitCostHt: '99.99', totalHt: '299.97',
    status: 'VALIDE', priceSource: 'Devis signé DS-1', lockedManual: true,
  });
  assert.equal(result.totals.validatedBudgetHt, '299.97');
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


test('budget job identifiers are deterministic and isolate tenants/scenarios', () => {
  const payload = { organizationId: org, scenarioId: scenario, scenarioVersion: 2, sourceVersion: 'source-2' };
  assert.equal(preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, payload), preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, payload));
  assert.notEqual(preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, payload), preventionBudgetJobId(PREVENTION_BUDGET_RECALCULATE_JOB, { ...payload, organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
});
