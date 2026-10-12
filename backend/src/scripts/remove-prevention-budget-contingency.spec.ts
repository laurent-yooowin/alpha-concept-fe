import assert from 'node:assert/strict';
import test from 'node:test';
import { removePreventionBudgetContingency } from './remove-prevention-budget-contingency';

const org = '11111111-1111-4111-8111-111111111111';
const old = { id: '22222222-2222-4222-8222-222222222222', organizationId: org,
  scenarioKey: 'a'.repeat(64), version: 4, sourceVersion: 'old', status: 'CALCULATED',
  retainedBudgetHt: '32550.00', contingencyRatePercent: '10.00', contingencyAmountHt: '3255.00', totalBudgetHt: '35805.00' };

test('contingency recovery dry-run is tenant scoped and does not write', async () => {
  const calls: Array<{ sql: string; args?: unknown[] }> = [];
  const db = { query: async (sql: string, args?: unknown[]) => { calls.push({ sql, args }); return sql.includes('prevention_budget_global_runs') ? [{ total: 0 }] : [old]; } };
  assert.deepEqual(await removePreventionBudgetContingency(db as any, org),
    { candidates: 1, activeGlobalRuns: 0, targets: [{ scenarioKey: old.scenarioKey, version: 4,
      retainedBudgetHt: '32550.00', totalBudgetHt: '35805.00' }], published: 0, skipped: 0, dryRun: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /s\.organizationId=\?/);
  assert.deepEqual(calls[0].args, [org]);
  assert.deepEqual(calls[1].args, [org]);
  await assert.rejects(() => removePreventionBudgetContingency(db as any, 'not-a-uuid'));
});

test('contingency recovery publishes a new auditable version without modifying locked items', async () => {
  const writes: Array<{ sql: string; args?: unknown[] }> = [];
  const manager = { query: async (sql: string, args?: unknown[]) => {
    if (sql.includes('FROM prevention_budget_global_runs')) return [];
    if (sql.includes('FROM prevention_budget_scenarios') && sql.includes('FOR UPDATE')) return [old];
    if (sql.startsWith('SELECT id,totalHt FROM prevention_budget_items')) return [{ id: 'old-item', totalHt: '32550.00' }];
    if (sql.startsWith('SELECT id FROM prevention_budget_item_sources')) return [{ id: 'old-source' }];
    writes.push({ sql, args });
    return [];
  } };
  const db = { query: async () => [old], transaction: async (callback: (tx: typeof manager) => Promise<unknown>) => callback(manager) };
  assert.deepEqual(await removePreventionBudgetContingency(db as any, org, true),
    { candidates: 1, published: 1, skipped: 0, dryRun: false });
  assert.equal(writes.length, 4);
  assert.match(writes[0].sql, /validatedBudgetHt,0,retainedBudgetHt/);
  assert.match(writes[1].sql, /lockedManual/);
  assert.match(writes[2].sql, /sourceKey,findingId,reportId/);
  assert.match(writes[3].sql, /'RECONCILE','WORKER'/);
  assert.equal(writes[0].args?.[3], org);
  assert.equal(writes[1].args?.[2], org);
});
