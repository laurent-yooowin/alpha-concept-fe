import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { loadPreventionObservabilityConfiguration } from './prevention-observability.config';
import { PreventionObservabilityController } from './prevention-observability.controller';
import { PreventionObservabilityService } from './prevention-observability.service';
import { PreventionObservabilitySnapshot } from './prevention-observability.types';

const token = 'observability-test-token-with-at-least-32-characters';

function isolatedConfig(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : fallback,
  } as ConfigService;
}

function snapshot(): PreventionObservabilitySnapshot {
  return {
    queue: { waiting: 2, active: 1, delayed: 0, failed: 3, completed: 10 },
    outbox: { PENDING: 1, PROCESSING: 2, PUBLISHED: 8, FAILED: 0 },
    schedulerRuns: { PENDING: 1, PROCESSING: 1, COMPLETED: 4, FAILED: 0 },
    checkpoints: { PENDING: 1, PROCESSING: 0, COMPLETED: 4, FAILED: 0 },
    tasks: { PENDING: 3, COMPLETED: 7, FAILED: 0 },
    oldestPendingAgeSeconds: { outbox: 10, scheduler: 20, checkpoints: 30 },
    processing: { completedCount: 10, failedCount: 3, retriedCount: 2, averageDurationSeconds: 1.25, p95DurationSeconds: 2.5 },
    retries: { outboxEvents: 2, outboxAttempts: 4 },
    progression: { processedOrganizations: 4, processedReports: 12, pendingJobs: 3, failedJobs: 0 },
    health: {
      status: 'ok',
      dependencies: { mysql: 'ok', redis: 'ok' },
      worker: { status: 'ok', heartbeatAgeSeconds: 2 },
      alerts: [],
    },
  };
}

test('observability configuration requires a strong token and bounds thresholds', () => {
  assert.throws(() => loadPreventionObservabilityConfiguration(isolatedConfig()), /PREVENTION_OBSERVABILITY_TOKEN/);
  assert.throws(() => loadPreventionObservabilityConfiguration(isolatedConfig({ PREVENTION_OBSERVABILITY_TOKEN: 'short' })), /PREVENTION_OBSERVABILITY_TOKEN/);
  const configuration = loadPreventionObservabilityConfiguration(isolatedConfig({ PREVENTION_OBSERVABILITY_TOKEN: token }));
  assert.equal(configuration.delayAlertSeconds, 900);
  assert.throws(() => loadPreventionObservabilityConfiguration(isolatedConfig({
    PREVENTION_OBSERVABILITY_TOKEN: token,
    PREVENTION_ALERT_DELAY_SECONDS: '59',
  })), /PREVENTION_ALERT_DELAY_SECONDS/);
  assert.throws(() => loadPreventionObservabilityConfiguration(isolatedConfig({
    PREVENTION_OBSERVABILITY_TOKEN: token,
    PREVENTION_WORKER_HEARTBEAT_STALE_SECONDS: '3601',
  })), /PREVENTION_WORKER_HEARTBEAT_STALE_SECONDS/);
});

test('observability authorization and Prometheus output expose only finite labels', async () => {
  const service: any = Object.create(PreventionObservabilityService.prototype);
  service.configuration = {
    token,
    delayAlertSeconds: 900,
    heartbeatStaleSeconds: 120,
    workerHeartbeatKey: 'prevention:observability:worker-heartbeat',
    allowedIps: new Set(['127.0.0.1']), cacheTtlMs: 5000, timeoutMs: 3000,
    minimumScrapeIntervalMs: 1000,
  };
  service.collect = async () => snapshot();

  assert.equal(service.isAuthorized(token), true);
  assert.equal(service.isAuthorized(`${token}x`), false);
  const output = await service.metricsText();
  assert.match(output, /prevention_queue_jobs\{state="waiting"\} 2/);
  assert.match(output, /prevention_alert_active\{alert="PREVENTION_TERMINAL_FAILURE"\} 0/);
  assert.match(output, /prevention_retries\{source="bullmq_jobs"\} 2/);
  assert.match(output, /prevention_retries\{source="outbox_attempts"\} 4/);
  assert.doesNotMatch(output, /organizationId|reportId|userId|email|secret|message=/i);
  assert.ok(output.endsWith('\n'));
});

