export type PreventionOperationalStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export interface PreventionHealthSnapshot {
  status: PreventionOperationalStatus;
  dependencies: {
    mysql: PreventionOperationalStatus;
    redis: PreventionOperationalStatus;
  };
  worker: {
    status: PreventionOperationalStatus;
    heartbeatAgeSeconds: number | null;
  };
  alerts: string[];
}

export interface PreventionObservabilitySnapshot {
  queue: Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed', number>;
  outbox: Record<'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED', number>;
  schedulerRuns: Record<'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED', number>;
  checkpoints: Record<'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED', number>;
  tasks: Record<'PENDING' | 'COMPLETED' | 'FAILED', number>;
  oldestPendingAgeSeconds: {
    outbox: number;
    scheduler: number;
    checkpoints: number;
  };
  processing: {
    completedCount: number;
    failedCount: number;
    retriedCount: number;
    averageDurationSeconds: number;
    p95DurationSeconds: number;
  };
  retries: {
    outboxEvents: number;
    outboxAttempts: number;
  };
  progression: {
    processedOrganizations: number;
    processedReports: number;
    pendingJobs: number;
    failedJobs: number;
  };
  health: PreventionHealthSnapshot;
}
