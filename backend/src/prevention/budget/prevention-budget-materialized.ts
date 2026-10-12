import { createHash } from 'crypto';
import { parseCents } from './prevention-budget.calculator';

type MaterializedBudgetRow = {
  id: string; organizationId?: string; scenarioId: string; itemKey: string; clientKey?: string | null;
  clientLabel?: string | null; title?: string | null;
  scenarioKey?: string; actionResult?: boolean;
  status: string; totalHt: string; lockedManual?: number | boolean;
  createdAt?: Date | string; scenarioCreatedAt?: Date | string; aiEstimateDetails?: unknown;
  [key: string]: unknown;
};

type MaterializedBudgetSource = {
  itemId: string; sourceKind: string; sourceKey: string;
  findingId?: string | null; reportId?: string | null;
  reportTitle?: string | null; reportFileUrl?: string | null;
  recommendationContent?: string | null; regulatoryReferences?: unknown;
  [key: string]: unknown;
};

const HUMAN_STATUSES = new Set(['VALIDE', 'ENGAGE', 'REALISE']);

export function materializedActionScopeKey(organizationId: string, itemKey: string): string {
  return createHash('sha256').update(`budget-target-action-all-v1|${organizationId}|${itemKey}`).digest('hex');
}

function cents(value: unknown): bigint {
  const match = /^([0-9]{1,16})(?:\.([0-9]{1,2}))?$/.exec(String(value ?? '0'));
  return match ? BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0')) : 0n;
}

function details(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const result = typeof value === 'string' ? JSON.parse(value) : value;
    return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
  } catch { return null; }
}

function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [value]; }
  catch { return [value]; }
}

function isHuman(row: MaterializedBudgetRow): boolean {
  return Boolean(row.lockedManual) || HUMAN_STATUSES.has(row.status);
}

/** Read-only merge of the latest materialized versions. Its total is deliberately
 * not a completed global budget: some reports may never have been estimated. */
