import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { loadPreventionSchedulerConfiguration } from './prevention-scheduler.config';
import { PREVENTION_AUDIT_REPORT_JOB, PREVENTION_CONSOLIDATION_JOB, PREVENTION_MANUAL_REBUILD_JOB, PREVENTION_SCHEDULE_DEFINITIONS } from './prevention-scheduler.types';
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
  })), /between 100 and 500/);
  assert.throws(() => loadPreventionSchedulerConfiguration(new ConfigService({
    ...env, PREVENTION_SCHEDULER_REPORT_BATCH_SIZE: '99',
  })), /between 100 and 500/);
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

test('only an explicit manual rebuild forces report reconstruction', async () => {
  let jobType = 'prevention.scheduler.consolidation';
  const service = new PreventionSchedulerService({
    query: async (_sql: string, args: unknown[]) => {
      assert.deepEqual(args, [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ]);
      return [{ jobType }];
    },
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  assert.equal(await service.isManualRebuildTask(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ), false);
  jobType = 'MANUAL_REBUILD';
  assert.equal(await service.isManualRebuildTask(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ), true);
});

test('organization scan advances its cursor atomically with durable tasks', async () => {
  const envWithSmallPages = { ...env, PREVENTION_SCHEDULER_ENABLED: 'false', PREVENTION_SCHEDULER_REPORT_BATCH_SIZE: '100' };
  const managerCalls: string[] = [];
  const queued: any[] = [];
  const reports = Array.from({ length: 101 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    updatedAt: '2026-09-01T10:00:00.000Z',
  }));
  const dataSource = {
    query: async (sql: string) => {
      if (sql.includes('LEFT JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?')) return [];
      if (sql.includes('JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?')) {
        return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }];
      }
      if (sql.includes('SELECT r.id,r.updatedAt')) return reports;
      return { affectedRows: 1 };
    },
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => {
        managerCalls.push(sql);
        if (sql.includes('SELECT reportCursor,status,scanComplete,lockedBy')) {
          return [{ reportCursor: null, status: 'PROCESSING', scanComplete: 0, lockedBy: (service as any).instanceId }];
        }
        if (sql.includes('SELECT reportCursor,status,scanComplete')) {
          return [{ reportCursor: null, status: 'PENDING', scanComplete: 0 }];
        }
        if (sql.includes('INSERT IGNORE INTO prevention_scheduler_tasks')) return { affectedRows: 1 };
        if (sql.includes('UPDATE prevention_scheduler_checkpoints SET status=?')) return { affectedRows: 1 };
        return { affectedRows: 1 };
      },
    }),
  };
  const service = new PreventionSchedulerService(dataSource as any, new ConfigService(envWithSmallPages));
  (service as any).queue = {
    getJob: async () => null,
    add: async (...args: any[]) => { queued.push(args); },
  };
  const result = await (service as any).processOrganizationScan({
    parentJobType: 'prevention.scheduler.consolidation',
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    reportCursor: null,
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scheduledFor: '2026-09-15T10:00:00.000Z',
  });
  assert.equal(result, 'CONTINUED');
  assert.equal(managerCalls.filter((sql) => sql.includes('INSERT IGNORE INTO prevention_scheduler_tasks')).length, 100);
  assert.ok(managerCalls.some((sql) => sql.includes('pendingJobs=pendingJobs+?')));
  assert.equal(queued.filter(([name]) => name === PREVENTION_AUDIT_REPORT_JOB).length, 100);
  assert.equal(queued.filter(([name]) => name === 'prevention.scheduler.organization-scan').length, 1);
});

test('manual reconstruction resumes with only the checkpoint chantier snapshot', async () => {
  const organizationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const missionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const reportQueries: Array<{ sql: string; args: unknown[] }> = [];
  const reports = Array.from({ length: 101 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    updatedAt: '2026-09-01T10:00:00.000Z',
  }));
  const dataSource = {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?')) return [{ id: runId }];
      if (sql.includes('SELECT r.id,r.updatedAt')) { reportQueries.push({ sql, args }); return reports; }
      return { affectedRows: 1 };
    },
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => {
        if (sql.includes('SELECT reportCursor,status,scanComplete,lockedBy')) return [
          { reportCursor: null, status: 'PROCESSING', scanComplete: 0, lockedBy: (service as any).instanceId },
        ];
        if (sql.includes('SELECT reportCursor,status,scanComplete')) return [
          { reportCursor: null, status: 'PENDING', scanComplete: 0, scopeMissionIds: JSON.stringify([missionId]) },
        ];
        return { affectedRows: 1 };
      },
    }),
  };
  const service = new PreventionSchedulerService(dataSource as any,
    new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false', PREVENTION_SCHEDULER_REPORT_BATCH_SIZE: '100' }));
  (service as any).queue = { getJob: async () => null, add: async () => undefined };
  const result = await (service as any).processOrganizationScan({
    parentJobType: 'prevention.scheduler.consolidation', organizationId, reportCursor: null, runId,
    scheduledFor: '2026-09-15T10:00:00.000Z',
  });
  assert.equal(result, 'CONTINUED');
  assert.equal(reportQueries.length, 1);
  assert.match(reportQueries[0].sql, /v\.missionId IN \(\?\)/);
  assert.deepEqual(reportQueries[0].args, [organizationId, '', [missionId], 101]);
});

