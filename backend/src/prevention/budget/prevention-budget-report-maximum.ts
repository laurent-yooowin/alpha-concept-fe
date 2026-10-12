import { PreventionBudgetAiEstimate } from './prevention-budget-estimation-ai.service';

export interface ReportBudgetEstimate {
  reportId: string;
  estimate: PreventionBudgetAiEstimate;
}

function amountCents(value: string): bigint {
  if (!/^\d{1,16}\.\d{2}$/.test(value)) throw new Error('Invalid report budget estimate');
  const [euros, cents] = value.split('.');
  return BigInt(euros) * 100n + BigInt(cents);
}

export function maximumReportBudgetEstimate(rows: ReportBudgetEstimate[]): PreventionBudgetAiEstimate {
  if (!rows.length) throw new Error('A budget action needs at least one report estimate');
  const sorted = [...rows].sort((a, b) => {
    const amountA = amountCents(a.estimate.totalHt);
    const amountB = amountCents(b.estimate.totalHt);
    return amountA === amountB ? a.reportId.localeCompare(b.reportId) : amountA > amountB ? -1 : 1;
  });
  const governing = sorted[0];
  return {
    ...governing.estimate,
    details: {
      ...governing.estimate.details,
      governingReportId: governing.reportId,
      aggregationRule: 'MAX_PER_CLIENT_ACTION_REPORT',
      sourceReportEstimates: sorted.map(({ reportId, estimate }) => ({
        reportId, totalHt: estimate.totalHt, rangeLowHt: estimate.details.rangeLowHt,
        rangeHighHt: estimate.details.rangeHighHt, rationale: estimate.details.rationale,
      })),
    },
  };
}
