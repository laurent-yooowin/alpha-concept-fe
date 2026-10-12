import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  budgetItemRecalculationPayload,
  budgetItemEstimateDisplay,
  budgetMaterializedTarget,
  budgetReportLabel,
  budgetPublicExplanation,
  budgetRefreshScenarioId,
  budgetSelectionKey,
  budgetScopeSelectionQuery,
  budgetGlobalSelectionQuery,
  budgetExecutionPeriod,
  budgetExecutionSnapshot,
  budgetExecutionMatchesDisplay,
  budgetModeAfterPeriodChange,
  formatBudgetMoney,
  materializedBudgetSelection,
  sumDisplayedBudgetAmounts,
  budgetCommandPayload,
  budgetConfirmationAfterConflict,
  budgetResumeResult,
  canRecalculateBudgetItem,
} from '../src/components/prevention/budgetUiContracts.ts';
import { scheduleBudgetPublishedRefresh } from '../src/components/prevention/budgetPublishedRefresh.ts';

test('client selection builds an immediate read-only scope query without a calculation command', () => {
  const query = budgetScopeSelectionQuery({ preset: 'ALL', categoryId: 'height', clientKeys: ['client-a', 'client-b'] });
  assert.deepEqual(query, { preset: 'ALL', categoryId: 'height', clientKeys: ['client-a', 'client-b'] });
  assert.equal('method' in query, false);
  assert.equal('adminPrompt' in query, false);
});

test('budget execution keeps bounded filters but makes ALL choices explicit', () => {
  assert.deepEqual(budgetExecutionPeriod('CURRENT_YEAR', { preset: 'ALL' }), { preset: 'CURRENT_YEAR' });
  assert.deepEqual(budgetExecutionPeriod('GLOBAL_YEARLY', { preset: 'ALL' }), { preset: 'ALL' });
  assert.deepEqual(budgetExecutionPeriod('FILTERED', { preset: 'CUSTOM', from: '2025-01-01', to: '2025-12-31' }), {
    preset: 'CUSTOM', from: '2025-01-01', to: '2025-12-31',
  });
  assert.throws(() => budgetExecutionPeriod('FILTERED', { preset: 'ALL' }));
});

test('selecting ALL never silently resets an explicit global calculation mode', () => {
  assert.equal(budgetModeAfterPeriodChange('ALL', 'GLOBAL_YEARLY'), 'GLOBAL_YEARLY');
  assert.equal(budgetModeAfterPeriodChange('ALL', 'CURRENT_YEAR'), 'CURRENT_YEAR');
  assert.equal(budgetModeAfterPeriodChange('CUSTOM', 'GLOBAL_YEARLY'), 'FILTERED');
});

test('the execution modal copies filters without changing the result filters', () => {
  const display = { preset: 'CUSTOM', from: '2026-01-01', to: '2026-02-01', categoryId: 'height', severity: 'eleve', clientKeys: ['client-a'] };
  const execution = budgetExecutionSnapshot(display);
  execution.clientKeys.push('client-b');
  execution.from = '2025-01-01';
  assert.deepEqual(display.clientKeys, ['client-a']);
  assert.equal(display.from, '2026-01-01');
  assert.equal(budgetCommandPayload('FILTERED', execution, 'token').from, '2025-01-01');
});

test('a calculation outside the visible result scope cannot replace its table', () => {
  const display = { preset: 'ALL', categoryId: 'height', clientKeys: [] };
  assert.equal(budgetExecutionMatchesDisplay('CURRENT_YEAR', display, display), false);
  assert.equal(budgetExecutionMatchesDisplay('GLOBAL_YEARLY', display, display), true);
  assert.equal(budgetExecutionMatchesDisplay('FILTERED', { ...display, preset: 'CUSTOM', from: '2026-01-01', to: '2026-01-31' }, display), false);
});

test('an asynchronous budget result belongs only to the filter selection that started it', () => {
  const base = { preset: 'ALL', categoryId: 'height', severity: 'eleve', clientKeys: ['b', 'a'] };
  assert.equal(budgetSelectionKey(base), budgetSelectionKey({ ...base, clientKeys: ['a', 'b'] }));
  assert.notEqual(budgetSelectionKey(base), budgetSelectionKey({ ...base, clientKeys: ['a'] }));
  assert.notEqual(budgetSelectionKey(base), budgetSelectionKey({ ...base, severity: 'moyen' }));
});