export function consolidateMaterializedBudgetRows(rows: MaterializedBudgetRow[], sources: MaterializedBudgetSource[], restrictToVisibleReports = false) {
  const sourcesByItem = new Map<string, MaterializedBudgetSource[]>();
  for (const source of sources) sourcesByItem.set(source.itemId, [...(sourcesByItem.get(source.itemId) ?? []), source]);
  const groups = new Map<string, MaterializedBudgetRow[]>();
  for (const row of rows) {
    // Historical rows without client identity must not silently merge clients.
    const key = row.clientKey ? `${row.clientKey}|${row.itemKey}` : `legacy|${row.scenarioId}|${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([groupKey, members]) => {
    const ordered = [...members].sort((a, b) => {
      if (isHuman(a) !== isHuman(b)) return isHuman(a) ? -1 : 1;
      if (Boolean(a.actionResult) !== Boolean(b.actionResult)) return a.actionResult ? -1 : 1;
      if (isHuman(a) && isHuman(b)) {
        const dateOrder = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
        if (dateOrder) return dateOrder;
      }
      const amountA = cents(a.totalHt); const amountB = cents(b.totalHt);
      return amountA === amountB ? String(a.id).localeCompare(String(b.id)) : amountA > amountB ? -1 : 1;
    });
    const governing = ordered[0];
    const mergedSources = new Map<string, MaterializedBudgetSource>();
    const reportEstimates = new Map<string, Record<string, unknown>>();
    const hasActionResult = members.some((member) => member.actionResult);
    for (const member of members) {
      for (const source of sourcesByItem.get(member.id) ?? []) {
        mergedSources.set(`${source.sourceKind}|${source.sourceKey}|${source.reportId ?? ''}`, source);
      }
      if (hasActionResult && !member.actionResult) continue;
      const estimates = details(member.aiEstimateDetails)?.sourceReportEstimates;
      if (Array.isArray(estimates)) for (const value of estimates) {
        if (!value || typeof value !== 'object') continue;
        const estimate = value as Record<string, unknown>;
        if (typeof estimate.reportId !== 'string' || !estimate.reportId) continue;
        const previous = reportEstimates.get(estimate.reportId);
        if (!previous || cents(estimate.totalHt) > cents(previous.totalHt)) reportEstimates.set(estimate.reportId, estimate);
      }
    }
    const sourceRows = [...mergedSources.values()];
    const reports = [...new Map(sourceRows.filter((source) => source.reportId).map((source) => [String(source.reportId), {
      id: String(source.reportId), title: source.reportTitle ?? null, url: source.reportFileUrl ?? null,
    }])).values()];
    const reportIds = new Set(reports.map((report) => report.id));
    const visibleEstimates = [...reportEstimates.values()].filter((estimate) => reportIds.has(String(estimate.reportId)));
    const latestScenarioTime = members.reduce((latest, member) => Math.max(latest, scenarioTime(member.scenarioCreatedAt) ?? -Infinity), -Infinity);
    const bestVisible = visibleEstimates.sort((a, b) => cents(a.totalHt) === cents(b.totalHt)
      ? String(a.reportId).localeCompare(String(b.reportId)) : cents(a.totalHt) > cents(b.totalHt) ? -1 : 1)[0];
    const selectedAmount = restrictToVisibleReports && !isHuman(governing)
      ? (bestVisible ? String(bestVisible.totalHt) : '0.00') : governing.totalHt;
    const selectedStatus = restrictToVisibleReports && !isHuman(governing) && !bestVisible ? 'A_CHIFFRER' : governing.status;
    const aiDetails = restrictToVisibleReports && !isHuman(governing) ? null : details(governing.aiEstimateDetails);
    return {
      ...governing, id: groupKey, originItemId: governing.id, originScenarioId: governing.scenarioId,
      totalHt: selectedAmount, status: selectedStatus,
      aiEstimateDetails: aiDetails,
      sourceReportEstimates: visibleEstimates,
      sources: sourceRows, justificationDetails: {
        context: governing.justification ?? null,
        recommendations: [...new Set(sourceRows.map((source) => source.recommendationContent).filter((value): value is string => typeof value === 'string' && Boolean(value)))],
        baseReglementaire: [...new Set(sourceRows.flatMap((source) => references(source.regulatoryReferences)))],
        costBreakdown: restrictToVisibleReports && !isHuman(governing)
          ? { quantity: '1', unit: 'FORFAIT', unitCostHt: bestVisible ? selectedAmount : null, totalHt: selectedAmount, priceSource: 'Estimation par rapport déjà enregistrée' }
          : { quantity: String(governing.quantity ?? '1'), unit: String(governing.unit ?? 'FORFAIT'), unitCostHt: governing.unitCostHt == null ? null : String(governing.unitCostHt), totalHt: selectedAmount, priceSource: governing.priceSource ?? null },
        aiEstimate: aiDetails, reports,
      },
      materializedOnly: true, reportCount: reports.length,
      latestScenarioTime,
      amountFromSelectedReports: restrictToVisibleReports,
      conflictingHumanAmounts: ordered.filter((row) => isHuman(row)).some((row) => cents(row.totalHt) !== cents(governing.totalHt)),
    };
  }).sort((a, b) => String(a.clientLabel ?? '').localeCompare(String(b.clientLabel ?? ''), 'fr') || String(a.title ?? '').localeCompare(String(b.title ?? ''), 'fr'));
}

type ConsolidatedBudgetRow = ReturnType<typeof consolidateMaterializedBudgetRows>[number];

/** A provisional sum of the already materialized, deduplicated action rows.
 * It is not the published global budget and deliberately excludes contingencies. */
export function sumAvailableMaterializedBudgetRows(items: ConsolidatedBudgetRow[]): string | null {
  let total = 0n;
  for (const item of items) {
    if (item.status === 'A_CHIFFRER') continue;
    try { total += parseCents(String(item.totalHt)); }
    catch { return null; }
  }
  // The read-only sum may exceed one DECIMAL(18,2) row; it is never written to
  // a DECIMAL column, so format the bounded-by-row-count bigint directly.
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

function scenarioTime(value: unknown): number | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Remove only unpriced historical duplicates whose every visible recommendation
 * is already covered by a newer priced result for the same tenant and client.
 * Stored scenarios and their sources remain untouched. */
export function excludeSupersededUnpricedBudgetRows(
  items: ConsolidatedBudgetRow[], rows: MaterializedBudgetRow[], sources: MaterializedBudgetSource[],
): ConsolidatedBudgetRow[] {
  const latestPricedSource = new Map<string, number>();
  const sourceKey = (row: Pick<MaterializedBudgetRow, 'organizationId' | 'clientKey'>, source: MaterializedBudgetSource) =>
    `${String(row.organizationId ?? '')}|${row.clientKey}|${source.findingId}|${source.reportId}`;
  const sourcesByItem = new Map<string, MaterializedBudgetSource[]>();
  for (const source of sources) sourcesByItem.set(source.itemId, [...(sourcesByItem.get(source.itemId) ?? []), source]);
  // Price provenance belongs to the persisted item, not its consolidated
  // display row: members from different scenario versions may be merged.
  for (const row of rows) {
    if (!row.clientKey || row.status === 'A_CHIFFRER' || (!isHuman(row) && cents(row.totalHt) === 0n)) continue;
    const time = scenarioTime(row.scenarioCreatedAt);
    if (time === null) continue;
    const estimates = details(row.aiEstimateDetails)?.sourceReportEstimates;
    const estimatedReports = new Set(Array.isArray(estimates) ? estimates
      .filter((estimate) => estimate && typeof estimate === 'object' && cents(estimate.totalHt) > 0n)
      .map((estimate) => String(estimate.reportId)) : []);
    for (const source of sourcesByItem.get(row.id) ?? []) {
      if (source.sourceKind !== 'RECOMMENDATION' || !source.findingId || !source.reportId) continue;
      if (!isHuman(row) && !estimatedReports.has(String(source.reportId))) continue;
      const key = sourceKey(row, source);
      latestPricedSource.set(key, Math.max(latestPricedSource.get(key) ?? -Infinity, time));
    }
  }
  return items.filter((old) => {
    if (old.status !== 'A_CHIFFRER' || !old.clientKey || !old.sources.length) return true;
    const oldTime = old.latestScenarioTime;
    if (!Number.isFinite(oldTime)) return true;
    const oldSources = old.sources.filter((source) => source.sourceKind === 'RECOMMENDATION');
    if (!oldSources.length || oldSources.some((source) => !source.findingId || !source.reportId)) return true;
    return !oldSources.every((source) => (latestPricedSource.get(sourceKey(old, source)) ?? -Infinity) > oldTime);
  });
}
