import { PREVENTION_BUDGET_JOB_NAMES } from '../budget/prevention-budget.types';
export const PREVENTION_DIFFERENTIAL_JOB = 'prevention.scheduler.differential';
export const PREVENTION_CONSOLIDATION_JOB = 'prevention.scheduler.consolidation';
export const PREVENTION_WEEKLY_AUDIT_JOB = 'prevention.scheduler.weekly-audit';
export const PREVENTION_MONTHLY_AUDIT_JOB = 'prevention.scheduler.monthly-audit';
export const PREVENTION_CLEANUP_JOB = 'prevention.scheduler.cleanup';
export const PREVENTION_ORGANIZATION_SCAN_JOB = 'prevention.scheduler.organization-scan';
export const PREVENTION_AUDIT_REPORT_JOB = 'prevention.scheduler.audit-report';
export const PREVENTION_RECOVERY_JOB = 'prevention.scheduler.recovery';
export const PREVENTION_MANUAL_REBUILD_JOB = 'prevention.scheduler.manual-rebuild';
export const PREVENTION_HYPER_ADMIN_RECOVERY_JOB = 'prevention.hyper-admin.recovery';

export const PREVENTION_SCHEDULED_JOBS = [
  PREVENTION_DIFFERENTIAL_JOB,
  PREVENTION_CONSOLIDATION_JOB,
  PREVENTION_WEEKLY_AUDIT_JOB,
  PREVENTION_MONTHLY_AUDIT_JOB,
  PREVENTION_CLEANUP_JOB,
  PREVENTION_ORGANIZATION_SCAN_JOB,
  PREVENTION_RECOVERY_JOB,
  PREVENTION_MANUAL_REBUILD_JOB,
] as const;

export const PREVENTION_SCHEDULER_TECHNICAL_JOBS: readonly string[] = [
  ...PREVENTION_SCHEDULED_JOBS,
  PREVENTION_AUDIT_REPORT_JOB,
  ...PREVENTION_BUDGET_JOB_NAMES,
];

export type PreventionScheduledJobName = typeof PREVENTION_SCHEDULED_JOBS[number];

export interface PreventionSchedulerPayload {
  scheduledFor: string;
  cursor: string | null;
}

export const PREVENTION_SCHEDULE_DEFINITIONS: ReadonlyArray<{
  id: string; name: PreventionScheduledJobName; configKey: string;
}> = [
  { id: 'prevention-differential-v1', name: PREVENTION_DIFFERENTIAL_JOB, configKey: 'differentialPattern' },
  { id: 'prevention-consolidation-v1', name: PREVENTION_CONSOLIDATION_JOB, configKey: 'consolidationPattern' },
  { id: 'prevention-weekly-audit-v1', name: PREVENTION_WEEKLY_AUDIT_JOB, configKey: 'weeklyAuditPattern' },
  { id: 'prevention-monthly-audit-v1', name: PREVENTION_MONTHLY_AUDIT_JOB, configKey: 'monthlyAuditPattern' },
  { id: 'prevention-cleanup-v1', name: PREVENTION_CLEANUP_JOB, configKey: 'cleanupPattern' },
];

export interface PreventionOrganizationScanPayload {
  scheduledFor: string;
  organizationId: string;
  parentJobType: typeof PREVENTION_DIFFERENTIAL_JOB |
    typeof PREVENTION_CONSOLIDATION_JOB | typeof PREVENTION_WEEKLY_AUDIT_JOB |
    typeof PREVENTION_MONTHLY_AUDIT_JOB;
  reportCursor: string | null;
  runId?: string;
}

export interface PreventionRecoveryPayload {
  scheduledFor: string;
  recoveryType: 'RUN' | 'CHECKPOINT' | 'TASK';
  cursor: string | null;
}

export interface PreventionManualRebuildPayload { organizationId: string; runId: string; scheduledFor: string; }