test('health raises deterministic delay and terminal failure alerts', async () => {
  const service: any = Object.create(PreventionObservabilityService.prototype);
  service.configuration = {
    token,
    delayAlertSeconds: 900,
    heartbeatStaleSeconds: 120,
    workerHeartbeatKey: 'prevention:observability:worker-heartbeat',
    allowedIps: new Set(['127.0.0.1']), cacheTtlMs: 5000, timeoutMs: 3000,
    minimumScrapeIntervalMs: 1000,
  };
  service.checkMysql = async () => 'ok';
  service.checkRedis = async () => 'ok';
  service.readWorkerHeartbeat = async () => ({ status: 'degraded', heartbeatAgeSeconds: 121 });
  service.alertSignals = async () => ({
    oldestPendingAgeSeconds: { outbox: 901, scheduler: 0, checkpoints: 902 },
    terminalFailures: 1,
  });

  const health = await service.health();
  assert.equal(health.status, 'degraded');
  assert.deepEqual(health.alerts, [
    'PREVENTION_WORKER_HEARTBEAT_STALE',
    'PREVENTION_OUTBOX_DELAYED',
    'PREVENTION_CHECKPOINT_DELAYED',
    'PREVENTION_TERMINAL_FAILURE',
  ]);
});

test('collector aggregates fixed operational states without tenant data', async () => {
  const service: any = Object.create(PreventionObservabilityService.prototype);
  const statements: string[] = [];
  service.queue = {
    getJobCounts: async () => ({ waiting: 1, active: 2, delayed: 3, failed: 4, completed: 5 }),
    getJobs: async () => [],
  };
  service.redis = {
    ping: async () => 'PONG',
    get: async () => String(Date.now()),
  };
  service.configuration = {
    token,
    delayAlertSeconds: 900,
    heartbeatStaleSeconds: 120,
    workerHeartbeatKey: 'prevention:observability:worker-heartbeat',
    allowedIps: new Set(['127.0.0.1']), cacheTtlMs: 5000, timeoutMs: 3000,
    minimumScrapeIntervalMs: 1000,
  };
  service.dataSource = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('GROUP BY status')) return [{ status: 'PENDING', count: '2' }, { status: 'FAILED', count: '1' }];
      if (sql.includes('TIMESTAMPDIFF')) return [{ age: '4' }];
      if (sql.includes('processedOrganizations')) return [{ processedOrganizations: '7' }];
      if (sql.includes('processedReports')) return [{ processedReports: '11', pendingJobs: '3', failedJobs: '1' }];
      if (sql.includes('terminalFailures')) return [{ terminalFailures: '1' }];
      if (sql.includes('outboxEvents')) return [{ outboxEvents: '2', outboxAttempts: '5' }];
      return [{ 1: 1 }];
    },
  };
  service.logger = { warn: () => undefined };

  const result = await service.collect();
  assert.deepEqual(result.queue, { waiting: 1, active: 2, delayed: 3, failed: 4, completed: 5 });
  assert.equal(result.outbox.PENDING, 2);
  assert.equal(result.schedulerRuns.FAILED, 1);
  assert.equal(result.progression.processedOrganizations, 7);
  assert.equal(result.progression.processedReports, 11);
  assert.equal(result.health.alerts.includes('PREVENTION_TERMINAL_FAILURE'), true);
  assert.equal(result.health.alerts.includes('PREVENTION_WORKER_HEARTBEAT_MISSING'), false);
  assert.ok(statements.filter((sql) => sql.includes('JOIN organizations o') || sql.includes('FROM organizations o'))
    .every((sql) => sql.includes('o.isActive=1 AND o.preventionEnabled=1')));
});

test('internal controller rejects missing or invalid technical tokens', async () => {
  const service: any = {
    isAuthorized: (value: string | undefined) => value === token,
    isClientAllowed: (value: string | undefined) => value === '127.0.0.1',
    consumeScrape: () => true,
    metricsText: async () => 'metrics\n',
    health: async () => ({ status: 'ok' }),
  };
  const controller = new PreventionObservabilityController(service);
  const request = { ip: '127.0.0.1' } as any;
  await assert.rejects(() => controller.health(undefined, request), (error: unknown) =>
    error instanceof HttpException && error.getStatus() === 401,
  );
  await assert.rejects(() => controller.health('wrong-token', request), (error: unknown) =>
    error instanceof HttpException && error.getStatus() === 401,
  );
  const result = await controller.health(token, request);
  assert.deepEqual(result, { status: 'ok' });

  let contentType = '';
  let body = '';
  const response: any = {
    type: (value: string) => { contentType = value; return response; },
    send: (value: string) => { body = value; return response; },
  };
  await controller.metrics(token, request, response);
  assert.equal(contentType, 'text/plain; version=0.0.4');
  assert.equal(body, 'metrics\n');
});

