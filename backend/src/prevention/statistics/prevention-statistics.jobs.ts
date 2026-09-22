export const PREVENTION_STATISTICS_REFRESH_JOB = 'prevention.statistics.refresh';

export interface PreventionStatisticsRefreshPayload {
  organizationId: string;
  referenceDate: string;
  triggerEventId: string;
}
