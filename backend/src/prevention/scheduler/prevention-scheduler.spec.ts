import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { loadPreventionSchedulerConfiguration } from './prevention-scheduler.config';
import { PREVENTION_AUDIT_REPORT_JOB, PREVENTION_MANUAL_REBUILD_JOB, PREVENTION_SCHEDULE_DEFINITIONS } from './prevention-scheduler.types';
import { isFirstSundayInParis } from './prevention-scheduler.service';
import { PreventionSchedulerService } from './prevention-scheduler.service';

const env = {
  PREVENTION_SCHEDULER_ENABLED: 'true', PREVENTION_SCHEDULER_TIMEZONE: 'Europe/Paris',
  PREVENTION_SCHEDULER_ORG_BATCH_SIZE: '25', PREVENTION_SCHEDULER_REPORT_BATCH_SIZE: '200',
  PREVENTION_SCHEDULER_COMPLETED_RETENTION_SECONDS: '604800',
  PREVENTION_SCHEDULER_FAILED_RETENTION_SECONDS: '2592000',
  PREVENTION_SCHEDULER_DIFFERENTIAL_CRON: '0 2 * * *',
  PREVENTION_SCHEDULER_CONSOLIDATION_CRON: '0 3 * * *',
  PREVENTION_SCHEDULER_WEEKLY_AUDIT_CRON: '0 4 * * 0',
  PREVENTION_SCHEDULER_MONTHLY_AUDIT_CRON: '0 5 * * 0',
  PREVENTION_SCHEDULER_CLEANUP_CRON: '0 6 * * *',
};

test('P6 schedules are deterministic and use the approved local times', () => {
  assert.deepEqual(PREVENTION_SCHEDULE_DEFINITIONS.map(({ id }) => id), [
    'prevention-differential-v1', 'prevention-consolidation-v1',
    'prevention-weekly-audit-v1', 'prevention-monthly-audit-v1',
    'prevention-cleanup-v1',
  ]);
  const configuration = loadPreventionSchedulerConfiguration(new ConfigService(env));
  assert.equal(configuration.timezone, 'Europe/Paris');
  assert.equal(configuration.monthlyAuditPattern, '0 5 * * 0');
});

test('cleanup removes expired scheduler history but preserves business jobs', async () => {
  const service = new PreventionSchedulerService({} as any, new ConfigService({
    ...env, PREVENTION_SCHEDULER_ENABLED: 'false',
  }));
  let schedulerRemoved = 0;
  let auditRemoved = 0;
  let businessRemoved = 0;
  (service as any).queue = {
    getJobs: async () => [
      { id: 'scheduler', name: 'prevention.scheduler.differential', finishedOn: 1,
        remove: async () => { schedulerRemoved += 1; } },
      { id: 'audit', name: PREVENTION_AUDIT_REPORT_JOB, finishedOn: 1,
        remove: async () => { auditRemoved += 1; } },
      { id: 'business', name: 'prevention.report.upsert', finishedOn: 1,
        remove: async () => { businessRemoved += 1; } },
      { id: 'statistics', name: 'prevention.statistics.refresh', finishedOn: 1,
        remove: async () => { businessRemoved += 1; } },
    ],
  };
  const removed = await (service as any).removeExpiredSchedulerJobs('failed', 86_400);
  assert.deepEqual(removed, ['scheduler', 'audit']);
  assert.equal(schedulerRemoved, 1);
  assert.equal(auditRemoved, 1);
  assert.equal(businessRemoved, 0);
});

test('monthly audit accepts only the first Sunday in Europe/Paris', () => {
  assert.equal(isFirstSundayInParis('2026-09-06T03:00:00.000Z'), true);
  assert.equal(isFirstSundayInParis('2026-09-13T03:00:00.000Z'), false);
  assert.equal(isFirstSundayInParis('2026-09-05T03:00:00.000Z'), false);
  assert.equal(isFirstSundayInParis('2026-03-01T04:00:00.000Z'), true);
  assert.equal(isFirstSundayInParis('2026-10-04T04:00:00.000Z'), true);
});

