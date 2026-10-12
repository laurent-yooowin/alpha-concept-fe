import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { PreventionHyperAdminRecoveryService } from './prevention-hyper-admin-recovery.service';

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';

function service(overrides: Record<string, unknown> = {}): any {
  const instance: any = Object.create(PreventionHyperAdminRecoveryService.prototype);
  instance.signingKey = Buffer.from('test-hyper-admin-recovery-secret-32-chars');
  instance.bulkConfiguration = { immediateRebuildCeiling: 100 };
  instance.config = { get: (_key: string, fallback: unknown) => fallback };
  instance.queue = { add: async () => undefined, getJob: async () => null };
  instance.logger = { log: () => undefined, error: () => undefined };
  instance.workerHealth = async () => ({ status: 'healthy', heartbeatAgeSeconds: 1 });
  Object.assign(instance, overrides);
  return instance;
}

function preview(overrides: Record<string, unknown> = {}): any {
  return {
    organizationId: org,
    reportCount: 2,
    findingCount: 3,
    estimationWorkloadCount: 2,
    groupCount: 2,
    pendingGroupCount: 0,
    immediateAllowed: true,
    immediateReason: 'WITHIN_IMMEDIATE_CEILING',
    hardRejected: false,
    scheduledFor: null,
    sourceVersion: 'source-v1',
    activationRunId: '33333333-3333-4333-8333-333333333333',
    confirmationToken: 'token',
    activationScan: null,
    worker: { status: 'healthy', heartbeatAgeSeconds: 1 },
    ...overrides,
  };
}

test('terminal recovery failure logs a bounded technical cause and stage', async () => {
  let event: Record<string, unknown> | undefined;
  const recovery = service({
    db: { query: async () => ({ affectedRows: 1 }) },
    logger: { log: () => undefined, error: (value: Record<string, unknown>) => { event = value; } },
  });
  await recovery.fail('99999999-9999-4999-8999-999999999999', org,
    'PREVENTION_GROUP_PROCESSING_FAILED', 'GROUPS');
  assert.equal(event?.event, 'PREVENTION_RECOVERY_FAILED');
  assert.equal(event?.failedStage, 'GROUPS');
  assert.equal(event?.organizationId, org);
  assert.equal(event?.errorCode, 'PREVENTION_GROUP_PROCESSING_FAILED');
});

test('recovery confirmation tokens reject tampering, tenant mismatch and stale previews', () => {
  const recovery = service();
  const data = preview();
  const token = recovery.sign(data);

  assert.equal(recovery.verify(token, data).length, 64);
  const [body, signature] = token.split('.');
  const alteredSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  assert.throws(() => recovery.verify(`${body}.${alteredSignature}`, data), ConflictException);
  assert.throws(() => recovery.verify(token, { ...data, organizationId: otherOrg }), ConflictException);
  const stale = recovery.sign(data, Date.now() - 16 * 60 * 1000);
  assert.throws(() => recovery.verify(stale, data), ConflictException);
});

test('preview only reads tenant-scoped work and never enqueues work', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const recovery = service({
    groups: { countEligibleGroups: async () => 2 },
    db: { query: async (sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      if (sql.startsWith('SELECT id,isActive')) return [{ id: org, isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('pendingGroupCount')) return [{ reportCount: 2, findingCount: 3, estimationWorkloadCount: 2, pendingGroupCount: 0 }];
      if (sql.includes("r.workKind='ACTIVATION'")) return [];
      if (sql.includes('reportUpdatedAt')) return [{ reportCount: 2, reportUpdatedAt: '', findingCount: 3, findingCreatedAt: '', catalogVersion: 0 }];
      if (sql.startsWith('SELECT id,snapshotId')) return [];
      if (sql.startsWith('SELECT id,version,matchingKey')) return [];
      throw new Error(`unexpected query: ${sql}`);
    } },
  });
  recovery.queue.add = async () => { throw new Error('preview must not enqueue'); };

  const result = await recovery.preview(org);
  assert.equal(result.reportCount, 2);
  assert.equal(result.immediateAllowed, true);
  assert.equal(calls.every((call) => call.args.every((arg) => arg === org)), true);
});