test('internal controller rejects disallowed clients and excessive scrapes', async () => {
  let allowed = false;
  let scrapeAllowed = true;
  const service: any = {
    isAuthorized: () => true,
    isClientAllowed: () => allowed,
    consumeScrape: () => scrapeAllowed,
    health: async () => ({ status: 'ok' }),
  };
  const controller = new PreventionObservabilityController(service);
  const request = { ip: '192.0.2.10' } as any;
  await assert.rejects(() => controller.health(token, request), (error: unknown) =>
    error instanceof HttpException && error.getStatus() === 403,
  );
  allowed = true;
  scrapeAllowed = false;
  await assert.rejects(() => controller.health(token, request), (error: unknown) =>
    error instanceof HttpException && error.getStatus() === 429,
  );
});

test('observability timeout is bounded and health reports dependency failure', async () => {
  const service: any = Object.create(PreventionObservabilityService.prototype);
  service.configuration = {
    token, delayAlertSeconds: 900, heartbeatStaleSeconds: 120,
    workerHeartbeatKey: 'prevention:observability:worker-heartbeat',
    allowedIps: new Set(['127.0.0.1']), cacheTtlMs: 5000, timeoutMs: 5,
    minimumScrapeIntervalMs: 1000,
  };
  await assert.rejects(
    () => service.withTimeout(new Promise(() => undefined), 'test'),
    /observability test timeout/,
  );
  service.checkMysql = async () => 'down';
  service.checkRedis = async () => 'ok';
  service.readWorkerHeartbeat = async () => ({ status: 'ok', heartbeatAgeSeconds: 1 });
  service.alertSignals = async () => ({
    oldestPendingAgeSeconds: { outbox: 0, scheduler: 0, checkpoints: 0 }, terminalFailures: 0,
  });
  service.healthCache = null;
  service.configuration.timeoutMs = 3000;
  const health = await service.health();
  assert.equal(health.status, 'down');
  assert.deepEqual(health.alerts, ['PREVENTION_DEPENDENCY_DOWN']);
});

test('processing metrics distinguish first attempts, retries and final states', async () => {
  const service: any = Object.create(PreventionObservabilityService.prototype);
  service.queue = {
    getJobs: async (states: string[]) => states[0] === 'completed'
      ? [
        { processedOn: 1_000, finishedOn: 1_100, attemptsMade: 1 },
        { processedOn: 2_000, finishedOn: 2_300, attemptsMade: 2, failedReason: 'previous attempt' },
      ]
      : [{ processedOn: 3_000, finishedOn: 3_200, attemptsMade: 4, failedReason: 'terminal' }],
  };

  const result = await service.recentDurations();

  assert.equal(result.completedCount, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(result.retriedCount, 2);
  assert.equal(result.averageDurationSeconds, 0.2);
  assert.equal(result.p95DurationSeconds, 0.3);
});

test('processing metrics exclude jobs belonging to disabled tenants', async () => {
  const service: any = Object.create(PreventionObservabilityService.prototype);
  service.queue = {
    getJobs: async (states: string[]) => states[0] === 'completed'
      ? [
        { data: { organizationId: 'enabled' }, processedOn: 1_000, finishedOn: 1_100, attemptsMade: 1 },
        { data: { organizationId: 'disabled' }, processedOn: 2_000, finishedOn: 2_200, attemptsMade: 3 },
        { data: {}, processedOn: 3_000, finishedOn: 3_300, attemptsMade: 1 },
      ]
      : [{ data: { organizationId: 'disabled' }, processedOn: 4_000, finishedOn: 4_400, attemptsMade: 2 }],
  };
  service.dataSource = {
    query: async (_sql: string, tenantIds: string[]) => {
      assert.deepEqual(tenantIds.sort(), ['disabled', 'enabled']);
      return [{ id: 'enabled' }];
    },
  };

  const result = await service.recentDurations();

  assert.equal(result.completedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.equal(result.retriedCount, 0);
  assert.equal(result.averageDurationSeconds, 0.2);
  assert.equal(result.p95DurationSeconds, 0.3);
});
