import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { consolidateMaterializedBudgetRows, excludeSupersededUnpricedBudgetRows, materializedActionScopeKey, sumAvailableMaterializedBudgetRows } from './prevention-budget-materialized';

test('targeted action scopes are distinct for each chantier', () => {
  const global = materializedActionScopeKey('org-a', 'action-a');
  const first = materializedActionScopeKey('org-a', 'action-a', 'mission-a');
  const second = materializedActionScopeKey('org-a', 'action-a', 'mission-b');
  assert.notEqual(first, global);
  assert.notEqual(first, second);
});

test('materialized results merge overlapping scopes by client/action without summing estimates or reports', () => {
  const action = 'a'.repeat(64);
  const rows = [
    { id: 'item-1', scenarioId: 'scope-1', itemKey: action, clientKey: 'client-1', clientLabel: 'EDF', status: 'ESTIME', totalHt: '100.00', aiEstimateDetails: JSON.stringify({ sourceReportEstimates: [{ reportId: 'R1', totalHt: '100.00' }] }) },
    { id: 'item-2', scenarioId: 'scope-2', itemKey: action, clientKey: 'client-1', clientLabel: 'EDF', status: 'ESTIME', totalHt: '250.00', aiEstimateDetails: JSON.stringify({ sourceReportEstimates: [{ reportId: 'R1', totalHt: '110.00' }, { reportId: 'R2', totalHt: '250.00' }] }) },
    { id: 'item-3', scenarioId: 'scope-2', itemKey: action, clientKey: 'client-2', clientLabel: 'ENGIE', status: 'ESTIME', totalHt: '900.00' },
  ];
  const sources = [
    { itemId: 'item-1', sourceKind: 'RECOMMENDATION', sourceKey: 'finding-1', reportId: 'R1', reportTitle: 'Rapport 1' },
    { itemId: 'item-2', sourceKind: 'RECOMMENDATION', sourceKey: 'finding-1', reportId: 'R1', reportTitle: 'Rapport 1' },
    { itemId: 'item-2', sourceKind: 'RECOMMENDATION', sourceKey: 'finding-2', reportId: 'R2', reportTitle: 'Rapport 2' },
    { itemId: 'item-3', sourceKind: 'RECOMMENDATION', sourceKey: 'finding-3', reportId: 'R3', reportTitle: 'Rapport 3' },
  ];
  const items = consolidateMaterializedBudgetRows(rows, sources);
  assert.equal(items.length, 2);
  const edf = items.find((item) => item.clientLabel === 'EDF')!;
  assert.equal(edf.totalHt, '250.00');
  assert.equal(edf.reportCount, 2);
  assert.equal(edf.sources.length, 2);
  assert.equal(edf.sourceReportEstimates.length, 2);
  assert.deepEqual(edf.sourceReportEstimates.find((estimate) => estimate.reportId === 'R1')?.totalHt, '110.00');
  assert.equal(edf.materializedOnly, true);
  assert.equal(items.find((item) => item.clientLabel === 'ENGIE')?.totalHt, '900.00');
  assert.equal(sumAvailableMaterializedBudgetRows(items), '1150.00');
});

test('available materialized total excludes unpriced actions but retains estimated and human amounts', () => {
  const items = consolidateMaterializedBudgetRows([
    { id: 'estimated', scenarioId: 's1', itemKey: 'a', clientKey: 'client-a', status: 'ESTIME', totalHt: '19.99' },
    { id: 'unpriced', scenarioId: 's1', itemKey: 'b', clientKey: 'client-a', status: 'A_CHIFFRER', totalHt: '0.00' },
    { id: 'human', scenarioId: 's1', itemKey: 'c', clientKey: 'client-a', status: 'VALIDE', lockedManual: 1, totalHt: '0.02' },
  ], []);
  assert.equal(sumAvailableMaterializedBudgetRows(items), '20.01');
});

test('available materialized total handles valid aggregate overflow and malformed persisted prices', () => {
  const rows = consolidateMaterializedBudgetRows([
    { id: 'a', scenarioId: 's1', itemKey: 'a', clientKey: 'client-a', status: 'ESTIME', totalHt: '9999999999999999.99' },
    { id: 'b', scenarioId: 's1', itemKey: 'b', clientKey: 'client-a', status: 'ESTIME', totalHt: '9999999999999999.99' },
  ], []);
  assert.equal(sumAvailableMaterializedBudgetRows(rows), '19999999999999999.98');
  assert.equal(sumAvailableMaterializedBudgetRows([{ ...rows[0], totalHt: 'invalid' }]), null);
});