test('confirmation enforces immediate and hard volume ceilings before scheduling', async () => {
  const immediate = service({ preview: async () => preview({ immediateAllowed: false, immediateReason: 'BUDGET_VOLUME_REQUIRES_BULK_WINDOW' }), verify: () => 'digest' });
  await assert.rejects(() => immediate.confirm(org, 'token', true), ConflictException);

  const hard = service({ preview: async () => preview({ hardRejected: true, immediateAllowed: false }), verify: () => 'digest' });
  await assert.rejects(() => hard.confirm(org, 'token', false), ConflictException);
});

test('adopted activation retains the manual rebuild database job type', async () => {
  const updates: Array<unknown[]> = [];
  const queued: Array<{ name: string; data: any }> = [];
  const recovery = service({
    db: { transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
      query: async (sql: string, args: unknown[]) => {
        if (sql.includes('FROM prevention_scheduler_runs')) return [{
          id: '33333333-3333-4333-8333-333333333333', scheduledFor: new Date().toISOString(),
          checkpointStatus: 'PENDING', reportCursor: null, processedReports: 0, scanComplete: 0,
          pendingJobs: 0, lockedBy: null,
        }];
        if (sql.startsWith('UPDATE prevention_scheduler_runs')) { updates.push(args); return { affectedRows: 1 }; }
        throw new Error(`unexpected query: ${sql}`);
      },
    }) },
    queue: { getJob: async () => null, add: async (name: string, data: any) => { queued.push({ name, data }); } },
  });

  const result = await recovery.enqueueExtraction(org, 'IMMEDIATE', 2, 3);
  assert.equal(result.id, '33333333-3333-4333-8333-333333333333');
  assert.equal(updates[0][0], 'MANUAL_REBUILD');
  assert.equal(queued[0].name, 'prevention.scheduler.manual-rebuild');
  assert.equal(queued[0].data.runId, result.id);
});

test('concurrent confirmations deduplicate under the tenant row lock', async () => {
  let transactionCount = 0;
  let extractionCount = 0;
  const recovery = service({
    preview: async () => preview(),
    verify: () => 'digest',
    db: {
      transaction: async (callback: (manager: any) => Promise<unknown>) => {
        const ordinal = ++transactionCount;
        const manager = { query: async (sql: string) => sql.includes('FROM organizations') ? [{}] : ordinal === 1 ? [] : [{ id: '44444444-4444-4444-8444-444444444444', status: 'PROCESSING' }] };
        return callback(manager);
      },
      query: async () => [],
    },
    rebuild: {},
    status: async (_organizationId: string, runId: string) => ({ latestRun: { id: runId } }),
    enqueueExtraction: async () => { extractionCount += 1; return { id: '55555555-5555-4555-8555-555555555555', status: 'PROCESSING' }; },
    enqueueRecovery: async () => undefined,
  });

  const results = await Promise.all([
    recovery.confirm(org, 'token', true),
    recovery.confirm(org, 'token', true),
  ]);
  assert.equal(transactionCount, 2);
  assert.equal(extractionCount, 1);
  assert.equal(results[1].latestRun.id, '44444444-4444-4444-8444-444444444444');
});

test('a terminal recovery rejects replay of the same confirmation token but fresh previews differ', async () => {
  const recovery = service();
  const data = preview();
  const first = recovery.sign(data, Date.now());
  const second = recovery.sign(data, Date.now());
  assert.notEqual(recovery.verify(first, data), recovery.verify(second, data));
  const replay = service({
    preview: async () => ({ ...data, confirmationToken: first }),
    db: {
      transaction: async (callback: (manager: any) => Promise<unknown>) => callback({
        query: async (sql: string) => sql.includes('FROM organizations') ? [{}] : [{ id: '45454545-4545-4454-8454-454545454545', status: 'COMPLETED' }],
      }),
    },
  });
  await assert.rejects(() => replay.confirm(org, first, true), ConflictException);
});

