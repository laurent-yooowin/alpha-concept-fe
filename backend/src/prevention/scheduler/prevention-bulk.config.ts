import { ConfigService } from '@nestjs/config';
import { PreventionBulkExecutionMode } from './prevention-bulk-admission.types';

export interface PreventionBulkConfiguration {
  immediateRebuildCeiling: number;
  immediateBudgetCeiling: number;
  windowStartHour: number;
  windowEndHour: number;
  leaseSeconds: number;
  retryDelaySeconds: number;
}

function boundedInteger(config: ConfigService, key: string, fallback: number, min: number, max: number): number {
  const value = Number(config.get(key, fallback));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadPreventionBulkConfiguration(config: ConfigService): PreventionBulkConfiguration {
  const windowStartHour = boundedInteger(config, 'PREVENTION_BULK_WINDOW_START_HOUR', 22, 0, 23);
  const windowEndHour = boundedInteger(config, 'PREVENTION_BULK_WINDOW_END_HOUR', 6, 0, 23);
  if (windowStartHour === windowEndHour) throw new Error('PREVENTION_BULK window must not be empty');
  return {
    // This is a work-unit ceiling (reports + findings), deliberately not an
    // implicit interpretation of the ALL period label.
    immediateRebuildCeiling: boundedInteger(config, 'PREVENTION_REBUILD_IMMEDIATE_CEILING', 5_000, 1, 10_000_000),
    immediateBudgetCeiling: boundedInteger(config, 'PREVENTION_BUDGET_IMMEDIATE_CEILING', 1_000, 1, 10_000_000),
    windowStartHour,
    windowEndHour,
    leaseSeconds: boundedInteger(config, 'PREVENTION_BULK_LEASE_SECONDS', 900, 60, 86_400),
    retryDelaySeconds: boundedInteger(config, 'PREVENTION_BULK_RETRY_DELAY_SECONDS', 60, 5, 3_600),
  };
}

function parisHour(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(date));
}

export function preventionBulkWindowKey(date: Date, configuration: PreventionBulkConfiguration): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  let year = Number(parts.year); let month = Number(parts.month); let day = Number(parts.day);
  if (isWithinPreventionBulkWindow(date, configuration) && parisHour(date) < configuration.windowEndHour) {
    const previous = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
    year = previous.getUTCFullYear(); month = previous.getUTCMonth() + 1; day = previous.getUTCDate();
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}@${String(configuration.windowStartHour).padStart(2, '0')}:00`;
}

export function isWithinPreventionBulkWindow(date: Date, configuration: PreventionBulkConfiguration): boolean {
  const hour = parisHour(date);
  return configuration.windowStartHour > configuration.windowEndHour
    ? hour >= configuration.windowStartHour || hour < configuration.windowEndHour
    : hour >= configuration.windowStartHour && hour < configuration.windowEndHour;
}

/** Find the first instant at which the local Paris window is open. */
export function nextPreventionBulkWindowStart(now: Date, configuration: PreventionBulkConfiguration): Date {
  if (isWithinPreventionBulkWindow(now, configuration)) return new Date(now);
  // Stepping in minutes handles CET/CEST changes without making assumptions
  // about the offset. The loop is bounded to 48 hours.
  const candidate = new Date(now.getTime());
  candidate.setUTCSeconds(0, 0);
  for (let i = 0; i <= 48 * 60; i += 1) {
    if (parisHour(candidate) === configuration.windowStartHour && !isWithinPreventionBulkWindow(new Date(candidate.getTime() - 60_000), configuration)) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error('Unable to determine next Europe/Paris Prevention bulk window');
}

export function executionModeForVolume(reportCount: number, findingCount: number, configuration: PreventionBulkConfiguration): PreventionBulkExecutionMode {
  if (!Number.isSafeInteger(reportCount) || reportCount < 0 || !Number.isSafeInteger(findingCount) || findingCount < 0) {
    throw new Error('Invalid Prevention reconstruction volume');
  }
  return reportCount + findingCount <= configuration.immediateRebuildCeiling ? 'IMMEDIATE' : 'SCHEDULED';
}
