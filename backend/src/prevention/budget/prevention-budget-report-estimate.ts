import { createHash } from 'crypto';
import type { PreventionBudgetAiEstimate, PreventionBudgetEstimateInput } from './prevention-budget-estimation-ai.service';

/** All cost-relevant inputs are included; report/finding IDs alone are not a source version. */
export function budgetReportEstimateInputHash(input: PreventionBudgetEstimateInput): string {
  return createHash('sha256').update(JSON.stringify({
    itemKey: input.pricingCohortKey ?? input.itemKey,
    reportId: input.reportId,
    title: input.title,
    actionType: input.actionType ?? null,
    categoryKey: input.categoryKey,
    priority: input.priority,
    recommendations: [...input.recommendations].sort(),
    observations: [...(input.observations ?? [])].sort(),
    metricEvidence: [...(input.metricEvidence ?? [])]
      .map((metric) => ({ quantity: metric.quantity, unit: metric.unit, basis: metric.basis, confidence: metric.confidence }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    // A prompt may deliberately change the next explicit price, but it does
    // not change the underlying report/action source shared by other scopes.
    catalogReference: input.catalogReference ?? null,
  })).digest('hex');
}

export function parseBudgetReportEstimate(value: unknown): PreventionBudgetAiEstimate | null {
  try {
    const estimate = typeof value === 'string' ? JSON.parse(value) : value;
    if (!estimate || typeof estimate !== 'object' || Array.isArray(estimate)) return null;
    if (estimate.details?.kind !== 'AI_ESTIMATE' || typeof estimate.totalHt !== 'string' ||
        typeof estimate.quantity !== 'string' || typeof estimate.unitCostHt !== 'string') return null;
    return estimate as PreventionBudgetAiEstimate;
  } catch { return null; }
}