test('duplicate recovery jobs are serialized by the durable lease', async () => {
  let claims = 0;
  let releases = 0;
  let leaseDuration: unknown;
  const recoveryId = 'abababab-abab-4aba-8aba-abababababab';
  const recovery = service({
    db: { query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{ id: recoveryId, organizationId: org, stage: 'EXTRACTION', status: 'PROCESSING' }];
      if (sql.includes('SET leaseOwner=?,leaseUntil=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND)')) {
        leaseDuration = args[1]; claims += 1; return { affectedRows: claims === 1 ? 1 : 0 };
      }
      if (sql.includes('SET leaseOwner=NULL')) { releases += 1; return []; }
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 0, preventionEnabled: 0 }];
      if (sql.startsWith("UPDATE prevention_hyper_admin_recovery_runs SET status='SCHEDULED'")) return [];
      throw new Error(`unexpected query: ${sql}`);
    } },
  });

  const jobs = [1, 2].map(() => recovery.process({ data: { organizationId: org, recoveryId }, opts: { attempts: 1 }, attemptsMade: 0 } as any));
  const results = await Promise.all(jobs);
  assert.deepEqual(results.sort(), ['LEASED', 'PAUSED_DISABLED'].sort());
  assert.equal(claims, 2);
  assert.equal(releases, 1);
  assert.equal(leaseDuration, 120_000_000);
});

test('lease renewal uses database UTC time rather than the application time zone', async () => {
  let statement = '';
  let duration: unknown;
  const recovery = service({ db: { query: async (sql: string, args: unknown[]) => {
    statement = sql;
    duration = args[0];
    return { affectedRows: 1 };
  } } });
  await recovery.renewLease(org, 'abababab-abab-4aba-8aba-abababababab', 'worker');
  assert.match(statement, /leaseUntil=DATE_ADD\(UTC_TIMESTAMP\(6\), INTERVAL \? MICROSECOND\)/);
  assert.equal(duration, 120_000_000);
});

test('a stale lease cannot fence a stage update', async () => {
  const recovery = service({ db: { query: async () => ({ affectedRows: 0 }) } });
  await assert.rejects(
    () => recovery.fencedUpdate('abababab-abab-4aba-8aba-abababababab', org, 'stale-owner', "stage='COMPLETED',status='COMPLETED'", [], 'BUDGET'),
    /PREVENTION_RECOVERY_LEASE_LOST/,
  );
});

test('recovery does not enter budget before extraction and groups are ready', async () => {
  let budgetCalls = 0;
  let enqueueCalls = 0;
  const recovery = service({
    db: { query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{ id: '66666666-6666-4666-8666-666666666666', organizationId: org, stage: 'EXTRACTION', status: 'PROCESSING', extractionRunId: '77777777-7777-4777-8777-777777777777', reportCount: 2, findingCount: 3 }];
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('runStatus')) return [{ runStatus: 'PROCESSING', checkpointStatus: 'PENDING', pendingJobs: 1, failedJobs: 0 }];
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return [];
      throw new Error(`unexpected query: ${sql}`);
    } },
    budget: { ensureGlobalYearlyRun: async () => { budgetCalls += 1; return { runId: '88888888-8888-4888-8888-888888888888', status: 'PENDING' }; } },
    enqueueRecovery: async () => { enqueueCalls += 1; },
  });

  const result = await recovery.process({ data: { organizationId: org, recoveryId: '66666666-6666-4666-8666-666666666666' }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'WAITING_EXTRACTION');
  assert.equal(budgetCalls, 0);
  assert.equal(enqueueCalls, 1);
});

