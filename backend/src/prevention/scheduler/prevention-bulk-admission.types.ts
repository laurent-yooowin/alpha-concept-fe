export type PreventionBulkWorkKind = 'AUTOMATIC' | 'ADMIN_RECONSTRUCTION' | 'BUDGET';

export type PreventionBulkExecutionMode = 'IMMEDIATE' | 'SCHEDULED';

export interface PreventionBulkLease {
  organizationId: string;
  runId: string;
  workKind: PreventionBulkWorkKind;
  leaseToken: string;
}

export interface PreventionBulkAdmissionRequest {
  organizationId: string;
  runId: string;
  workKind: PreventionBulkWorkKind;
  scheduledFor?: string;
  /** Heavy Budget callers must pass this; omitted BUDGET is conservatively scheduled. */
  executionMode?: PreventionBulkExecutionMode;
}

export interface PreventionBulkAdmissionResult {
  admitted: boolean;
  lease?: PreventionBulkLease;
  availableAt: string | null;
  reason: 'ADMITTED' | 'ORGANIZATION_BUSY' | 'AUTOMATIC_WORK_DUE' | 'OUTSIDE_WINDOW' | 'DISABLED';
}

/**
 * Common hook for every deliberately heavy Prevention path. Real-time report
 * and group queues do not use this contract. Implementations must fence every
 * page with assertLease() before writing durable results.
 */
export interface PreventionBulkAdmissionHook {
  admit(request: PreventionBulkAdmissionRequest): Promise<PreventionBulkAdmissionResult>;
  assertLease(lease: PreventionBulkLease): Promise<void>;
  renew(lease: PreventionBulkLease): Promise<void>;
  release(lease: PreventionBulkLease): Promise<void>;
  /** Keeps the lease alive during long work; callers still assert immediately before commit. */
  withLease<T>(lease: PreventionBulkLease, operation: () => Promise<T>): Promise<T>;
}