test('organization scan skips a stale continuation after the scan is complete', async () => {
  let queueAdds = 0;
  const service = new PreventionSchedulerService({
    query: async (sql: string) => sql.includes('JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?')
      ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] : { affectedRows: 1 },
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => sql.includes('SELECT reportCursor,status,scanComplete')
        ? [{ reportCursor: '10000000-0000-4000-8000-000000000001', status: 'PROCESSING', scanComplete: 1 }]
        : { affectedRows: 0 },
    }),
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  (service as any).queue = { add: async () => { queueAdds += 1; }, getJob: async () => null };
  const result = await (service as any).processOrganizationScan({
    parentJobType: 'prevention.scheduler.consolidation',
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reportCursor: null,
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduledFor: '2026-09-15T10:00:00.000Z',
  });
  assert.equal(result, 'SKIPPED');
  assert.equal(queueAdds, 0);
});

test('activation stages historical groups in tenant-scoped pages before scan completion', async () => {
  const org = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const run = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const calls: Array<{ organizationId: string; cursor?: string }> = [];
  const groupProcessing = {
    backfillOrganization: async (organizationId: string, _limit: number, cursor?: string) => {
      calls.push({ organizationId, cursor });
      return cursor ? { visits: 1, queued: 1, nextCursor: 'next' } :
        { visits: 100, queued: 0, nextCursor: 'first' };
    },
  };
  const service = new PreventionSchedulerService({
    query: async () => [{ workKind: 'ACTIVATION' }],
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }),
  undefined, undefined, undefined, undefined, groupProcessing as any);
  await (service as any).backfillActivationGroups(run, org);
  assert.deepEqual(calls, [{ organizationId: org, cursor: undefined }, { organizationId: org, cursor: 'first' }]);
});

test('ordinary differential scans never backfill historical groups', async () => {
  const service = new PreventionSchedulerService({
    query: async () => [{ workKind: 'AUTOMATIC' }],
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }),
  undefined, undefined, undefined, undefined, { backfillOrganization: async () => assert.fail('unexpected backfill') } as any);
  await (service as any).backfillActivationGroups(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
});