test('failed prevention groups fail recovery and cannot publish a budget', async () => {
  let budgetCalls = 0;
  let failureArgs: unknown[] | undefined;
  const recovery = service({
    db: { query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{ id: '99999999-9999-4999-8999-999999999999', organizationId: org, stage: 'GROUPS', status: 'PROCESSING', extractionRunId: '77777777-7777-4777-8777-777777777777', sourceVersion: null, reportCount: 1, findingCount: 1, expectedGroupCount: 1 }];
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('processingStatus IN')) return [{ pending: 0, failed: 1 }];
      if (sql.includes("SET stage='FAILED'")) { failureArgs = args; return []; }
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return [];
      throw new Error(`unexpected query: ${sql}`);
    } },
    groups: { backfillOrganization: async () => ({ visits: 0, nextCursor: null }) },
    budget: { ensureGlobalYearlyRun: async () => { budgetCalls += 1; return { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'PENDING' }; } },
  });

  const result = await recovery.process({ data: { organizationId: org, recoveryId: '99999999-9999-4999-8999-999999999999' }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'FAILED');
  assert.equal(budgetCalls, 0);
  assert.equal(failureArgs?.[0], 'GROUPS');
});

test('full recovery refuses to publish a budget when a group was not reconstructed for this run', async () => {
  let budgetCalls = 0;
  const recoveryId = '41414141-4141-4141-8141-414141414141';
  const recovery = service({
    db: { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{
        id: recoveryId, organizationId: org, stage: 'GROUPS', status: 'PROCESSING', expectedGroupCount: 2,
        extractionRunId: '77777777-7777-4777-8777-777777777777', reportCount: 1, findingCount: 1,
      }];
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('processingStatus IN')) return [{ total: 1, ready: 1, pending: 0, failed: 0 }];
      if (sql.includes('recoveryRunId IS NULL')) return [{ total: 0 }];
      if (sql.includes('AS lagging')) return [{ lagging: 0 }];
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return [];
      throw new Error(`unexpected query: ${sql}`);
    } },
    groups: { backfillOrganization: async () => ({ visits: 0, nextCursor: null }) },
    budget: { ensureGlobalYearlyRun: async () => { budgetCalls += 1; return { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'PENDING' }; } },
  });
  const result = await recovery.process({ data: { organizationId: org, recoveryId }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'FAILED');
  assert.equal(budgetCalls, 0);
});

test('full recovery reports obsolete group sources instead of publishing old analyses', async () => {
  let failureCode: unknown;
  let budgetCalls = 0;
  const recoveryId = '41414141-4141-4141-8141-414141414141';
  const recovery = service({
    db: { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{
        id: recoveryId, organizationId: org, stage: 'GROUPS', status: 'PROCESSING', expectedGroupCount: 1,
        extractionRunId: '77777777-7777-4777-8777-777777777777', reportCount: 1, findingCount: 1,
      }];
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('processingStatus IN')) return [{ total: 1, ready: 1, pending: 0, failed: 0 }];
      if (sql.includes('recoveryRunId IS NULL')) {
        assert.match(sql, /JOIN visits v ON v\.organizationId=g\.organizationId AND v\.id=g\.visitId/);
        assert.match(sql, /JSON_TABLE\(v\.photos, '\$\[\*\]'/);
        assert.match(sql, /JSON_TYPE\(entry\.analysis\)='OBJECT'/);
        return [{ total: 1 }];
      }
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return [];
      return [];
    } },
    groups: { backfillOrganization: async () => ({ visits: 0, nextCursor: null }) },
    budget: { ensureGlobalYearlyRun: async () => { budgetCalls += 1; } },
  });
  recovery.fail = async (_runId: string, _organizationId: string, code: string) => { failureCode = code; };
  const result = await recovery.process({ data: { organizationId: org, recoveryId }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'FAILED');
  assert.equal(failureCode, 'GROUP_SOURCE_OBSOLETE_OR_UNAVAILABLE');
  assert.equal(budgetCalls, 0);
});

