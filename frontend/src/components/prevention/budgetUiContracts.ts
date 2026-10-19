import type { PreventionQuery } from '../../lib/api';

export type BudgetClientSelection = Pick<PreventionQuery, 'preset' | 'from' | 'to' | 'categoryId' | 'severity'> & {
  clientKeys?: string[];
};

export type BudgetExecutionMode = 'FILTERED' | 'CURRENT_YEAR' | 'GLOBAL_YEARLY';

/** Preserve decimal precision for persisted string amounts, including large totals. */
export function formatBudgetMoney(value: unknown): string {
  const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return '—';
  const euros = String(BigInt(match[1])).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const cents = (match[2] || '').padEnd(2, '0');
  return `${euros},${cents}\u00a0€`;
}

/** A filtered total is the sum of the amounts shown in the filtered rows,
 * not the persisted total of a broader scenario. */
export function sumDisplayedBudgetAmounts<T>(items: T[], amountFor: (item: T) => unknown): string | null {
  let totalCents = 0n;
  for (const item of items) {
    const amount = amountFor(item);
    if (amount == null) continue;
    const match = String(amount).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    totalCents += BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  }
  return `${totalCents / 100n}.${(totalCents % 100n).toString().padStart(2, '0')}`;
}

/** An empty materialized result still has a meaningful available total (0.00). */
export function materializedBudgetSelection<T>(items: T[], availableTotalHt: string | null) {
  if (availableTotalHt === null && items.length === 0) return null;
  return { id: 'materialized-results', items, totalBudgetHt: availableTotalHt ?? undefined };
}

/** Keep an explicit global choice when the period selector is set to ALL. */
export function budgetModeAfterPeriodChange(preset: string, currentMode: BudgetExecutionMode): BudgetExecutionMode {
  if (preset !== 'ALL') return 'FILTERED';
  return currentMode === 'GLOBAL_YEARLY' ? 'GLOBAL_YEARLY' : 'CURRENT_YEAR';
}

/** A calculation starts from the displayed filters but never mutates them. */
export function budgetExecutionSnapshot(selection: BudgetClientSelection) {
  return {
    preset: selection.preset || 'ALL', from: selection.from, to: selection.to,
    categoryId: selection.categoryId, severity: selection.severity,
    clientKeys: [...(selection.clientKeys || [])],
  };
}

/** The recommended current-year command is distinct from the visible ALL filter. */
export function budgetExecutionPeriod(mode: BudgetExecutionMode, selection: BudgetClientSelection) {
  if (mode === 'CURRENT_YEAR') return { preset: 'CURRENT_YEAR' as const };
  if (mode === 'GLOBAL_YEARLY') return { preset: 'ALL' as const };
  if (!selection.preset || selection.preset === 'ALL') throw new Error('Une période bornée est requise');
  return { preset: selection.preset, from: selection.from, to: selection.to };
}

/** Query used by the read-only scope lookup when the client multiselect changes. */
export function budgetScopeSelectionQuery(selection: BudgetClientSelection) {
  return { ...selection, clientKeys: [...(selection.clientKeys || [])] };
}

/** Global comparison must never inherit active display filters. */
export function budgetGlobalSelectionQuery() {
  return { preset: 'ALL' as const, clientKeys: [] as string[] };
}

/** Stable identity for the visible Budget filter scope, independent of selection order. */
export function budgetSelectionKey(selection: BudgetClientSelection): string {
  return JSON.stringify([
    selection.preset || '', selection.from || '', selection.to || '',
    selection.categoryId || '', selection.severity || '',
    [...(selection.clientKeys || [])].sort(),
  ]);
}

export function budgetExecutionMatchesDisplay(mode: BudgetExecutionMode, execution: BudgetClientSelection, display: BudgetClientSelection): boolean {
  const executed = { ...execution, ...budgetExecutionPeriod(mode, execution) };
  return budgetSelectionKey(executed) === budgetSelectionKey(display);
}

/** Payload for a targeted line recalculation; it never carries a full-scope prompt. */
export function budgetItemRecalculationPayload(expectedVersion: number | string | undefined, prompt: string) {
  const normalized = prompt.trim();
  return { expectedVersion, ...(normalized ? { adminPrompt: normalized } : {}) };
}

/** A merged display row is not itself a persisted budget item. Writes must
 * target the tenant-checked origin and its optimistic scenario version. */