test('manual continuation rejects a run owned by a different organization', async () => {
  const queries: string[] = [];
  const service = new PreventionSchedulerService({
    query: async (sql: string) => { queries.push(sql); return []; },
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  await assert.rejects(() => (service as any).processOrganizationScan({
    parentJobType: PREVENTION_CONSOLIDATION_JOB,
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    reportCursor: null,
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scheduledFor: '2026-10-07T12:00:00.000Z',
  }), /ownership/);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /c.organizationId=\?/);
});

test('activation scan rejects a derived run without this tenant checkpoint', async () => {
  const service = new PreventionSchedulerService({
    query: async (sql: string) => sql.includes('LEFT JOIN prevention_scheduler_checkpoints')
      ? [{ workKind: 'ACTIVATION', checkpointId: null }] : assert.fail('unexpected database write'),
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  await assert.rejects(() => (service as any).processOrganizationScan({
    parentJobType: 'prevention.scheduler.differential',
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    reportCursor: null,
    scheduledFor: '2026-10-07T12:00:00.000Z',
  }), /activation scan ownership/);
});

test('audit completion decrements pending jobs only once', async () => {
  let taskUpdate = 0;
  let pendingUpdate = 0;
  const service = new PreventionSchedulerService({
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => {
        if (sql.includes('UPDATE prevention_scheduler_tasks')) {
          taskUpdate += 1;
          return { affectedRows: taskUpdate === 1 ? 1 : 0 };
        }
        if (sql.includes('pendingJobs=GREATEST')) {
          pendingUpdate += 1;
          return { affectedRows: 1 };
        }
        return { affectedRows: 1 };
      },
    }),
    query: async () => [],
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  await service.recordAuditSuccess(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  );
  await service.recordAuditSuccess(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  );
  assert.equal(pendingUpdate, 1);
});

test('recovery respects durable availability for checkpoints and tasks', async () => {
  const queries: string[] = [];
  const service = new PreventionSchedulerService({
    query: async (sql: string) => { queries.push(sql); return []; },
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => { queries.push(sql); return { affectedRows: 0 }; },
    }),
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  (service as any).queue = { add: async () => undefined, getJob: async () => null };
  await (service as any).recoverIncompleteCheckpoints(null);
  await (service as any).recoverIncompleteTasks(null);
  assert.ok(queries.some((sql) => /c\.availableAt<=UTC_TIMESTAMP\(6\)/.test(sql)));
  assert.ok(queries.some((sql) => /c\.availableAt<=UTC_TIMESTAMP\(6\)/.test(sql) && sql.includes('prevention_scheduler_tasks')));
  assert.ok(queries.filter((sql) => sql.startsWith('SELECT') && sql.includes('JOIN prevention_scheduler_runs')).every((sql) =>
    sql.includes("r.status IN ('PENDING','PROCESSING','SCHEDULED')")));
  assert.ok(queries.filter((sql) => sql.startsWith('SELECT') && sql.includes('JOIN prevention_scheduler_runs')).every((sql) =>
    sql.includes("r.status='COMPLETED' AND r.jobType IN (?,?,?,?)")));
  assert.ok(queries.filter((sql) => sql.startsWith('SELECT') && sql.includes('JOIN organizations o')).every((sql) =>
    sql.includes('o.isActive=1 AND o.preventionEnabled=1')));
});

test('recovery requeues an incomplete automatic checkpoint even if its parent run was prematurely completed', async () => {
  const added: any[] = [];
  const queries: Array<{ sql: string; args: unknown[] | undefined }> = [];
  const service = new PreventionSchedulerService({
    query: async (sql: string, args?: unknown[]) => {
      queries.push({ sql, args });
      if (sql.includes('SELECT c.id,c.runId,c.organizationId,c.reportCursor')) return [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reportCursor: null, jobType: PREVENTION_CONSOLIDATION_JOB,
        scheduledForUtc: '2026-09-15 10:00:00.000000',
      }];
      return [];
    },
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  (service as any).retireDisabledAutomaticCheckpoints = async () => undefined;
  (service as any).queue = {
    getJob: async () => null,
    add: async (...args: any[]) => { added.push(args); },
  };
  await (service as any).recoverIncompleteCheckpoints(null);
  assert.equal(added.length, 1);
  assert.equal(added[0][0], 'prevention.scheduler.organization-scan');
  assert.deepEqual(added[0][1], {
    parentJobType: PREVENTION_CONSOLIDATION_JOB,
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    scheduledFor: '2026-09-15T10:00:00.000Z', reportCursor: null,
  });
  const recoveryQuery = queries.find(({ sql }) => sql.includes('SELECT c.id,c.runId,c.organizationId,c.reportCursor'));
  assert.ok(recoveryQuery?.sql.includes("r.status='COMPLETED' AND r.jobType IN (?,?,?,?)"));
  assert.ok(recoveryQuery?.sql.includes('o.isActive=1 AND o.preventionEnabled=1'));
  assert.equal(recoveryQuery?.args?.length, 5);
});

test('recovery retires inactive automatic checkpoints and tasks without blocking another tenant', async () => {
  const statements: string[] = [];
  const service = new PreventionSchedulerService({
    query: async (sql: string) => { statements.push(sql); return []; },
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => { statements.push(sql); return { affectedRows: 1 }; },
    }),
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  (service as any).queue = { add: async () => undefined, getJob: async () => null };
  await (service as any).recoverIncompleteCheckpoints(null);
  assert.ok(statements.some((sql) => sql.includes("SET t.status='COMPLETED',t.lastError='ORGANIZATION_DISABLED'")));
  assert.ok(statements.some((sql) => sql.includes("c.lastError='ORGANIZATION_DISABLED'") &&
    sql.includes('o.isActive=0 OR o.preventionEnabled=0')));
  assert.ok(statements.some((sql) => sql.includes("SET r.status='COMPLETED'") && sql.includes('r.dispatchComplete=1')));
});

test('recovery recreates a missing organization continuation from its durable cursor', async () => {
  const added: any[] = [];
  const calls: string[] = [];
  const service = new PreventionSchedulerService({
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM prevention_scheduler_runs') && sql.includes('dispatchComplete=0')) {
        return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jobType: PREVENTION_CONSOLIDATION_JOB,
          scheduledFor: '2026-09-15T10:00:00.000Z', organizationCursor: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }];
      }
      return [];
    },
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => {
        if (sql.includes('SELECT id,jobType,organizationCursor,status')) {
          return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jobType: PREVENTION_CONSOLIDATION_JOB,
            scheduledForUtc: '2026-09-15 10:00:00.000000', organizationCursor: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            status: 'PENDING', dispatchComplete: 0, lockedAt: null, availableAt: '2026-09-15T09:00:00.000Z' }];
        }
        return { affectedRows: 1 };
      },
    }),
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  (service as any).queue = {
    getJob: async () => null,
    add: async (...args: any[]) => { added.push(args); },
  };
  const next = await (service as any).recoverIncompleteRuns(null);
  assert.equal(next, null);
  assert.equal(added.length, 1);
  assert.equal(added[0][0], PREVENTION_CONSOLIDATION_JOB);
  assert.deepEqual(added[0][1], {
    scheduledFor: '2026-09-15T10:00:00.000Z',
    cursor: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  assert.ok(calls.some((sql) => sql.includes('availableAt<=UTC_TIMESTAMP(6)')));
});

