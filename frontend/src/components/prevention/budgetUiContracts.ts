import type { PreventionQuery } from '../../lib/api';

export type BudgetClientSelection = Pick<PreventionQuery, 'preset' | 'from' | 'to' | 'categoryId' | 'categoryIds' | 'severity' | 'severities' | 'missionId' | 'missionIds'> & {
  clientKeys?: string[];
};

const selectedValues = <T extends string>(values: T[] | undefined, legacy?: T): T[] => Array.isArray(values) ? [...values] : legacy ? [legacy] : [];

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
  const categoryIds = selectedValues(selection.categoryIds, selection.categoryId);
  const severities = selectedValues(selection.severities, selection.severity);
  const missionIds = selectedValues(selection.missionIds, selection.missionId);
  return {
    preset: selection.preset || 'ALL', from: selection.from, to: selection.to,
    categoryId: Array.isArray(selection.categoryIds) ? undefined : selection.categoryId, categoryIds,
    severity: Array.isArray(selection.severities) ? undefined : selection.severity, severities,
    missionId: Array.isArray(selection.missionIds) ? undefined : selection.missionId, missionIds,
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
  const query = { ...selection, clientKeys: [...(selection.clientKeys || [])] } as BudgetClientSelection;
  if (Array.isArray(selection.categoryIds)) query.categoryId = undefined;
  if (Array.isArray(selection.severities)) query.severity = undefined;
  if (Array.isArray(selection.missionIds)) query.missionId = undefined;
  return query;
}

/** Global comparison must never inherit active display filters. */
export function budgetGlobalSelectionQuery() {
  return { preset: 'ALL' as const, clientKeys: [] as string[] };
}

/** Stable identity for the visible Budget filter scope, independent of selection order. */
export function budgetSelectionKey(selection: BudgetClientSelection): string {
  return JSON.stringify([
    selection.preset || '', selection.from || '', selection.to || '',
    selectedValues(selection.categoryIds, selection.categoryId).sort(),
    selectedValues(selection.severities, selection.severity).sort(),
    selectedValues(selection.missionIds, selection.missionId).sort(),
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

type MaterializedScope = {
  preset?: string;
  from?: string;
  to?: string;
  missionId?: string;
  missionIds?: string[];
  categoryId?: string;
  categoryIds?: string[];
  severity?: string;
  severities?: string[];
  clientKeys?: string[];
};

/** A materialized row may only be edited when its persisted origin scope is
 * exactly the displayed scope. Missing origin metadata is intentionally
 * rejected for a narrowed selection to avoid writing into a wider scenario. */
export function budgetMaterializedScopeMatches(item: {
  originMissionId?: string | null; originMissionIds?: string[] | string | null;
  originCategoryId?: string | null; originCategoryIds?: string[] | string | null;
  originSeverity?: string | null; originSeverities?: string[] | string | null;
  originClientKeys?: string[] | string | null; originPeriodMode?: string | null;
  originPeriodStart?: string | null; originPeriodEnd?: string | null;
}, selection: MaterializedScope): boolean {
  const parse = (value: string[] | string | null | undefined): string[] | null => {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean).sort();
    const raw = value.trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      try {
        const decoded = JSON.parse(raw);
        return Array.isArray(decoded) ? decoded.map(String).filter(Boolean).sort() : null;
      } catch { return null; }
    }
    return [raw];
  };
  const current = (values: string[] | undefined, legacy?: string) => selectedValues(values, legacy).map(String).filter(Boolean).sort();
  const same = (left: string[], right: string[]) => left.length === right.length && left.every((value, index) => value === right[index]);
  const selectedMissions = current(selection.missionIds, selection.missionId);
  const selectedCategories = current(selection.categoryIds, selection.categoryId);
  const selectedSeverities = current(selection.severities, selection.severity);
  const originMissions = parse(item.originMissionIds); if (originMissions === null) return false; if (!originMissions.length && item.originMissionId) originMissions.push(String(item.originMissionId));
  const originCategories = parse(item.originCategoryIds); if (originCategories === null) return false; if (!originCategories.length && item.originCategoryId) originCategories.push(String(item.originCategoryId));
  const originSeverities = parse(item.originSeverities); if (originSeverities === null) return false; if (!originSeverities.length && item.originSeverity) originSeverities.push(String(item.originSeverity));
  if (!same(selectedMissions, originMissions) || !same(selectedCategories, originCategories) || !same(selectedSeverities, originSeverities)) return false;
  const selectedClients = current(selection.clientKeys);
  const originClients = parse(item.originClientKeys); if (originClients === null) return false;
  if (!same(selectedClients, originClients)) return false;
  const bounded = selection.preset && selection.preset !== 'ALL';
  if (item.originPeriodMode == null) return !bounded && !selection.from && !selection.to;
  if (String(item.originPeriodMode).toUpperCase() === 'ALL') return !bounded && !selection.from && !selection.to;
  if (!selection.from || !selection.to) return false;
  return Boolean(item.originPeriodStart && item.originPeriodEnd && selection.from && selection.to
    && item.originPeriodStart.slice(0, 10) === selection.from.slice(0, 10)
    && item.originPeriodEnd.slice(0, 10) === selection.to.slice(0, 10));
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
  const hasCategoryArray = Array.isArray(selection.categoryIds);
  const hasSeverityArray = Array.isArray(selection.severities);
  const hasMissionArray = Array.isArray(selection.missionIds);
  return {
    mode, confirmationToken, ...budgetExecutionPeriod(mode, selection), categoryId: hasCategoryArray ? undefined : selection.categoryId,
    ...(selection.categoryIds?.length ? { categoryIds: [...selection.categoryIds] } : {}),
    severity: hasSeverityArray ? undefined : selection.severity, ...(selection.severities?.length ? { severities: [...selection.severities] } : {}),
    missionId: hasMissionArray ? undefined : selection.missionId, ...(selection.missionIds?.length ? { missionIds: [...selection.missionIds] } : {}), clientKeys: selection.clientKeys,
  };
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