test('human amounts win without erasing a conflicting decision or merging legacy clients', () => {
  const rows = [
    { id: 'ai', scenarioId: 's1', itemKey: 'a', clientKey: 'client-1', status: 'ESTIME', totalHt: '900.00' },
    { id: 'human-old', scenarioId: 's2', itemKey: 'a', clientKey: 'client-1', status: 'VALIDE', lockedManual: 1, totalHt: '120.00', createdAt: '2026-01-01' },
    { id: 'human-new', scenarioId: 's3', itemKey: 'a', clientKey: 'client-1', status: 'VALIDE', lockedManual: 1, totalHt: '150.00', createdAt: '2026-02-01' },
    { id: 'legacy-a', scenarioId: 's1', itemKey: 'legacy', clientKey: null, status: 'ESTIME', totalHt: '10.00' },
    { id: 'legacy-b', scenarioId: 's2', itemKey: 'legacy', clientKey: null, status: 'ESTIME', totalHt: '20.00' },
  ];
  const items = consolidateMaterializedBudgetRows(rows, []);
  assert.equal(items.length, 3);
  const consolidated = items.find((item) => item.clientKey === 'client-1')!;
  assert.equal(consolidated.totalHt, '150.00');
  assert.equal(consolidated.conflictingHumanAmounts, true);
});

test('filtered results never reuse an estimate governed by an excluded report', () => {
  const row = { id: 'item', scenarioId: 'scope', itemKey: 'action', clientKey: 'client',
    status: 'ESTIME', totalHt: '900.00', aiEstimateDetails: { sourceReportEstimates: [
      { reportId: 'R1', totalHt: '100.00' }, { reportId: 'R2', totalHt: '900.00' },
    ] } };
  const [filtered] = consolidateMaterializedBudgetRows([row], [
    { itemId: 'item', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', reportId: 'R1' },
  ], true);
  assert.equal(filtered.totalHt, '100.00');
  assert.equal(filtered.sourceReportEstimates.length, 1);
  assert.equal(filtered.aiEstimateDetails, null);
});

test('a calculated chantier scope takes precedence over an older wider action result', () => {
  const rows = [
    { id: 'global', scenarioId: 'all', itemKey: 'action', clientKey: 'client', actionResult: true,
      status: 'ESTIME', totalHt: '900.00', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '900.00' }] } },
    { id: 'chantier', scenarioId: 'scoped', itemKey: 'action', clientKey: 'client', scopePreferred: true,
      status: 'ESTIME', totalHt: '350.00', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '350.00' }] } },
  ];
  const sources = rows.map((row) => ({ itemId: row.id, sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', reportId: 'R1' }));
  const [result] = consolidateMaterializedBudgetRows(rows, sources, true);
  assert.equal(result.originItemId, 'chantier');
  assert.equal(result.totalHt, '350.00');
});

test('a prompted action result replaces a higher historical estimate rather than being hidden by MAX', () => {
  const rows = [
    { id: 'old', scenarioId: 'bounded', itemKey: 'action', clientKey: 'client', status: 'ESTIME', totalHt: '900.00', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '900.00' }] } },
    { id: 'prompted', scenarioId: 'action-scope', itemKey: 'action', clientKey: 'client', actionResult: true, status: 'ESTIME', totalHt: '350.00', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '350.00' }] } },
  ];
  const sources = [
    { itemId: 'old', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', reportId: 'R1' },
    { itemId: 'prompted', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', reportId: 'R1' },
  ];
  const [result] = consolidateMaterializedBudgetRows(rows, sources, true);
  assert.equal(result.totalHt, '350.00');
  assert.equal(result.originItemId, 'prompted');
});

test('a human-validated amount wins over a later estimated action result', () => {
  const rows = [
    { id: 'human', scenarioId: 'bounded', itemKey: 'action', clientKey: 'client', status: 'VALIDE', lockedManual: 1, totalHt: '420.00' },
    { id: 'prompted', scenarioId: 'action-scope', itemKey: 'action', clientKey: 'client', actionResult: true, status: 'ESTIME', totalHt: '350.00' },
  ];
  const [result] = consolidateMaterializedBudgetRows(rows, []);
  assert.equal(result.totalHt, '420.00');
  assert.equal(result.originItemId, 'human');
});

test('a newer priced client action suppresses an unpriced historical duplicate only when every recommendation is covered', () => {
  const rows = [
    { id: 'old', organizationId: 'org-a', scenarioId: 'old-scope', itemKey: 'old-action', clientKey: 'client-a', status: 'A_CHIFFRER', totalHt: '0.00', scenarioCreatedAt: '2026-10-05T10:00:00Z' },
    { id: 'new', organizationId: 'org-a', scenarioId: 'new-scope', itemKey: 'new-action', clientKey: 'client-a', status: 'ESTIME', totalHt: '800.00', scenarioCreatedAt: '2026-10-07T10:00:00Z', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '800.00' }, { reportId: 'R2', totalHt: '600.00' }] } },
  ];
  const sources = [
    { itemId: 'old', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', findingId: 'F1', reportId: 'R1' },
    { itemId: 'old', sourceKind: 'RECOMMENDATION', sourceKey: 'source-2', findingId: 'F2', reportId: 'R2' },
    { itemId: 'new', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', findingId: 'F1', reportId: 'R1' },
    { itemId: 'new', sourceKind: 'RECOMMENDATION', sourceKey: 'source-2', findingId: 'F2', reportId: 'R2' },
  ];
  const items = consolidateMaterializedBudgetRows(rows, sources);
  assert.deepEqual(excludeSupersededUnpricedBudgetRows(items, rows, sources).map((item) => item.originItemId), ['new']);
  assert.equal(excludeSupersededUnpricedBudgetRows(consolidateMaterializedBudgetRows(rows, sources.slice(0, 3)), rows, sources.slice(0, 3)).length, 2);
});