test('targeted line recalculation sends only the expected version and optional line prompt', () => {
  assert.deepEqual(budgetItemRecalculationPayload(7, '  deux casques par salarié  '), {
    expectedVersion: 7,
    adminPrompt: 'deux casques par salarié',
  });
  assert.deepEqual(budgetItemRecalculationPayload(8, '   '), { expectedVersion: 8 });
});

test('a human-validated locked amount is not presented as the current AI estimate', () => {
  const aiEstimateDetails = { kind: 'AI_ESTIMATE', rangeLowHt: '1800.00', rangeHighHt: '6000.00' };
  assert.deepEqual(budgetItemEstimateDisplay({ status: 'VALIDE', lockedManual: true, aiEstimateDetails }), {
    amountLabel: 'Montant validé', showEstimateRange: false,
  });
  assert.deepEqual(budgetItemEstimateDisplay({ status: 'ESTIME', lockedManual: false, aiEstimateDetails }), {
    amountLabel: 'Estimation IA', showEstimateRange: true,
  });
  assert.deepEqual(budgetItemEstimateDisplay({ status: 'VALIDE', lockedManual: false, aiEstimateDetails }), {
    amountLabel: 'Estimation IA', showEstimateRange: true,
  });
  const source = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  const table = source.slice(source.indexOf('function BudgetOverviewTable('), source.indexOf('function BudgetJustificationModal('));
  assert.match(table, /const estimateDisplay = budgetItemEstimateDisplay\(item\)/);
  assert.match(table, /estimateDisplay\.showEstimateRange \? ` · estimation IA comprise entre/);
  assert.match(table, /\{estimateDisplay\.amountLabel\}/);
});

test('materialized display rows write only through a versioned persisted origin', () => {
  assert.deepEqual(budgetMaterializedTarget({ originScenarioId: 'scope', originItemId: 'item', originVersion: 3 }), {
    scenarioId: 'scope', itemId: 'item', expectedVersion: 3,
  });
  assert.throws(() => budgetMaterializedTarget({ originScenarioId: 'scope', originVersion: 3 }));
});

test('budget justifications identify duplicate report titles without displaying technical IDs', () => {
  const reports = [
    { id: 'e8022de6-b157-456c-b6fe-8809a0e5bb2d', title: 'RAPPORT VISITE - Ch1' },
    { id: '6798d4c2-0f7e-40fc-9ee5-7090c60b4844', title: 'RAPPORT VISITE - Ch1' },
  ];
  assert.equal(budgetReportLabel(reports[0].id, reports), 'RAPPORT VISITE - Ch1 (1/2)');
  assert.equal(budgetReportLabel(reports[1].id, reports), 'RAPPORT VISITE - Ch1 (2/2)');
  assert.equal(budgetReportLabel('other', [{ id: 'other', title: 'Rapport unique' }]), 'Rapport unique');
  assert.equal(budgetReportLabel('missing', [{ id: 'missing', title: null }]), 'Rapport source');
  assert.equal(budgetReportLabel(reports[0].id, [{ ...reports[0], title: reports[0].id }]), 'Rapport source');
});

test('budget explanations do not expose an internal AI grouping key', () => {
  assert.equal(budgetPublicExplanation('Même pricingCohortKey pour ce client.'), 'Même regroupement budgétaire pour ce client.');
  assert.equal(budgetPublicExplanation('Rapport e8022de6-b157-456c-b6fe-8809a0e5bb2d.'), 'Rapport référence interne.');
  assert.equal(budgetPublicExplanation(null), '');
});

test('the justification modal keeps long evidence collapsible and the AI estimate open first', () => {
  const source = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  const modal = source.slice(source.indexOf('function BudgetJustificationModal('));
  assert.match(modal, /role="dialog"[^>]*overflow-hidden rounded-2xl[^>]*>\s*<div className="max-h-\[90vh\] overflow-y-auto p-6">/);
  assert.match(modal, /<details(?![^>]*\bopen\b)[^>]*><summary[^>]*>Contexte, observations et base réglementaire<\/summary>/);
  const contextPanel = modal.slice(modal.indexOf('Contexte, observations et base réglementaire'), modal.indexOf('<details open'));
  assert.match(contextPanel, /<h4[^>]*>Base réglementaire<\/h4>/);
  assert.doesNotMatch(modal, /Décomposition du montant/);
  assert.equal((modal.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 2);
  assert.match(modal, /<details\s+open[^>]*><summary[^>]*>.*Estimation IA indicative/s);
  assert.match(modal, /<details(?![^>]*\bopen\b)[^>]*><summary[^>]*>Estimations par rapport source/);
  assert.ok(modal.indexOf('Estimation IA indicative') < modal.indexOf('Estimations par rapport source'));
  assert.doesNotMatch(modal, /Méthode de regroupement|Rapport déterminant/);
});

test('the Prevention budget uses the estimative label consistently', () => {
  const page = readFileSync(new URL('../src/components/prevention/PreventionPage.tsx', import.meta.url), 'utf8');
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /label: 'Budget estimatif'/);
  assert.match(budget, /Budget estimatif sécurité/);
  assert.match(budget, /aria-label="Postes du budget estimatif"/);
  assert.doesNotMatch(page + budget, /Budget prévisionnel|budget prévisionnel/);
});

test('the published unfiltered total has the same short label on mobile and desktop', () => {
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  assert.equal((budget.match(/TOTAL BUDGET HT/g) || []).length, 2);
  assert.doesNotMatch(budget, /TOTAL (?:BUDGET )?RETENU HT/);
  assert.match(budget, /TOTAL FILTRÉ HT/);
  assert.match(budget, /TOTAL GLOBAL PROVISOIRE HT/);
});

test('materialized Budget shows a provisional available total rather than a missing global total', () => {
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  assert.match(budget, /availableTotalHt/);
  assert.match(budget, /TOTAL GLOBAL PROVISOIRE HT/);
  assert.match(budget, /hors postes à chiffrer/);
  assert.doesNotMatch(budget, /AVEC ALÉAS|hors aléas/);
  assert.doesNotMatch(budget, /TOTAL GLOBAL NON DISPONIBLE/);
});

test('completed budget jobs refresh the visible scope and published global amount without a page reload', () => {
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  assert.match(budget, /const refreshVisibleScope = useCallback/);
  assert.match(budget, /refreshAfterJob\(requestGeneration\)/);
  assert.match(budget, /refreshAfterJob\(scopeGeneration\)/);
  assert.match(budget, /detail\.scenario\?\.retainedBudgetHt/);
  assert.doesNotMatch(budget, /AVEC ALÉAS|hors aléas/);
});

test('published-budget refresh observes delayed ALL reconciliation without changing filters', async () => {
  const filters = Object.freeze({ preset: 'ALL', clientKeys: Object.freeze([]) });
  const scheduled = [];
  let publication = 0;
  let displayedTotal = null;
  let displayedScenarioId = null;
  let currentSelection = true;
  const calls = [];
  const api = {
    budgetScope: async (query) => {
      calls.push({ method: 'scope', query });
      return { scenario: { id: publication ? 'new-all' : 'old-all' } };
    },
    budget: async (id) => {
      calls.push({ method: 'budget', id });
      return { scenario: { id, retainedBudgetHt: id === 'new-all' ? '32550.00' : '28950.00' } };
    },
  };
  const refresh = async () => {
    const scope = await api.budgetScope(filters);
    const detail = await api.budget(scope.scenario.id);
    displayedScenarioId = detail.scenario.id;
    displayedTotal = detail.scenario.retainedBudgetHt;
  };
  const timers = scheduleBudgetPublishedRefresh(refresh, () => currentSelection,
    (reason) => { throw reason; }, (callback, delayMs) => {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    }, 3, 3000);
  assert.equal(timers.length, 3);
  assert.deepEqual(scheduled.map((timer) => timer.delayMs), [0, 3000, 6000]);
  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(displayedTotal, '28950.00');
  publication = 1;
  scheduled[1].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(displayedScenarioId, 'new-all');
  assert.equal(displayedTotal, '32550.00');
  assert.ok(calls.filter((call) => call.method === 'scope').every((call) => call.query === filters));
  currentSelection = false;
  scheduled[2].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 4);
  assert.deepEqual(filters, { preset: 'ALL', clientKeys: [] });
});

test('a completed empty materialized response still exposes its zero provisional total', () => {
  assert.deepEqual(materializedBudgetSelection([], '0.00'), {
    id: 'materialized-results', items: [], totalBudgetHt: '0.00',
  });
  assert.equal(materializedBudgetSelection([], null), null);
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  assert.match(budget, /if \(!items\.length\) return partial \|\| filtered[\s\S]*TOTAL GLOBAL PROVISOIRE HT/);
});

test('filtered Budget totals follow all displayed rows, not a broader stored scenario or the current page', () => {
  const rows = [{ totalHt: '4200.00' }, { totalHt: '1300.45' }, { totalHt: null }];
  assert.equal(sumDisplayedBudgetAmounts(rows, (row) => row.totalHt), '5500.45');
  assert.equal(sumDisplayedBudgetAmounts([], (row) => row.totalHt), '0.00');
  assert.equal(sumDisplayedBudgetAmounts([{ totalHt: '99999999999999999.99' }, { totalHt: '0.01' }], (row) => row.totalHt), '100000000000000000.00');
  assert.equal(sumDisplayedBudgetAmounts([{ totalHt: 'invalid' }], (row) => row.totalHt), null);
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  assert.match(budget, /filteredView && selected\s*\? sumDisplayedBudgetAmounts\(selected\.items \|\| \[\], itemAmount\)/);
  assert.match(budget, /filtered \? 'TOTAL FILTRÉ HT'/);
});

test('filtered Budget retains an independent unfiltered global total alongside its subtotal', () => {
  assert.deepEqual(budgetGlobalSelectionQuery(), { preset: 'ALL', clientKeys: [] });
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  assert.match(budget, /if \(!filteredView\) \{ setGlobalTotal\(null\); return; \}/);
  assert.match(budget, /preventionAPI\.budgetScope\(globalQuery\)/);
  assert.match(budget, /preventionAPI\.budgetMaterialized\(globalQuery\)/);
  assert.match(budget, /globalTotal=\{globalTotal\}/);
  assert.match(budget, /\{filtered && <tr[^>]*>.*TOTAL GLOBAL HT.*globalTotal\.amount/s);
  assert.match(budget, /md:hidden">\{globalTotal\?\.provisional \? 'TOTAL GLOBAL PROVISOIRE HT' : 'TOTAL GLOBAL HT'\}/);
});

test('budget line amounts and totals use French thousands and two decimal places', () => {
  assert.equal(formatBudgetMoney('4200.00'), '4\u00a0200,00\u00a0€');
  assert.equal(formatBudgetMoney('1234567.8'), '1\u00a0234\u00a0567,80\u00a0€');
  assert.equal(formatBudgetMoney('0.00'), '0,00\u00a0€');
  assert.equal(formatBudgetMoney('19999999999999999.98'), '19\u00a0999\u00a0999\u00a0999\u00a0999\u00a0999,98\u00a0€');
  assert.equal(formatBudgetMoney(null), '—');
});

test('a line recalculation is enabled only by a nonempty admin prompt on an unlocked idle line', () => {
  assert.equal(canRecalculateBudgetItem('   ', false, false), false);
  assert.equal(canRecalculateBudgetItem('prendre en compte trois casques', false, false), true);
  assert.equal(canRecalculateBudgetItem('trois casques', true, false), false);
  assert.equal(canRecalculateBudgetItem('trois casques', false, true), false);
});

test('completed targeted job refreshes its new scenario before falling back to the current one', () => {
  assert.equal(budgetRefreshScenarioId({ scenarioId: 'new-scenario' }, 'old-scenario'), 'new-scenario');
  assert.equal(budgetRefreshScenarioId({ targetScenarioId: 'target-scenario' }, 'old-scenario'), 'target-scenario');
  assert.equal(budgetRefreshScenarioId({}, 'old-scenario'), 'old-scenario');
});

test('budget command carries the opaque preview confirmation token', () => {
  const payload = budgetCommandPayload('GLOBAL_YEARLY', { preset: 'ALL', categoryId: 'height', clientKeys: ['client-a'] }, 'opaque-preview-token');
  assert.deepEqual(payload, {
    mode: 'GLOBAL_YEARLY', confirmationToken: 'opaque-preview-token', preset: 'ALL',
    categoryId: 'height', severity: undefined, clientKeys: ['client-a'],
  });
});

test('a stale preview keeps the confirmation modal armed for reconfirmation', () => {
  const freshPreview = { confirmationToken: 'fresh-token', scheduledFor: '2026-10-07T01:00:00.000Z', threshold: { decision: 'NIGHT_ONLY' } };
  assert.deepEqual(budgetConfirmationAfterConflict({ mode: 'GLOBAL_YEARLY', globalArmed: true }, freshPreview), {
    mode: 'GLOBAL_YEARLY', globalArmed: false, preview: freshPreview,
  });
});

test('a published global job resumes from finalScenarioId and is terminal', () => {
  assert.deepEqual(budgetResumeResult({ status: 'PUBLISHED', finalScenarioId: 'final-scenario' }, 'old-scenario'), {
    terminal: true, completed: true, scenarioId: 'final-scenario', error: null,
  });
  assert.deepEqual(budgetResumeResult({ status: 'FAILED', lastError: 'source changed' }), {
    terminal: true, completed: false, scenarioId: null, error: 'source changed',
  });
});