export function budgetMaterializedTarget(item: { originScenarioId?: string; originItemId?: string; originVersion?: number }) {
  if (!item.originScenarioId || !item.originItemId || !Number.isSafeInteger(item.originVersion) || Number(item.originVersion) < 1) {
    throw new Error('Le poste a changé ; rechargez les résultats budgétaires.');
  }
  return { scenarioId: item.originScenarioId, itemId: item.originItemId, expectedVersion: Number(item.originVersion) };
}

/** Keep report identifiers internal; distinguish identical titles by their
 * position among the reports displayed for this budget item. */
export function budgetReportLabel(reportId: string | null | undefined, reports: Array<{ id: string; title?: string | null }>, fallbackTitle?: string | null): string {
  const report = reports.find((entry) => entry.id === reportId);
  const publicTitle = (value?: string | null) => {
    const title = value?.trim() || '';
    return title && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(title) ? budgetPublicExplanation(title) : 'Rapport source';
  };
  const title = publicTitle(report?.title || fallbackTitle);
  const sameTitle = reports.filter((entry) => publicTitle(entry.title) === title);
  const position = sameTitle.findIndex((entry) => entry.id === reportId);
  return sameTitle.length > 1 && position >= 0 ? `${title} (${position + 1}/${sameTitle.length})` : title;
}

/** Old persisted AI estimates can contain an internal grouping field. Keep
 * stored evidence unchanged while presenting an understandable explanation. */
export function budgetPublicExplanation(value: string | null | undefined): string {
  return (value || '')
    .replace(/\bpricingCohortKey\b/g, 'regroupement budgétaire')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, 'référence interne');
}

/** A filtered row takes the highest available report estimate. Do not reuse
 * the broader scenario's AI narrative for that narrower report selection. */
export function budgetGoverningReportEstimates(
  amount: unknown,
  estimates: Array<{ reportId?: string; reportTitle?: string; totalHt?: string; rationale?: string }> = [],
) {
  const cents = (value: unknown): bigint | null => {
    const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    return match ? BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0')) : null;
  };
  const retained = cents(amount);
  return retained === null ? [] : estimates.filter((estimate) => cents(estimate.totalHt) === retained);
}

export function canRecalculateBudgetItem(prompt: string, lockedManual: boolean, busy: boolean): boolean {
  return Boolean(prompt.trim()) && !lockedManual && !busy;
}

/** A retained AI proposal is historical evidence, not the current label of a
 * human-validated and locked budget amount. */
export function budgetItemEstimateDisplay(item: { status?: string | null; lockedManual?: boolean | null; aiEstimateDetails?: unknown }) {
  const hasAiEstimate = Boolean(item.aiEstimateDetails);
  const humanValidated = item.status === 'VALIDE' && Boolean(item.lockedManual);
  return {
    amountLabel: humanValidated ? 'Montant validé' : hasAiEstimate ? 'Estimation IA' : null,
    showEstimateRange: hasAiEstimate && !humanValidated,
  };
}

export function budgetRefreshScenarioId(job: { scenarioId?: string; targetScenarioId?: string } | null | undefined, fallback?: string) {
  return job?.scenarioId || job?.targetScenarioId || fallback || null;
}

export function budgetCommandPayload(mode: BudgetExecutionMode, selection: BudgetClientSelection, confirmationToken: string) {
  return { mode, confirmationToken, ...budgetExecutionPeriod(mode, selection), categoryId: selection.categoryId, severity: selection.severity, clientKeys: selection.clientKeys };
}

export function budgetConfirmationAfterConflict(current: { mode: BudgetExecutionMode; globalArmed: boolean } | null, preview: unknown) {
  return { mode: current?.mode || 'CURRENT_YEAR', globalArmed: false, preview };
}

export function budgetResumeResult(job: { status?: string; finalScenarioId?: string | null; scenarioId?: string; targetScenarioId?: string; lastError?: string | null; failedReason?: string | null }, fallback?: string) {
  const status = String(job.status || '').toUpperCase();
  return {
    terminal: ['COMPLETED', 'PUBLISHED', 'FAILED', 'QUARANTINED'].includes(status),
    completed: status === 'COMPLETED' || status === 'PUBLISHED',
    scenarioId: job.finalScenarioId || budgetRefreshScenarioId(job, fallback),
    error: job.lastError || job.failedReason || null,
  };
}
