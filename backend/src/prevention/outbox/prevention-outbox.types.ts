export type PreventionReportEventType = 'REPORT_UPSERTED' | 'REPORT_DELETED';

export interface PreventionReportEventPayload {
  eventId: string;
  organizationId: string;
  reportId: string;
  eventType: PreventionReportEventType;
  aggregateVersion: string;
  occurredAt: string;
}

export const PREVENTION_QUEUE_NAME = 'prevention';
export const PREVENTION_UPSERT_JOB = 'prevention.report.upsert';
export const PREVENTION_DELETE_JOB = 'prevention.report.delete';

export function preventionDeduplicationKey(
  organizationId: string,
  reportId: string,
  eventType: PreventionReportEventType,
  aggregateVersion: string,
): string {
  return `report:${organizationId}:${reportId}:${eventType}:${aggregateVersion}`;
}