test('recovery publishes the budget only after groups complete', async () => {
  const events: string[] = [];
  let runReads = 0;
  const recoveryId = '12121212-1212-4121-8121-121212121212';
  const recovery = service({
    db: { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) {
        runReads += 1;
        return [{ id: recoveryId, organizationId: org, stage: runReads >= 4 ? 'BUDGET' : 'GROUPS', status: 'PROCESSING', executionMode: 'IMMEDIATE', extractionRunId: '77777777-7777-4777-8777-777777777777', sourceVersion: null, reportCount: 1, findingCount: 1, expectedGroupCount: 1, budgetRunId: runReads >= 4 ? '13131313-1313-4131-8131-131313131313' : null }];
      }
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('processingStatus IN')) return [{ total: 1, ready: 1, pending: 0, failed: 0 }];
      if (sql.includes('recoveryRunId IS NULL')) {
        // Old jobs for removed visit groups remain durable but cannot contribute
        // findings, and must not block publication of the current READY set.
        assert.match(sql, /JSON_TABLE\(v\.photos, '\$\[\*\]'/);
        assert.match(sql, /JSON_TYPE\(entry\.analysis\)='OBJECT'/);
        return [{ total: 0 }];
      }
      if (sql.includes('AS lagging')) return [{ lagging: 0 }];
      if (sql.includes('SHA2(COALESCE(CAST(v.photos AS CHAR)')) return [{ id: 'report-1', photosHash: 'source-photo' }];
      if (sql.includes('reportUpdatedAt')) return [{ reportCount: 1, reportUpdatedAt: '', findingCount: 1, findingCreatedAt: '', catalogVersion: 0 }];
      if (sql.startsWith('SELECT id,snapshotId')) return [];
      if (sql.startsWith('SELECT id,version,matchingKey')) return [];
      if (sql.startsWith('SELECT status,lastError')) return [{ status: 'PUBLISHED', lastError: null }];
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return [];
      throw new Error(`unexpected query: ${sql}`);
    } },
    preview: async () => preview(),
    groups: { backfillOrganization: async () => { events.push('groups'); return { visits: 0, nextCursor: null }; } },
    budget: { ensureGlobalYearlyRun: async () => { events.push('budget'); return { runId: '13131313-1313-4131-8131-131313131313', status: 'PUBLISHED' }; } },
  });

  const result = await recovery.process({ data: { organizationId: org, recoveryId }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'COMPLETED');
  assert.deepEqual(events, ['groups', 'budget']);
});

test('recovery waits for report indexing after the final READY group before budget publication', async () => {
  const recoveryId = '34343434-3434-4343-8343-343434343434';
  let budgetCalls = 0;
  let retryCalls = 0;
  const recovery = service({
    db: { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{
        id: recoveryId, organizationId: org, stage: 'GROUPS', status: 'PROCESSING', expectedGroupCount: 1,
        extractionRunId: '77777777-7777-4777-8777-777777777777',
      }];
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('processingStatus IN')) return [{ total: 1, ready: 1, pending: 0, failed: 0 }];
      if (sql.includes('recoveryRunId IS NULL')) return [{ total: 0 }];
      if (sql.includes('AS lagging')) {
        assert.match(sql, /MAX\(s\.updatedAt\).*MAX\(e\.createdAt\)/s);
        assert.match(sql, /e\.aggregateType='REPORT' AND e\.eventType='REPORT_UPSERTED'/);
        return [{ lagging: 1 }];
      }
      if (sql.includes('AS failed FROM prevention_group_processing_jobs')) {
        assert.match(sql, /NOT EXISTS[\s\S]*newer\.createdAt>e\.createdAt/);
        return [{ failed: 0 }];
      }
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return { affectedRows: 1 };
      throw new Error(`unexpected query: ${sql}`);
    } },
    enqueueRecovery: async () => { retryCalls += 1; },
    groups: { backfillOrganization: async () => ({ visits: 0, nextCursor: null }) },
    budget: { ensureGlobalYearlyRun: async () => { budgetCalls += 1; } },
  });
  const result = await recovery.process({ data: { organizationId: org, recoveryId }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'WAITING_GROUP_INDEX');
  assert.equal(retryCalls, 1);
  assert.equal(budgetCalls, 0);
});

