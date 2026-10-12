import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import {
  PreventionWorkerRuntimeService,
  retryWorkerDependency,
} from './prevention-worker-runtime.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPreventionWorkerHealth } from '../../scripts/check-prevention-worker-health';
import { PreventionReportConsumerService } from './prevention-report-consumer.service';
import { PREVENTION_AUDIT_REPORT_JOB } from '../scheduler/prevention-scheduler.types';
import { PREVENTION_RECOMMENDATION_JOB } from './prevention-group-processing.service';
import { PREVENTION_UPSERT_JOB } from '../outbox/prevention-outbox.types';

test('worker dependency retry is bounded and eventually succeeds', async () => {
  let calls = 0;
  const waits: number[] = [];
  await retryWorkerDependency(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('not ready');
    },
    3,
    25,
    async (delay) => { waits.push(delay); },
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [25, 25]);
});

test('production Redis configuration requires authentication', () => {
  const config = new ConfigService({ NODE_ENV: 'production', REDIS_PORT: '6379', REDIS_DB: '0' });
  assert.throws(() => createPreventionRedisOptions(config), /REDIS_PASSWORD/);
});

test('shared Redis configuration validates numeric options', () => {
  const config = new ConfigService({ REDIS_PORT: 'invalid', REDIS_DB: '0' });
  assert.throws(() => createPreventionRedisOptions(config), /REDIS_PORT/);
});

test('worker shutdown closes its Redis connection only once', async () => {
  let quits = 0;
  const redis = { quit: async () => { quits += 1; } };
  const runtime = new PreventionWorkerRuntimeService(
    {} as any,
    new ConfigService(),
    redis as any,
  );
  await runtime.onApplicationShutdown();
  await runtime.onApplicationShutdown();
  assert.equal(quits, 1);
});

test('worker readiness writes a bounded expiring heartbeat', async () => {
  const writes: unknown[][] = [];
  const runtime = new PreventionWorkerRuntimeService(
    { query: async () => [{ ok: 1 }] } as any,
    new ConfigService({
      PREVENTION_WORKER_STARTUP_ATTEMPTS: '1',
      PREVENTION_WORKER_HEARTBEAT_INTERVAL_MS: '5000',
      PREVENTION_WORKER_HEARTBEAT_TTL_SECONDS: '300',
    }),
    {
      ping: async () => 'PONG',
      set: async (...args: unknown[]) => { writes.push(args); return 'OK'; },
      quit: async () => undefined,
    } as any,
  );
  await runtime.onApplicationBootstrap();
  await runtime.onApplicationShutdown();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'prevention:observability:worker-heartbeat');
  assert.equal(writes[0][2], 'EX');
  assert.equal(writes[0][3], 300);
});

test('worker health rejects missing, future and stale heartbeats', async () => {
  const now = Date.now();
  assert.equal(await checkPreventionWorkerHealth({ get: async () => null } as any, 120, now), false);
  assert.equal(await checkPreventionWorkerHealth({ get: async () => String(now + 1) } as any, 120, now), false);
  assert.equal(await checkPreventionWorkerHealth({ get: async () => String(now - 121_000) } as any, 120, now), false);
  assert.equal(await checkPreventionWorkerHealth({ get: async () => String(now - 10_000) } as any, 120, now), true);
});

