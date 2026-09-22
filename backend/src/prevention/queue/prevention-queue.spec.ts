import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PreventionOutboxStatus } from '../outbox/prevention-outbox.entity';
import {
  preventionDeduplicationKey,
  PreventionReportEventPayload,
} from '../outbox/prevention-outbox.types';
import { preventionJobId, preventionRetryState } from './prevention-queue.service';

test('deduplication and BullMQ ids are deterministic and safe', () => {
  const key = preventionDeduplicationKey(
    'org-a',
    'report-a',
    'REPORT_UPSERTED',
    '2026-08-19T10:00:00.123456Z',
  );
  assert.equal(
    key,
    'report:org-a:report-a:REPORT_UPSERTED:2026-08-19T10:00:00.123456Z',
  );
  assert.equal(preventionJobId(key), preventionJobId(key));
  assert.doesNotMatch(preventionJobId(key), /:/);
  assert.notEqual(
    preventionJobId(key),
    preventionJobId(key.replace('123456', '123457')),
  );
});

test('publisher retries after one, five and thirty minutes before failing', () => {
  const now = Date.parse('2026-08-19T10:00:00.000Z');
  assert.equal(preventionRetryState(1, now).availableAt?.getTime(), now + 60_000);
  assert.equal(preventionRetryState(2, now).availableAt?.getTime(), now + 5 * 60_000);
  assert.equal(preventionRetryState(3, now).availableAt?.getTime(), now + 30 * 60_000);
  assert.equal(preventionRetryState(4, now).status, PreventionOutboxStatus.FAILED);
});

test('queue payload contract contains identifiers and version only', () => {
  const payload: PreventionReportEventPayload = {
    eventId: 'event-a',
    organizationId: 'org-a',
    reportId: 'report-a',
    eventType: 'REPORT_UPSERTED',
    aggregateVersion: '2026-08-19T10:00:00.123456Z',
    occurredAt: '2026-08-19T10:00:00.123Z',
  };
  assert.deepEqual(Object.keys(payload).sort(), [
    'aggregateVersion',
    'eventId',
    'eventType',
    'occurredAt',
    'organizationId',
    'reportId',
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /photo|directive|prompt|content|email|url/i);
});
