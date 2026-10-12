import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
const prevention = readFileSync(new URL('../src/components/prevention/PreventionPage.tsx', import.meta.url), 'utf8');

test('budget errors, notices and job alerts can be dismissed without changing the selection', () => {
  assert.match(budget, /<Message error onClose=\{\(\) => setError\(null\)\}>/);
  assert.doesNotMatch(budget, /Le budget total sera affiché après le calcul complet/);
  assert.match(budget, /onClick=\{\(\) => setNotice\(null\)\} aria-label="Fermer l’alerte"/);
  assert.match(budget, /dismissedJobId !== job\.id/);
});

test('all other Prevention screens can close errors, period warnings, job status and dashboard risk alerts', () => {
  assert.match(prevention, /<StateMessage[^>]*onClose=\{\(\) => setError\(null\)\}/);
  assert.match(prevention, /dismissedPeriodWarning !== periodWarningKey/g);
  assert.match(prevention, /dismissedJobId !== job\.id/);
  assert.match(prevention, /critical > 0 && !criticalDismissed/);
  assert.match(prevention, /setCriticalDismissed\(true\)/);
});

test('closing a failed data-load alert cannot reveal stale data from another filter', () => {
  assert.match(prevention, /setDataLoadFailed\(true\); setError\(/);
  assert.match(prevention, /!dataLoadFailed && section === 'dashboard'/);
  assert.match(prevention, /!dataLoadFailed && \(section === 'observations' \|\| section === 'recommendations'\)/);
  assert.match(prevention, /!dataLoadFailed && section === 'references'/);
});
