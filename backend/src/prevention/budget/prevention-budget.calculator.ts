import { Injectable } from '@nestjs/common';
import {
  PreventionBudgetCalculation,
  PreventionBudgetLineInput,
  PreventionBudgetStatus,
} from './prevention-budget.types';

const LOCKED_STATUSES: readonly PreventionBudgetStatus[] = ['VALIDE', 'ENGAGE', 'REALISE'];

function decimalToScaled(value: string, scale: number, maxIntegerDigits = 16): bigint {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error('Invalid non-negative decimal');
  const [whole, fraction = ''] = normalized.split('.');
  if (whole.length > maxIntegerDigits) throw new Error('Decimal integer part exceeds monetary bounds');
  if (fraction.length > scale) throw new Error(`Decimal scale exceeds ${scale}`);
  return BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
}

function scaledToDecimal(value: bigint, scale: number): string {
  const base = 10n ** BigInt(scale);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(scale, '0');
  return `${whole}.${fraction}`;
}

export function parseCents(value: string): bigint {
  return decimalToScaled(value, 2);
}

export function formatCents(value: bigint): string {
  if (value < 0n) throw new Error('Negative monetary amount');
  const formatted = scaledToDecimal(value, 2);
  if (formatted.split('.')[0].length > 16) throw new Error('Monetary amount exceeds DECIMAL(18,2) bounds');
  return formatted;
}

function multiplyQuantityByCents(quantity: string, unitCostCents: bigint): bigint {
  const quantityScaled = decimalToScaled(quantity, 4, 14);
  const raw = quantityScaled * unitCostCents;
  const divisor = 10_000n;
  const remainder = raw % divisor;
  return raw / divisor + (remainder >= divisor / 2n ? 1n : 0n);
}

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

export function calculatePreventionBudget(
  inputs: PreventionBudgetLineInput[],
  contingencyRatePercent: string,
): PreventionBudgetCalculation {
  parseCents(contingencyRatePercent);
  if (parseCents(contingencyRatePercent) > 10_000n) throw new Error('Contingency rate must be between 0 and 100 percent');

  const lines = inputs.map((input): PreventionBudgetCalculation['lines'][number] => {
    const manualLocked = input.manual && (Boolean(input.manual.lockedManual) || LOCKED_STATUSES.includes(input.manual.status));
    const priority = manualLocked ? input.manual!.priority : input.priority;
    const unitCostValue = manualLocked ? input.manual!.unitCostHt : input.aiEstimate?.unitCostHt ?? input.catalogMatch?.unitCostHt ?? null;
    const priceSource = manualLocked ? input.manual!.priceSource : input.aiEstimate ? 'Estimation IA — indicative, à valider' : input.catalogMatch?.priceSource ?? null;
    const estimatedQuantity = manualLocked ? input.manual!.quantity : input.aiEstimate?.quantity ?? input.quantity;
    const estimatedUnit = manualLocked ? input.manual!.unit : input.aiEstimate?.unit ?? input.unit;
    const hasSourcedPrice = unitCostValue !== null && Boolean(priceSource?.trim());
    if (manualLocked && !hasSourcedPrice) {
      throw new Error('Locked manual budget line requires a sourced price');
    }
    const status = manualLocked ? input.manual!.status : hasSourcedPrice ? 'ESTIME' : 'A_CHIFFRER';
    const unitCostCents = hasSourcedPrice ? parseCents(unitCostValue!) : null;
    const totalCents = unitCostCents === null ? 0n : multiplyQuantityByCents(estimatedQuantity, unitCostCents);
    if (!manualLocked && input.aiEstimate && totalCents !== parseCents(input.aiEstimate.totalHt)) {
      throw new Error('AI estimate total does not match quantity and unit cost');
    }
    return {
      itemKey: input.itemKey,
      title: input.title,
      categoryId: input.categoryId,
      categoryKey: input.categoryKey,
      clientKey: input.clientKey ?? null,
      clientLabel: input.clientLabel ?? null,
      priority,
      quantity: estimatedQuantity,
      unit: estimatedUnit,
      unitCostHt: unitCostCents === null ? null : formatCents(unitCostCents),
      totalHt: formatCents(totalCents),
      status,
      priceSource,
      lockedManual: Boolean(manualLocked),
      aiEstimateDetails: manualLocked ? input.manual!.aiEstimateDetails ?? null : input.aiEstimate?.details ?? null,
    };
  });

  const priced = lines.map((line) => parseCents(line.totalHt)).filter((_, index) => lines[index].status !== 'A_CHIFFRER');
  const retained = sum(priced);
  const estimated = sum(lines.map((line) => line.status === 'ESTIME' ? parseCents(line.totalHt) : 0n));
  const validated = sum(lines.map((line) => LOCKED_STATUSES.includes(line.status) ? parseCents(line.totalHt) : 0n));
  return {
    lines,
    totals: {
      retainedBudgetHt: formatCents(retained),
      estimatedBudgetHt: formatCents(estimated),
      validatedBudgetHt: formatCents(validated),
      contingencyRatePercent: '0.00',
      contingencyAmountHt: '0.00',
      totalBudgetHt: formatCents(retained),
    },
  };
}


@Injectable()
export class PreventionBudgetCalculatorService {
  calculate(inputs: PreventionBudgetLineInput[], contingencyRatePercent: string): PreventionBudgetCalculation {
    return calculatePreventionBudget(inputs, contingencyRatePercent);
  }
}