test('the API projection never hides an unpriced row for a different tenant, client, older result or missing report estimate', () => {
  const old = { id: 'old', organizationId: 'org-a', scenarioId: 'old-scope', itemKey: 'old-action', clientKey: 'client-a', status: 'A_CHIFFRER', totalHt: '0.00', scenarioCreatedAt: '2026-10-05T10:00:00Z' };
  const priced = { id: 'new', organizationId: 'org-a', scenarioId: 'new-scope', itemKey: 'new-action', clientKey: 'client-a', status: 'ESTIME', totalHt: '800.00', scenarioCreatedAt: '2026-10-07T10:00:00Z', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R2', totalHt: '800.00' }] } };
  const sources = [
    { itemId: 'old', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', findingId: 'F1', reportId: 'R1' },
    { itemId: 'new', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', findingId: 'F1', reportId: 'R1' },
  ];
  for (const candidate of [priced, { ...priced, organizationId: 'org-b', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1' }] } }, { ...priced, clientKey: 'client-b', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1' }] } }, { ...priced, scenarioCreatedAt: '2026-10-04T10:00:00Z', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1' }] } }]) {
    const items = consolidateMaterializedBudgetRows([old, candidate], sources);
    assert.equal(excludeSupersededUnpricedBudgetRows(items, [old, candidate], sources).length, 2);
  }
});

test('a newer unpriced version in the same merged action remains visible until a later estimate covers it', () => {
  const rows = [
    { id: 'old', organizationId: 'org-a', scenarioId: 'scope-1', itemKey: 'unpriced-action', clientKey: 'client-a', status: 'A_CHIFFRER', totalHt: '0.00', scenarioCreatedAt: '2026-10-05T10:00:00Z' },
    { id: 'recent', organizationId: 'org-a', scenarioId: 'scope-2', itemKey: 'unpriced-action', clientKey: 'client-a', status: 'A_CHIFFRER', totalHt: '0.00', scenarioCreatedAt: '2026-10-08T10:00:00Z' },
    { id: 'priced', organizationId: 'org-a', scenarioId: 'scope-3', itemKey: 'priced-action', clientKey: 'client-a', status: 'ESTIME', totalHt: '800.00', scenarioCreatedAt: '2026-10-07T10:00:00Z', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '800.00' }] } },
  ];
  const sources = rows.map((row) => ({ itemId: row.id, sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', findingId: 'F1', reportId: 'R1' }));
  const items = consolidateMaterializedBudgetRows(rows, sources);
  assert.equal(excludeSupersededUnpricedBudgetRows(items, rows, sources).length, 2);
});

test('a merged newer priced row cannot lend its date to an older estimate for another recommendation in the same report', () => {
  const rows = [
    { id: 'unpriced', organizationId: 'org-a', scenarioId: 's2', itemKey: 'old-action', clientKey: 'client-a', status: 'A_CHIFFRER', totalHt: '0.00', scenarioCreatedAt: '2026-10-06T10:00:00Z' },
    { id: 'priced-old', organizationId: 'org-a', scenarioId: 's1', itemKey: 'priced-action', clientKey: 'client-a', status: 'ESTIME', totalHt: '100.00', scenarioCreatedAt: '2026-10-05T10:00:00Z', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '100.00' }] } },
    { id: 'priced-new', organizationId: 'org-a', scenarioId: 's3', itemKey: 'priced-action', clientKey: 'client-a', status: 'ESTIME', totalHt: '200.00', scenarioCreatedAt: '2026-10-07T10:00:00Z', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '200.00' }] } },
  ];
  const sources = [
    { itemId: 'unpriced', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', findingId: 'F1', reportId: 'R1' },
    { itemId: 'priced-old', sourceKind: 'RECOMMENDATION', sourceKey: 'source-1', findingId: 'F1', reportId: 'R1' },
    { itemId: 'priced-new', sourceKind: 'RECOMMENDATION', sourceKey: 'source-2', findingId: 'F2', reportId: 'R1' },
  ];
  const items = consolidateMaterializedBudgetRows(rows, sources);
  assert.equal(items.length, 2);
  assert.equal(excludeSupersededUnpricedBudgetRows(items, rows, sources).length, 2);
});