test('recovery fails explicitly when a report index event is terminally failed', async () => {
  const recoveryId = '45454545-4545-4454-8454-454545454545';
  let failureCode: unknown;
  const recovery = service({
    db: { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{
        id: recoveryId, organizationId: org, stage: 'GROUPS', status: 'PROCESSING', expectedGroupCount: 1,
        extractionRunId: '77777777-7777-4777-8777-777777777777',
      }];
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('processingStatus IN')) return [{ total: 1, ready: 1, pending: 0, failed: 0 }];
      if (sql.includes('recoveryRunId IS NULL')) return [{ total: 0 }];
      if (sql.includes('AS lagging')) return [{ lagging: 1 }];
      if (sql.includes('AS failed FROM prevention_group_processing_jobs')) return [{ failed: 1 }];
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return { affectedRows: 1 };
      throw new Error(`unexpected query: ${sql}`);
    } },
    groups: { backfillOrganization: async () => ({ visits: 0, nextCursor: null }) },
    budget: { ensureGlobalYearlyRun: async () => { throw new Error('budget should not run'); } },
  });
  recovery.fail = async (_runId: string, _organizationId: string, code: string) => { failureCode = code; };
  const result = await recovery.process({ data: { organizationId: org, recoveryId }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'FAILED');
  assert.equal(failureCode, 'PREVENTION_REPORT_INDEX_FAILED');
});

test('disabled organizations pause queued recovery without executing work', async () => {
  let extractionCalls = 0;
  const recovery = service({
    db: { query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', organizationId: org, stage: 'EXTRACTION', status: 'PROCESSING' }];
      if (sql.startsWith('SELECT isActive')) return [{ isActive: 0, preventionEnabled: 0 }];
      if (sql.startsWith('UPDATE prevention_hyper_admin_recovery_runs')) return [];
      throw new Error(`unexpected query: ${sql}`);
    } },
    enqueueExtraction: async () => { extractionCalls += 1; return { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'PROCESSING' }; },
  });
  const result = await recovery.process({ data: { organizationId: org, recoveryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, opts: { attempts: 1 }, attemptsMade: 0 } as any);
  assert.equal(result, 'PAUSED_DISABLED');
  assert.equal(extractionCalls, 0);
});