test('worker bootstrap stays outside the HTTP application', () => {
  const moduleSource = readFileSync(
    resolve(process.cwd(), 'src/prevention/worker/prevention-worker.module.ts'),
    'utf8',
  );
  const bootstrapSource = readFileSync(
    resolve(process.cwd(), 'src/workers/prevention.worker.ts'),
    'utf8',
  );
  assert.doesNotMatch(moduleSource, /AppModule|controllers\s*:/);
  assert.match(bootstrapSource, /createApplicationContext/);
  assert.doesNotMatch(bootstrapSource, /\.listen\s*\(|create\s*\(AppModule/);
  assert.match(bootstrapSource, /bufferLogs:\s*false/);
  assert.match(bootstrapSource, /Prevention worker bootstrap failed/);
});

test('a scheduled reread of unchanged data does not recalculate downstream projections', async () => {
  let auditSuccesses = 0;
  let statisticsRefreshes = 0;
  let budgetReconciliations = 0;
  const extraction = {
    indexReport: async (_organizationId: string, _reportId: string, _date: string, force: boolean) => {
      assert.equal(force, false);
      return 'UNCHANGED';
    },
  };
  const statistics = {
    refreshOrganization: async () => { statisticsRefreshes += 1; return 0; },
  };
  const scheduler = {
    handles: () => false,
    isManualRebuildTask: async () => false,
    recordAuditSuccess: async () => { auditSuccesses += 1; },
  };
  const budget = {
    enqueueReconcileForReport: async () => { budgetReconciliations += 1; return 1; },
  };
  const consumer = new PreventionReportConsumerService(
    new ConfigService(), extraction as any, statistics as any, scheduler as any, budget as any,
  );
  const result = await (consumer as any).process({
    name: PREVENTION_AUDIT_REPORT_JOB,
    attemptsMade: 0,
    opts: { attempts: 4 },
    data: {
      eventId: '40000000-0000-4000-8000-000000000001',
      checkpointId: '50000000-0000-4000-8000-000000000001',
      organizationId: '60000000-0000-4000-8000-000000000001',
      reportId: '70000000-0000-4000-8000-000000000001',
      eventType: 'REPORT_UPSERTED',
      aggregateVersion: 'v1',
      occurredAt: '2026-09-25T10:00:00.000Z',
    },
  });
  assert.equal(result, 'UNCHANGED');
  assert.equal(auditSuccesses, 1);
  assert.equal(statisticsRefreshes, 0);
  assert.equal(budgetReconciliations, 0);
});

test('a scheduled tenant report reread can enqueue missing recommendation types without rebuilding an unchanged report', async () => {
  let assessmentsQueued = 0;
  let forceSeen: boolean | null = null;
  let recoveryMode: boolean | null = null;
  const extraction = { indexReport: async (_organizationId: string, _reportId: string, _date: string, force: boolean) => {
    forceSeen = force;
    return 'UNCHANGED';
  } };
  const scheduler = { handles: () => false, isManualRebuildTask: async () => false,
    recordAuditSuccess: async () => {} };
  const groupProcessing = { enqueueEditedRecommendationsForReport: async (_organizationId: string, _reportId: string,
    _queue: unknown, _eventId: string, recoverMissingTypes: boolean) => {
    recoveryMode = recoverMissingTypes; assessmentsQueued += 1; return 1;
  } };
  const consumer = new PreventionReportConsumerService(new ConfigService(), extraction as any, {} as any,
    scheduler as any, undefined, undefined, groupProcessing as any);
  (consumer as any).groupQueue = {};
  const result = await (consumer as any).process({ name: PREVENTION_AUDIT_REPORT_JOB,
    attemptsMade: 0, opts: { attempts: 4 }, data: {
      eventId: '40000000-0000-4000-8000-000000000001',
      checkpointId: '50000000-0000-4000-8000-000000000001',
      organizationId: '60000000-0000-4000-8000-000000000001',
      reportId: '70000000-0000-4000-8000-000000000001',
      eventType: 'REPORT_UPSERTED', aggregateVersion: 'v1', occurredAt: '2026-09-25T10:00:00.000Z',
    } });
  assert.equal(result, 'UNCHANGED');
  assert.equal(assessmentsQueued, 1);
  assert.equal(recoveryMode, true);
  assert.equal(forceSeen, false);
});

test('an ordinary report event does not enable scheduled missing-type recovery', async () => {
  let recoveryMode: boolean | null = null;
  const extraction = { indexReport: async () => 'UNCHANGED' };
  const scheduler = { handles: () => false };
  const groupProcessing = { enqueueEditedRecommendationsForReport: async (_organizationId: string, _reportId: string,
    _queue: unknown, _eventId: string, recoverMissingTypes: boolean) => {
    recoveryMode = recoverMissingTypes; return 0;
  } };
  const consumer = new PreventionReportConsumerService(new ConfigService(), extraction as any, {} as any,
    scheduler as any, undefined, undefined, groupProcessing as any);
  (consumer as any).groupQueue = {};
  const result = await (consumer as any).process({ name: PREVENTION_UPSERT_JOB,
    attemptsMade: 0, opts: { attempts: 4 }, data: {
      eventId: '40000000-0000-4000-8000-000000000001',
      organizationId: '60000000-0000-4000-8000-000000000001',
      reportId: '70000000-0000-4000-8000-000000000001',
      eventType: 'REPORT_UPSERTED', aggregateVersion: 'v1', occurredAt: '2026-09-25T10:00:00.000Z',
    } });
  assert.equal(result, 'UNCHANGED');
  assert.equal(recoveryMode, false);
});

test('scheduled missing-type recovery waits for the Europe/Paris night window before invoking AI', async () => {
  const payload = { organizationId: '60000000-0000-4000-8000-000000000001',
    visitId: '70000000-0000-4000-8000-000000000001', sourceGroupId: 'group-1',
    recommendationHash: 'a'.repeat(64), recoveryMode: 'SCHEDULED_MISSING_TYPES' };
  let processed = 0;
  const deferred: Array<{ name: string; data: unknown; options: any }> = [];
  const groupProcessing = { processEditedRecommendations: async () => { processed += 1; return 'READY'; } };
  const consumer = new PreventionReportConsumerService(new ConfigService(), {} as any, {} as any,
    {} as any, undefined, undefined, groupProcessing as any, {} as any);
  (consumer as any).groupQueue = { add: async (name: string, data: unknown, options: any) => {
    deferred.push({ name, data, options });
  } };
  (consumer as any).recoveryNow = () => new Date('2026-10-07T12:00:00.000Z');
  const job = { name: PREVENTION_RECOMMENDATION_JOB, data: payload };
  assert.equal(await (consumer as any).process(job), 'DEFERRED');
  assert.equal(processed, 0);
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].name, PREVENTION_RECOMMENDATION_JOB);
  assert.deepEqual(deferred[0].data, payload);
  assert.ok(deferred[0].options.delay > 0);
  (consumer as any).recoveryNow = () => new Date('2026-10-07T21:00:00.000Z');
  assert.equal(await (consumer as any).process(job), 'READY');
  assert.equal(processed, 1);
});

