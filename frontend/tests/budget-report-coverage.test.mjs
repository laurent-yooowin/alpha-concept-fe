import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetReportCoverage } from '../src/components/prevention/budgetReportCoverage.ts';

test('budget bar measures report coverage rather than relative monetary amount', () => {
  assert.equal(budgetReportCoverage(8, 10), 80);
  assert.equal(budgetReportCoverage(10, 10), 100);
  assert.equal(budgetReportCoverage(1, 10), 10);
  assert.equal(budgetReportCoverage(0, 0), 0);
  assert.equal(budgetReportCoverage(12, 10), 100);
});