test('status remains tenant-scoped and reports shared worker health', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const recovery = service({
    db: { query: async (sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      if (sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs')) return [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', organizationId: org, status: 'FAILED', stage: 'FAILED', failedStage: 'GROUPS', extractionRunId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', reportCount: 4, findingCount: 5 }];
      if (sql.startsWith('SELECT id,isActive')) return [{ id: org, isActive: 1, preventionEnabled: 1 }];
      if (sql.includes("r.workKind='ACTIVATION'")) return [];
      if (sql.includes('FROM prevention_group_processing_jobs')) return [{ total: 2, pending: 1, ready: 1, failed: 0 }];
      if (sql.includes('FROM prevention_scheduler_checkpoints')) return [{ checkpointStatus: 'PROCESSING', processedReports: 2, pendingJobs: 1, failedJobs: 0 }];
      throw new Error(`unexpected query: ${sql}`);
    } },
    workerHealth: async () => ({ status: 'healthy', heartbeatAgeSeconds: 2 }),
  });
  const result = await recovery.status(org, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal((result as any).organization.paused, false);
  assert.deepEqual((result as any).worker, { status: 'healthy', heartbeatAgeSeconds: 2 });
  assert.deepEqual(calls.find((call) => call.sql.startsWith('SELECT * FROM prevention_hyper_admin_recovery_runs'))?.args, [org, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd']);
  assert.equal((result as any).latestRun.steps[0].status, 'SKIPPED');
  assert.equal((result as any).latestRun.steps[1].status, 'FAILED');
  assert.equal((result as any).latestRun.steps[2].status, 'SKIPPED');
});

test('bulk statuses use bounded tenant-scoped queries and one worker health read', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  let healthCalls = 0;
  const recovery = service({
    db: { query: async (sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      if (sql.startsWith('SELECT id,isActive')) return args.map((id) => ({ id, isActive: 1, preventionEnabled: 1 }));
      return [];
    } },
    workerHealth: async () => { healthCalls += 1; return { status: 'healthy', heartbeatAgeSeconds: 1 }; },
  });
  const result = await recovery.statuses([org, otherOrg, org, 'not-an-id']);
  assert.equal(result.length, 2);
  assert.equal(healthCalls, 1);
  assert.equal(calls.length, 4);
  assert.equal(calls.every((call) => call.args.every((arg) => arg === org || arg === otherOrg)), true);
  const activationQuery = calls.find((call) => call.sql.includes("r.workKind='ACTIVATION'"));
  assert.equal(activationQuery?.sql.includes('c.organizationId IN'), true);
  assert.equal(activationQuery?.sql.includes('r.organizationId IN'), false);
  assert.deepEqual((result[0] as any).worker, { status: 'healthy', heartbeatAgeSeconds: 1 });

  calls.length = 0;
  const manyOrganizations = Array.from({ length: 501 }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`);
  const manyResults = await recovery.statuses(manyOrganizations);
  assert.equal(manyResults.length, 501);
  assert.equal(healthCalls, 2);
  assert.equal(calls.length, 8);
  assert.equal(calls.every((call) => call.args.length <= 500), true);
});

test('bulk recovery progress counts only groups reconstructed by the latest run', async () => {
  const recoveryId = '99999999-9999-4999-8999-999999999999';
  const recovery = service({
    db: { query: async (sql: string) => {
      if (sql.startsWith('SELECT id,isActive')) return [{ id: org, isActive: 1, preventionEnabled: 1 }];
      if (sql.includes('FROM prevention_hyper_admin_recovery_runs r')) return [{
        id: recoveryId, organizationId: org, status: 'PROCESSING', stage: 'GROUPS', expectedGroupCount: 3,
      }];
      if (sql.includes('FROM prevention_group_processing_jobs')) return [
        { organizationId: org, recoveryRunId: null, total: 10, pending: 0, ready: 10, failed: 0 },
        { organizationId: org, recoveryRunId: recoveryId, total: 2, pending: 1, ready: 1, failed: 0 },
      ];
      return [];
    } },
  });
  const [result] = await recovery.statuses([org]);
  assert.deepEqual((result as any).groups, { total: 12, pending: 1, ready: 11, failed: 0 });
  assert.deepEqual((result as any).latestRun.steps[1], {
    kind: 'GROUPS', status: 'PROCESSING', total: 3, processed: 1, failed: 0,
  });
});

test('durable recovery sweep deduplicates a future scheduled run', async () => {
  const recoveryId = '99999999-9999-4999-8999-999999999999';
  const jobIds: string[] = [];
  const recovery = service({
    db: { query: async (sql: string) => {
      assert.match(sql, /leaseUntil IS NULL OR leaseUntil<UTC_TIMESTAMP\(6\)/);
      return [{ id: recoveryId, organizationId: org, status: 'SCHEDULED', scheduledFor: '2030-10-08T10:00:00.000Z',
        createdAt: '2026-10-08 10:00:00' }];
    } },
    queue: { add: async (_name: string, _data: unknown, options: { jobId: string }) => { jobIds.push(options.jobId); } },
  });
  await recovery.requeueActiveRuns();
  await recovery.requeueActiveRuns();
  assert.equal(jobIds.length, 2);
  assert.equal(jobIds[0], jobIds[1]);
});

test('durable recovery sweep can requeue a due run after an earlier LEASED job completed', async (t) => {
  const recoveryId = '99999999-9999-4999-8999-999999999999';
  const jobIds: string[] = [];
  let now = 1_791_465_000_000;
  t.mock.method(Date, 'now', () => now);
  const recovery = service({
    db: { query: async () => [{ id: recoveryId, organizationId: org, status: 'PROCESSING', scheduledFor: null,
      createdAt: '2026-10-08 10:00:00' }] },
    queue: { add: async (_name: string, _data: unknown, options: { jobId: string }) => { jobIds.push(options.jobId); } },
  });
  await recovery.requeueActiveRuns();
  await recovery.requeueActiveRuns();
  now += 60_000;
  await recovery.requeueActiveRuns();
  assert.equal(jobIds[0], jobIds[1]);
  assert.notEqual(jobIds[1], jobIds[2]);
});