test('explicit local missing-type recovery processes immediately without the scheduled night deferral', async () => {
  const payload = { organizationId: '60000000-0000-4000-8000-000000000001',
    visitId: '70000000-0000-4000-8000-000000000001', sourceGroupId: 'group-1',
    recommendationHash: 'a'.repeat(64), recoveryMode: 'IMMEDIATE_MISSING_TYPES', classificationLimit: 1 };
  let processed = 0;
  const consumer = new PreventionReportConsumerService(new ConfigService(), {} as any, {} as any,
    {} as any, undefined, undefined,
    { processEditedRecommendations: async () => { processed += 1; return 'READY'; } } as any, {} as any);
  (consumer as any).recoveryNow = () => new Date('2026-10-07T12:00:00.000Z');
  assert.equal(await (consumer as any).process({ name: PREVENTION_RECOMMENDATION_JOB, data: payload }), 'READY');
  assert.equal(processed, 1);
});

test('the dedicated worker dispatches edited recommendations to their scoped processor', async () => {
  const payload = { organizationId: '60000000-0000-4000-8000-000000000001',
    visitId: '70000000-0000-4000-8000-000000000001', sourceGroupId: 'group-1',
    recommendationHash: 'a'.repeat(64) };
  let called = false;
  const groupProcessing = { processEditedRecommendations: async (received: unknown) => {
    assert.deepEqual(received, payload);
    called = true;
    return 'READY';
  } };
  const consumer = new PreventionReportConsumerService(new ConfigService(), {} as any, {} as any,
    {} as any, undefined, undefined, groupProcessing as any, {} as any);
  assert.equal(await (consumer as any).process({ name: PREVENTION_RECOMMENDATION_JOB, data: payload }), 'READY');
  assert.equal(called, true);
});
