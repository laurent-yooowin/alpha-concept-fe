import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { PreventionBulkAdmissionService } from './prevention-bulk-admission.service';
import {
  executionModeForVolume,
  isWithinPreventionBulkWindow,
  loadPreventionBulkConfiguration,
  nextPreventionBulkWindowStart,
  preventionBulkWindowKey,
} from './prevention-bulk.config';

const config = (values: Record<string, string> = {}) => new ConfigService({
  PREVENTION_REBUILD_IMMEDIATE_CEILING: '5000',
  PREVENTION_BULK_WINDOW_START_HOUR: '22',
  PREVENTION_BULK_WINDOW_END_HOUR: '6',
  PREVENTION_BULK_LEASE_SECONDS: '900',
  PREVENTION_BULK_RETRY_DELAY_SECONDS: '60',
  ...values,
});

test('reconstruction volume uses the measured reports plus findings, never the period label', () => {
  const settings = loadPreventionBulkConfiguration(config());
  assert.equal(executionModeForVolume(2000, 3000, settings), 'IMMEDIATE');
  assert.equal(executionModeForVolume(2001, 3000, settings), 'SCHEDULED');
});

test('the bulk window follows Europe/Paris across daylight-saving changes', () => {
  const settings = loadPreventionBulkConfiguration(config());
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-01-15T21:30:00.000Z'), settings), true);
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-01-15T07:30:00.000Z'), settings), false);
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-07-15T20:30:00.000Z'), settings), true);
  assert.equal(isWithinPreventionBulkWindow(new Date('2026-07-15T05:30:00.000Z'), settings), false);
});

test('a scheduled request receives the next local 22:00 opening', () => {
  const settings = loadPreventionBulkConfiguration(config());
  const next = nextPreventionBulkWindowStart(new Date('2026-01-15T10:00:00.000Z'), settings);
  assert.equal(next.toISOString(), '2026-01-15T21:00:00.000Z');
});

test('preview tokens use a stable local window key while the night is open', () => {
  const settings = loadPreventionBulkConfiguration(config());
  const beforeOpen = new Date('2026-01-15T20:59:00.000Z');
  const afterOpen = new Date('2026-01-15T21:01:00.000Z');
  const beforeClose = new Date('2026-01-16T04:59:00.000Z');
  assert.equal(preventionBulkWindowKey(beforeOpen, settings), preventionBulkWindowKey(afterOpen, settings));
  assert.equal(preventionBulkWindowKey(afterOpen, settings), preventionBulkWindowKey(beforeClose, settings));
});

test('bulk configuration rejects an empty window and unsafe ceilings', () => {
  assert.throws(() => loadPreventionBulkConfiguration(config({
    PREVENTION_BULK_WINDOW_START_HOUR: '6', PREVENTION_BULK_WINDOW_END_HOUR: '6',
  })), /window must not be empty/);
  assert.throws(() => loadPreventionBulkConfiguration(config({ PREVENTION_REBUILD_IMMEDIATE_CEILING: '0' })), /between 1 and/);
});

test('an inactive tenant checkpoint cannot hold up another tenant budget admission', async () => {
  const statements: string[] = [];
  const dataSource = {
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM prevention_scheduler_bulk_admission WHERE id=? FOR UPDATE')) return [{}];
        if (sql.includes('SELECT r.id FROM prevention_scheduler_runs')) return [];
        return { affectedRows: 1 };
      },
    }),
  };
  const service = new PreventionBulkAdmissionService(dataSource as any, config(),
    { isEnabled: async () => true } as any);
  const result = await service.admit({
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workKind: 'BUDGET', executionMode: 'IMMEDIATE', scheduledFor: new Date().toISOString(),
  });
  assert.equal(result.admitted, true);
  const dueQuery = statements.find((sql) => sql.includes('SELECT r.id FROM prevention_scheduler_runs')) ?? '';
  assert.match(dueQuery, /JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1/);
  assert.match(dueQuery, /r.dispatchComplete=0 AND EXISTS \(\s*SELECT 1 FROM organizations o WHERE o.isActive=1 AND o.preventionEnabled=1/);
});