test('recovery does not enqueue a run whose durable backoff is still active', async () => {
  let enqueued = false;
  const service = new PreventionSchedulerService({
    query: async (sql: string) => sql.includes('FROM prevention_scheduler_runs') && sql.includes('dispatchComplete=0')
      ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jobType: PREVENTION_CONSOLIDATION_JOB,
          scheduledFor: '2026-09-15T10:00:00.000Z', organizationCursor: null }] : [],
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => sql.includes('SELECT id,jobType,organizationCursor,status')
        ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jobType: PREVENTION_CONSOLIDATION_JOB,
            scheduledForUtc: '2026-09-15 10:00:00.000000', organizationCursor: null,
            status: 'PENDING', dispatchComplete: 0, lockedAt: null,
            availableAt: new Date(Date.now() + 60_000) }]
        : { affectedRows: 1 },
    }),
  } as any, new ConfigService({ ...env, PREVENTION_SCHEDULER_ENABLED: 'false' }));
  (service as any).queue = { getJob: async () => null, add: async () => { enqueued = true; } };
  await (service as any).recoverIncompleteRuns(null);
  assert.equal(enqueued, false);
});

test('checkpoint recovery resumes after a committed page whose continuation enqueue crashed', async () => {
  const reports = Array.from({ length: 101 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    updatedAt: '2026-09-01T10:00:00.000Z',
  }));
  const managerCalls: string[] = [];
  const directCalls: string[] = [];
  const added: any[] = [];
  let failContinuation = true;
  let service: PreventionSchedulerService;
  const dataSource = {
    query: async (sql: string) => {
      directCalls.push(sql);
      if (sql.includes('LEFT JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?')) return [];
      if (sql.includes('JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?')) {
        return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }];
      }
      if (sql.includes('SELECT r.id,r.updatedAt')) return reports;
      if (sql.includes('SELECT c.id,c.runId,c.organizationId,c.reportCursor')) {
        return [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reportCursor: reports[99].id,
          jobType: PREVENTION_CONSOLIDATION_JOB, scheduledForUtc: '2026-09-15 10:00:00.000000' }];
      }
      return { affectedRows: 1 };
    },
    transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string) => {
        managerCalls.push(sql);
        if (sql.includes('SELECT reportCursor,status,scanComplete,lockedBy')) {
          return [{ reportCursor: null, status: 'PROCESSING', scanComplete: 0, lockedBy: (service as any).instanceId }];
        }
        if (sql.includes('SELECT reportCursor,status,scanComplete')) {
          return [{ reportCursor: null, status: 'PENDING', scanComplete: 0 }];
        }
        if (sql.includes('INSERT IGNORE INTO prevention_scheduler_tasks')) return { affectedRows: 1 };
        if (sql.includes('UPDATE prevention_scheduler_checkpoints SET status=?')) return { affectedRows: 1 };
        return { affectedRows: 1 };
      },
    }),
  };
  service = new PreventionSchedulerService(dataSource as any, new ConfigService({
    ...env, PREVENTION_SCHEDULER_ENABLED: 'false', PREVENTION_SCHEDULER_REPORT_BATCH_SIZE: '100',
  }));
  (service as any).queue = {
    getJob: async () => null,
    add: async (...args: any[]) => {
      if (args[0] === 'prevention.scheduler.organization-scan' && failContinuation) {
        failContinuation = false;
        throw new Error('simulated continuation enqueue crash');
      }
      added.push(args);
    },
  };
  await assert.rejects(() => (service as any).processOrganizationScan({
    parentJobType: PREVENTION_CONSOLIDATION_JOB,
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reportCursor: null,
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduledFor: '2026-09-15T10:00:00.000Z',
  }), /simulated continuation enqueue crash/);
  assert.ok(managerCalls.some((sql) => sql.includes('pendingJobs=pendingJobs+?')));
  assert.ok(!directCalls.some((sql) => sql.includes("SET status='PENDING',availableAt=DATE_ADD")));
  await (service as any).recoverIncompleteCheckpoints(null);
  assert.equal(added.filter(([name]) => name === 'prevention.scheduler.organization-scan').length, 1);
});
