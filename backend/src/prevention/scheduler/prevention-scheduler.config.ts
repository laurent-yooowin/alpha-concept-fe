import { ConfigService } from '@nestjs/config';

export interface PreventionSchedulerConfiguration {
  enabled: boolean;
  timezone: string;
  organizationBatchSize: number;
  reportBatchSize: number;
  completedRetentionSeconds: number;
  failedRetentionSeconds: number;
  differentialPattern: string;
  consolidationPattern: string;
  weeklyAuditPattern: string;
  monthlyAuditPattern: string;
  cleanupPattern: string;
}

function cron(config: ConfigService, key: string): string {
  const value = String(config.get(key, '')).trim();
  const fields = value.split(/\s+/);
  if ((fields.length !== 5 && fields.length !== 6) || !/^[\d*,\-/\s]+$/.test(value)) {
    throw new Error(`${key} must be a valid cron pattern`);
  }
  const bounds = fields.length === 6
    ? [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
    : [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const validAtom = (atom: string, minimum: number, maximum: number): boolean => {
    const [base, stepText, ...extra] = atom.split('/');
    if (extra.length || (stepText !== undefined &&
        (!/^\d+$/.test(stepText) || Number(stepText) < 1))) return false;
    if (base === '*') return true;
    const range = base.split('-');
    if (range.length > 2 || range.some((part) => !/^\d+$/.test(part))) return false;
    const start = Number(range[0]);
    const end = Number(range[1] ?? range[0]);
    return start >= minimum && end <= maximum && start <= end;
  };
  if (!fields.every((field, index) => field.split(',').every((atom) =>
    validAtom(atom, bounds[index][0], bounds[index][1])))) {
    throw new Error(`${key} must be a valid cron pattern`);
  }
  return value;
}

function integer(config: ConfigService, key: string, minimum: number, maximum: number): number {
  const value = Number(config.get(key));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function loadPreventionSchedulerConfiguration(
  config: ConfigService,
): PreventionSchedulerConfiguration {
  const timezone = String(config.get('PREVENTION_SCHEDULER_TIMEZONE', 'Europe/Paris'));
  if (timezone !== 'Europe/Paris') {
    throw new Error('PREVENTION_SCHEDULER_TIMEZONE must be Europe/Paris');
  }
  const enabled = String(config.get('PREVENTION_SCHEDULER_ENABLED', 'true'));
  if (enabled !== 'true' && enabled !== 'false') {
    throw new Error('PREVENTION_SCHEDULER_ENABLED must be true or false');
  }
  return {
    enabled: enabled === 'true',
    timezone,
    organizationBatchSize: integer(config, 'PREVENTION_SCHEDULER_ORG_BATCH_SIZE', 1, 100),
    reportBatchSize: integer(config, 'PREVENTION_SCHEDULER_REPORT_BATCH_SIZE', 1, 500),
    completedRetentionSeconds: integer(config, 'PREVENTION_SCHEDULER_COMPLETED_RETENTION_SECONDS', 3600, 31_536_000),
    failedRetentionSeconds: integer(config, 'PREVENTION_SCHEDULER_FAILED_RETENTION_SECONDS', 86_400, 31_536_000),
    differentialPattern: cron(config, 'PREVENTION_SCHEDULER_DIFFERENTIAL_CRON'),
    consolidationPattern: cron(config, 'PREVENTION_SCHEDULER_CONSOLIDATION_CRON'),
    weeklyAuditPattern: cron(config, 'PREVENTION_SCHEDULER_WEEKLY_AUDIT_CRON'),
    monthlyAuditPattern: cron(config, 'PREVENTION_SCHEDULER_MONTHLY_AUDIT_CRON'),
    cleanupPattern: cron(config, 'PREVENTION_SCHEDULER_CLEANUP_CRON'),
  };
}