test('recovery creates a bounded deterministic continuation after a full page', async () => {
  const service = new PreventionSchedulerService({} as any, new ConfigService({
    ...env, PREVENTION_SCHEDULER_ENABLED: 'false',
  }));
  const added: any[] = [];
  (service as any).queue = { add: async (...args: any[]) => { added.push(args); } };
  (service as any).recoverIncompleteTasks = async () =>
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await (service as any).recoverAndContinue(
    'TASK', null, '2026-09-15T10:00:00.000Z',
  );
  assert.equal(added.length, 1);
  assert.equal(added[0][0], 'prevention.scheduler.recovery');
  assert.deepEqual(added[0][1], {
    recoveryType: 'TASK', cursor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scheduledFor: '2026-09-15T10:00:00.000Z',
  });
  assert.match(added[0][2].jobId, /^prevention-scheduler-recovery-[0-9a-f]{64}$/);
});

test('terminal audit failure is idempotent and quarantines its run', async () => {
  let first = true;
  const statements: string[] = [];
  const dataSource = {
    transaction: async (callback: (manager: any) => Promise<void>) => callback({
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('UPDATE prevention_scheduler_tasks')) {
          const affectedRows = first ? 1 : 0;
          first = false;
          return { affectedRows };
        }
        return { affectedRows: 1 };
      },
    }),
  };
  const service = new PreventionSchedulerService(dataSource as any, new ConfigService({
    ...env, PREVENTION_SCHEDULER_ENABLED: 'false',
  }));
  const args = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'] as const;
  await service.recordAuditTerminalFailure(...args);
  await service.recordAuditTerminalFailure(...args);
  assert.equal(statements.filter((sql) => sql.includes('SET status=\'FAILED\'')).length, 3);
  assert.ok(statements.some((sql) => sql.includes('prevention_scheduler_runs')));
});

test('P6 scheduler configuration is strictly bounded', () => {
  assert.throws(() => loadPreventionSchedulerConfiguration(new ConfigService({
    ...env, PREVENTION_SCHEDULER_TIMEZONE: 'UTC',
  })), /Europe\/Paris/);
  assert.throws(() => loadPreventionSchedulerConfiguration(new ConfigService({
    ...env, PREVENTION_SCHEDULER_ORG_BATCH_SIZE: '0',
  })), /between 1 and 100/);
  assert.throws(() => loadPreventionSchedulerConfiguration(new ConfigService({
    ...env, PREVENTION_SCHEDULER_REPORT_BATCH_SIZE: '501',
  })), /between 1 and 500/);
  assert.throws(() => loadPreventionSchedulerConfiguration(new ConfigService({
    ...env, PREVENTION_SCHEDULER_ENABLED: 'yes',
  })), /true or false/);
  assert.throws(() => loadPreventionSchedulerConfiguration(new ConfigService({
    ...env, PREVENTION_SCHEDULER_CLEANUP_CRON: 'tomorrow',
  })), /valid cron/);
  for (const invalid of ['99 2 * * *', '0 25 * * *', '0 5 9-2 * *', '*/0 5 * * *']) {
    assert.throws(() => loadPreventionSchedulerConfiguration(new ConfigService({
      ...env, PREVENTION_SCHEDULER_CLEANUP_CRON: invalid,
    })), /valid cron/);
  }
});


test("manual rebuild validates ownership and propagates its durable run id", async () => {
  const calls: any[] = [];
  const dataSource = {
    query: async (sql: string, args: unknown[]) => { calls.push({ sql, args }); return sql.includes("SELECT r.id") ? [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] : { affectedRows: 1 }; },
  };
  const service = new PreventionSchedulerService(dataSource as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: "false" }));
  const queued: any[] = [];
  (service as any).queue = { getJob: async () => null, add: async (...args: any[]) => { queued.push(args); } };
  const scheduledFor = new Date().toISOString();
  const result = await service.process({
    name: PREVENTION_MANUAL_REBUILD_JOB, timestamp: Date.now(), opts: { attempts: 4 },
    data: { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", scheduledFor },
  } as any);
  assert.equal(result, "ENQUEUED");
  assert.equal(queued[0][0], "prevention.scheduler.organization-scan");
  assert.equal(queued[0][1].runId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.ok(calls[0].sql.includes("c.organizationId=?"));
});
