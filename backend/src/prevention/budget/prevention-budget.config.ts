import { ConfigService } from '@nestjs/config';

export function loadPreventionBudgetContingencyRate(config: ConfigService): string {
  const raw = String(config.get('PREVENTION_BUDGET_CONTINGENCY_RATE_PERCENT', '10')).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error('PREVENTION_BUDGET_CONTINGENCY_RATE_PERCENT must be a non-negative percentage with at most two decimals');
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('PREVENTION_BUDGET_CONTINGENCY_RATE_PERCENT must be between 0 and 100');
  }
  return value.toFixed(2);
}

