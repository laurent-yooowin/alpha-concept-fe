export const PREVENTION_BUDGET_BUILD_JOB = 'prevention.budget.build';
export const PREVENTION_BUDGET_RECALCULATE_JOB = 'prevention.budget.recalculate';
export const PREVENTION_BUDGET_RECALCULATE_ITEM_JOB = 'prevention.budget.recalculate-item';
export const PREVENTION_BUDGET_REFRESH_ITEM_JOB = 'prevention.budget.refresh-item';
export const PREVENTION_BUDGET_RECONCILE_JOB = 'prevention.budget.reconcile';
export const PREVENTION_BUDGET_GLOBAL_JOB = 'prevention.budget.global-year';

export const PREVENTION_BUDGET_JOB_NAMES = [
  PREVENTION_BUDGET_BUILD_JOB,
  PREVENTION_BUDGET_RECALCULATE_JOB,
  PREVENTION_BUDGET_RECALCULATE_ITEM_JOB,
  PREVENTION_BUDGET_REFRESH_ITEM_JOB,
  PREVENTION_BUDGET_RECONCILE_JOB,
  PREVENTION_BUDGET_GLOBAL_JOB,
] as const;

export type PreventionBudgetJobName = typeof PREVENTION_BUDGET_JOB_NAMES[number];

export interface PreventionBudgetJobPayload {
  organizationId: string;
  scenarioId: string;
  scenarioVersion: number;
  sourceVersion: string;
  itemId?: string;
  runId?: string;
  year?: number;
  executionMode?: 'IMMEDIATE' | 'SCHEDULED';
  estimateRequestOrder?: number;
}

export type PreventionBudgetStatus =
  | 'A_CHIFFRER'
  | 'ESTIME'
  | 'VALIDE'
  | 'ENGAGE'
  | 'REALISE';

export type PreventionBudgetPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface PreventionBudgetLineInput {
  itemKey: string;
  title: string;
  categoryId: string | null;
  categoryKey: string;
  clientKey?: string | null;
  clientLabel?: string | null;
  priority: PreventionBudgetPriority;
  quantity: string;
  unit: string;
  catalogMatch: {
    id: string;
    unitCostHt: string;
    priceSource: string;
  } | null;
  aiEstimate?: {
    quantity: string;
    unit: string;
    unitCostHt: string;
    totalHt: string;
    details: Record<string, unknown>;
  };
  manual?: {
    quantity: string;
    unit: string;
    unitCostHt: string | null;
    priceSource: string | null;
    status: PreventionBudgetStatus;
    priority: PreventionBudgetPriority;
    lockedManual?: boolean;
    aiEstimateDetails?: Record<string, unknown> | null;
  };
}

export interface PreventionBudgetCalculatedLine {
  itemKey: string;
  title: string;
  categoryId: string | null;
  categoryKey: string;
  clientKey?: string | null;
  clientLabel?: string | null;
  priority: PreventionBudgetPriority;
  quantity: string;
  unit: string;
  unitCostHt: string | null;
  totalHt: string;
  status: PreventionBudgetStatus;
  priceSource: string | null;
  lockedManual: boolean;
  aiEstimateDetails: Record<string, unknown> | null;
}

export interface PreventionBudgetTotals {
  retainedBudgetHt: string;
  estimatedBudgetHt: string;
  validatedBudgetHt: string;
  contingencyRatePercent: string;
  contingencyAmountHt: string;
  totalBudgetHt: string;
}

export interface PreventionBudgetCalculation {
  lines: PreventionBudgetCalculatedLine[];
  totals: PreventionBudgetTotals;
}
