import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PREVENTION_QUEUE_NAME } from '../outbox/prevention-outbox.types';
import { loadPreventionObservabilityConfiguration, PreventionObservabilityConfiguration } from './prevention-observability.config';
import { PreventionHealthSnapshot, PreventionObservabilitySnapshot, PreventionOperationalStatus } from './prevention-observability.types';

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
const OUTBOX_STATES = ['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'] as const;
const RUN_STATES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
const CHECKPOINT_STATES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
const TASK_STATES = ['PENDING', 'COMPLETED', 'FAILED'] as const;
const ALERTS = [
  'PREVENTION_DEPENDENCY_DOWN',
  'PREVENTION_WORKER_HEARTBEAT_MISSING',
  'PREVENTION_WORKER_HEARTBEAT_STALE',
  'PREVENTION_OUTBOX_DELAYED',
  'PREVENTION_SCHEDULER_DELAYED',
  'PREVENTION_CHECKPOINT_DELAYED',
  'PREVENTION_TERMINAL_FAILURE',
] as const;

type CountRow = { status: string; count: string | number };

function zeroRecord<const T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function ageValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
}

@Injectable()
export class PreventionObservabilityService implements OnModuleDestroy {
  private readonly logger = new Logger(PreventionObservabilityService.name);
  private readonly configuration: PreventionObservabilityConfiguration;
  private readonly queue: Queue;
  private readonly redis: Redis;
  private metricsCache: { expiresAt: number; value: string } | null = null;
  private healthCache: { expiresAt: number; value: PreventionHealthSnapshot } | null = null;
  private readonly nextScrapeByIp = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.configuration = loadPreventionObservabilityConfiguration(config);
    this.redis = new Redis(createPreventionRedisOptions(config));
    this.queue = new Queue(PREVENTION_QUEUE_NAME, { connection: this.redis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    await this.redis.quit().catch(() => this.redis.disconnect(false));
  }

  isAuthorized(token: string | undefined): boolean {
    if (!token || token.length !== this.configuration.token.length) return false;
    const expected = Buffer.from(this.configuration.token);
    const received = Buffer.from(token);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  isClientAllowed(ip: string | undefined): boolean {
    return Boolean(ip && this.configuration.allowedIps.has(ip));
  }

  consumeScrape(ip: string, scope: 'health' | 'metrics'): boolean {
    const now = Date.now();
    const key = `${ip}|${scope}`;
    const next = this.nextScrapeByIp.get(key) ?? 0;
    if (next > now) return false;
    this.nextScrapeByIp.set(key, now + this.configuration.minimumScrapeIntervalMs);
    return true;
  }

  async health(): Promise<PreventionHealthSnapshot> {
    if (this.healthCache && this.healthCache.expiresAt > Date.now()) return this.healthCache.value;
    const value = await this.withTimeout(this.collectHealth(), 'health');
    this.healthCache = { expiresAt: Date.now() + this.configuration.cacheTtlMs, value };
    return value;
  }

  private async collectHealth(): Promise<PreventionHealthSnapshot> {
    const [mysql, redis, heartbeat, signals] = await Promise.all([
      this.checkMysql(),
      this.checkRedis(),
      this.readWorkerHeartbeat(),
      this.alertSignals(),
    ]);
    return this.healthSnapshot(mysql, redis, heartbeat, signals);
  }

  async collect(): Promise<PreventionObservabilitySnapshot> {
    const [queueCounts, outbox, schedulerRuns, checkpoints, tasks, oldest, progression, health, jobs, retries] = await Promise.all([
      this.queue.getJobCounts(...QUEUE_STATES),
      this.countByStatus('prevention_outbox_events', OUTBOX_STATES),
      this.countByStatus('prevention_scheduler_runs', RUN_STATES),
      this.countByStatus('prevention_scheduler_checkpoints', CHECKPOINT_STATES),
      this.countByStatus('prevention_scheduler_tasks', TASK_STATES),
      this.oldestPendingAges(),
      this.progression(),
      this.health(),
      this.recentDurations(),
      this.outboxRetries(),
    ]);
    const queue = zeroRecord(QUEUE_STATES);
    const queueCountMap = queueCounts as unknown as Record<string, number>;
    for (const state of QUEUE_STATES) queue[state] = numberValue(queueCountMap[state]);
    return {
      queue,
      outbox,
      schedulerRuns: schedulerRuns as PreventionObservabilitySnapshot['schedulerRuns'],
      checkpoints: checkpoints as PreventionObservabilitySnapshot['checkpoints'],
      tasks: tasks as PreventionObservabilitySnapshot['tasks'],
      oldestPendingAgeSeconds: oldest,
      processing: jobs,
      retries,
      progression,
      health,
    };
  }

  async metricsText(): Promise<string> {
    if (this.metricsCache && this.metricsCache.expiresAt > Date.now()) return this.metricsCache.value;
    const value = await this.withTimeout(this.renderMetricsText(), 'metrics');
    this.metricsCache = { expiresAt: Date.now() + this.configuration.cacheTtlMs, value };
    return value;
  }

  private async renderMetricsText(): Promise<string> {
    const snapshot = await this.collect();
    const lines: string[] = [
      '# HELP prevention_queue_jobs BullMQ jobs by state.',
      '# TYPE prevention_queue_jobs gauge',
      ...QUEUE_STATES.map((state) => `prevention_queue_jobs{state="${state}"} ${snapshot.queue[state]}`),
      '# HELP prevention_outbox_events Outbox events by state.',
      '# TYPE prevention_outbox_events gauge',
      ...OUTBOX_STATES.map((state) => `prevention_outbox_events{status="${state}"} ${snapshot.outbox[state]}`),
      '# HELP prevention_scheduler_runs Scheduler runs by state.',
      '# TYPE prevention_scheduler_runs gauge',
      ...RUN_STATES.map((state) => `prevention_scheduler_runs{status="${state}"} ${snapshot.schedulerRuns[state]}`),
      '# HELP prevention_scheduler_checkpoints Scheduler checkpoints by state.',
      '# TYPE prevention_scheduler_checkpoints gauge',
      ...CHECKPOINT_STATES.map((state) => `prevention_scheduler_checkpoints{status="${state}"} ${snapshot.checkpoints[state]}`),
      '# HELP prevention_scheduler_tasks Scheduler tasks by state.',
      '# TYPE prevention_scheduler_tasks gauge',
      ...TASK_STATES.map((state) => `prevention_scheduler_tasks{status="${state}"} ${snapshot.tasks[state]}`),
      '# HELP prevention_oldest_pending_age_seconds Age of the oldest pending operational item.',
      '# TYPE prevention_oldest_pending_age_seconds gauge',
      `prevention_oldest_pending_age_seconds{source="outbox"} ${snapshot.oldestPendingAgeSeconds.outbox}`,
      `prevention_oldest_pending_age_seconds{source="scheduler"} ${snapshot.oldestPendingAgeSeconds.scheduler}`,
      `prevention_oldest_pending_age_seconds{source="checkpoint"} ${snapshot.oldestPendingAgeSeconds.checkpoints}`,
      '# HELP prevention_processing_jobs Recent BullMQ processing result.',
      '# TYPE prevention_processing_jobs gauge',
      `prevention_processing_jobs{outcome="completed"} ${snapshot.processing.completedCount}`,
      `prevention_processing_jobs{outcome="failed"} ${snapshot.processing.failedCount}`,
      `prevention_processing_jobs{outcome="retried"} ${snapshot.processing.retriedCount}`,
      '# HELP prevention_retries Retry signals retained by the operational stores.',
      '# TYPE prevention_retries gauge',
      `prevention_retries{source="bullmq_jobs"} ${snapshot.processing.retriedCount}`,
      `prevention_retries{source="outbox_events"} ${snapshot.retries.outboxEvents}`,
      `prevention_retries{source="outbox_attempts"} ${snapshot.retries.outboxAttempts}`,
      '# HELP prevention_processing_duration_seconds Recent BullMQ processing duration.',
      '# TYPE prevention_processing_duration_seconds gauge',
      `prevention_processing_duration_seconds{statistic="average"} ${snapshot.processing.averageDurationSeconds}`,
      `prevention_processing_duration_seconds{statistic="p95"} ${snapshot.processing.p95DurationSeconds}`,
      '# HELP prevention_progression Scheduler progression counters.',
      '# TYPE prevention_progression gauge',
      `prevention_progression{counter="processed_organizations"} ${snapshot.progression.processedOrganizations}`,
      `prevention_progression{counter="processed_reports"} ${snapshot.progression.processedReports}`,
      `prevention_progression{counter="pending_jobs"} ${snapshot.progression.pendingJobs}`,
      `prevention_progression{counter="failed_jobs"} ${snapshot.progression.failedJobs}`,
      '# HELP prevention_dependency_up Dependency and worker health.',
      '# TYPE prevention_dependency_up gauge',
      `prevention_dependency_up{dependency="mysql"} ${snapshot.health.dependencies.mysql === 'ok' ? 1 : 0}`,
      `prevention_dependency_up{dependency="redis"} ${snapshot.health.dependencies.redis === 'ok' ? 1 : 0}`,
      `prevention_dependency_up{dependency="worker"} ${snapshot.health.worker.status === 'ok' ? 1 : 0}`,
      '# HELP prevention_alert_active Active operational alerts.',
      '# TYPE prevention_alert_active gauge',
      ...ALERTS.map((alert) => `prevention_alert_active{alert="${alert}"} ${snapshot.health.alerts.includes(alert) ? 1 : 0}`),
    ];
    return `${lines.join('\n')}\n`;
  }

  private async withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Prevention observability ${label} timeout`)),
            this.configuration.timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async countByStatus<T extends readonly string[]>(table: string, states: T): Promise<Record<T[number], number>> {
    const result = zeroRecord(states);
    const enabledScope: Record<string, string> = {
      prevention_outbox_events: 'WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id=prevention_outbox_events.organizationId AND o.isActive=1 AND o.preventionEnabled=1)',
      prevention_scheduler_runs: 'WHERE EXISTS (SELECT 1 FROM prevention_scheduler_checkpoints c JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1 WHERE c.runId=prevention_scheduler_runs.id)',
      prevention_scheduler_checkpoints: 'WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id=prevention_scheduler_checkpoints.organizationId AND o.isActive=1 AND o.preventionEnabled=1)',
      prevention_scheduler_tasks: 'WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id=prevention_scheduler_tasks.organizationId AND o.isActive=1 AND o.preventionEnabled=1)',
    };
    const rows: CountRow[] = await this.dataSource.query(
      `SELECT status,COUNT(*) count FROM ${table} ${enabledScope[table] ?? ''} GROUP BY status`,
    );
    for (const row of rows) if (Object.prototype.hasOwnProperty.call(result, row.status)) result[row.status as T[number]] = numberValue(row.count);
    return result;
  }

  private async oldestPendingAges(): Promise<PreventionObservabilitySnapshot['oldestPendingAgeSeconds']> {
    const [outbox, scheduler, checkpoints] = await Promise.all([
      this.dataSource.query(`SELECT COALESCE(TIMESTAMPDIFF(SECOND,MIN(availableAt),UTC_TIMESTAMP(6)),0) age FROM prevention_outbox_events WHERE status='PENDING' AND availableAt<=UTC_TIMESTAMP(6) AND EXISTS (SELECT 1 FROM organizations o WHERE o.id=prevention_outbox_events.organizationId AND o.isActive=1 AND o.preventionEnabled=1)`),
      this.dataSource.query(`SELECT COALESCE(TIMESTAMPDIFF(SECOND,MIN(availableAt),UTC_TIMESTAMP(6)),0) age FROM prevention_scheduler_runs WHERE status='PENDING' AND availableAt<=UTC_TIMESTAMP(6) AND EXISTS (SELECT 1 FROM prevention_scheduler_checkpoints c JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1 WHERE c.runId=prevention_scheduler_runs.id)`),
      this.dataSource.query(`SELECT COALESCE(TIMESTAMPDIFF(SECOND,MIN(availableAt),UTC_TIMESTAMP(6)),0) age FROM prevention_scheduler_checkpoints WHERE status='PENDING' AND availableAt<=UTC_TIMESTAMP(6) AND EXISTS (SELECT 1 FROM organizations o WHERE o.id=prevention_scheduler_checkpoints.organizationId AND o.isActive=1 AND o.preventionEnabled=1)`),
    ]);
    return { outbox: ageValue(outbox[0]?.age), scheduler: ageValue(scheduler[0]?.age), checkpoints: ageValue(checkpoints[0]?.age) };
  }

  private async progression(): Promise<PreventionObservabilitySnapshot['progression']> {
    const [[runRow], [checkpointRow]] = await Promise.all([
      this.dataSource.query(
        `SELECT COALESCE(SUM(processedOrganizations),0) processedOrganizations
         FROM prevention_scheduler_runs r
         WHERE r.status IN ('PENDING','PROCESSING') AND EXISTS (
           SELECT 1 FROM prevention_scheduler_checkpoints c
           JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1
           WHERE c.runId=r.id)`,
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(processedReports),0) processedReports,
          COALESCE(SUM(pendingJobs),0) pendingJobs,
          COALESCE(SUM(failedJobs),0) failedJobs
         FROM prevention_scheduler_checkpoints c
         JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1
         WHERE c.status IN ('PENDING','PROCESSING','FAILED')`,
      ),
    ]);
    return {
      processedOrganizations: numberValue(runRow?.processedOrganizations),
      processedReports: numberValue(checkpointRow?.processedReports),
      pendingJobs: numberValue(checkpointRow?.pendingJobs),
      failedJobs: numberValue(checkpointRow?.failedJobs),
    };
  }

  private async alertSignals(): Promise<{
    oldestPendingAgeSeconds: PreventionObservabilitySnapshot['oldestPendingAgeSeconds'];
    terminalFailures: number;
  }> {
    try {
      const [oldestPendingAgeSeconds, [row]] = await Promise.all([
        this.oldestPendingAges(),
        this.dataSource.query(
          `SELECT
            (SELECT COUNT(*) FROM prevention_outbox_events e JOIN organizations o ON o.id=e.organizationId AND o.isActive=1 AND o.preventionEnabled=1 WHERE e.status='FAILED') +
            (SELECT COUNT(*) FROM prevention_scheduler_runs r WHERE r.status='FAILED' AND EXISTS (SELECT 1 FROM prevention_scheduler_checkpoints c JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1 WHERE c.runId=r.id)) +
            (SELECT COUNT(*) FROM prevention_scheduler_checkpoints c JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1 WHERE c.status='FAILED') +
            (SELECT COUNT(*) FROM prevention_scheduler_tasks t JOIN organizations o ON o.id=t.organizationId AND o.isActive=1 AND o.preventionEnabled=1 WHERE t.status='FAILED') terminalFailures`,
        ),
      ]);
      return { oldestPendingAgeSeconds, terminalFailures: numberValue(row?.terminalFailures) };
    } catch {
      return { oldestPendingAgeSeconds: { outbox: 0, scheduler: 0, checkpoints: 0 }, terminalFailures: 0 };
    }
  }

  private async recentDurations(): Promise<PreventionObservabilitySnapshot['processing']> {
    const [completedJobs, failedJobs] = await Promise.all([
      this.queue.getJobs(['completed'], 0, 999, true),
      this.queue.getJobs(['failed'], 0, 999, true),
    ]);
    const allJobs = [...completedJobs, ...failedJobs];
    const tenantIds = [...new Set(allJobs
      .map((job) => (job as any)?.data?.organizationId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0))];
    let enabledTenantIds = new Set<string>();
    if (tenantIds.length && this.dataSource?.query) {
      const placeholders = tenantIds.map(() => '?').join(',');
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM organizations WHERE isActive=1 AND preventionEnabled=1 AND id IN (${placeholders})`, tenantIds,
      );
      enabledTenantIds = new Set(rows.map((row) => String(row.id)));
    }
    const isOperationalJob = (job: any): boolean => {
      const organizationId = job?.data?.organizationId;
      // Scheduler orchestration jobs without a tenant payload are global and
      // are retained; tenant payloads are retained only for enabled tenants.
      if (organizationId === undefined || organizationId === null || organizationId === '') return true;
      return typeof organizationId === 'string' && enabledTenantIds.has(organizationId);
    };
    const completed = completedJobs.filter(isOperationalJob);
    const failed = failedJobs.filter(isOperationalJob);
    const jobs = [...completed, ...failed];
    const durations = jobs
      .map((job) => Number(job.finishedOn ?? 0) - Number(job.processedOn ?? 0))
      .filter((duration) => Number.isFinite(duration) && duration >= 0)
      .map((duration) => duration / 1000);
    return {
      completedCount: completed.length,
      failedCount: failed.length,
      // BullMQ records the first processing attempt as attemptsMade=1.
      retriedCount: jobs.filter((job) => Number(job.attemptsMade ?? 0) > 1).length,
      averageDurationSeconds: durations.length ? Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(3)) : 0,
      p95DurationSeconds: Number(quantile(durations, 0.95).toFixed(3)),
    };
  }

  private async outboxRetries(): Promise<PreventionObservabilitySnapshot['retries']> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*) outboxEvents,COALESCE(SUM(attempts),0) outboxAttempts
       FROM prevention_outbox_events e
       WHERE e.attempts>0 AND EXISTS (
         SELECT 1 FROM organizations o
         WHERE o.id=e.organizationId AND o.isActive=1 AND o.preventionEnabled=1
       )`,
    );
    return {
      outboxEvents: numberValue(row?.outboxEvents),
      outboxAttempts: numberValue(row?.outboxAttempts),
    };
  }

  private async checkMysql(): Promise<PreventionOperationalStatus> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'ok';
    } catch (error) {
      this.logger.warn(`Prevention observability MySQL probe failed code=${String((error as any)?.code ?? 'UNKNOWN').slice(0, 64)}`);
      return 'down';
    }
  }

  private async checkRedis(): Promise<PreventionOperationalStatus> {
    try {
      return (await this.redis.ping()) === 'PONG' ? 'ok' : 'degraded';
    } catch (error) {
      this.logger.warn(`Prevention observability Redis probe failed code=${String((error as any)?.code ?? 'UNKNOWN').slice(0, 64)}`);
      return 'down';
    }
  }

  private async readWorkerHeartbeat(): Promise<PreventionHealthSnapshot['worker']> {
    try {
      const value = await this.redis.get(this.configuration.workerHeartbeatKey);
      if (!value) return { status: 'unknown', heartbeatAgeSeconds: null };
      const timestamp = Number(value);
      if (!Number.isFinite(timestamp)) return { status: 'unknown', heartbeatAgeSeconds: null };
      const age = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
      return { status: age <= this.configuration.heartbeatStaleSeconds ? 'ok' : 'degraded', heartbeatAgeSeconds: age };
    } catch {
      return { status: 'down', heartbeatAgeSeconds: null };
    }
  }

  private healthSnapshot(
    mysql: PreventionOperationalStatus,
    redis: PreventionOperationalStatus,
    heartbeat: PreventionHealthSnapshot['worker'],
    signals: { oldestPendingAgeSeconds: PreventionObservabilitySnapshot['oldestPendingAgeSeconds']; terminalFailures: number },
  ): PreventionHealthSnapshot {
    const alerts = this.alerts(mysql, redis, heartbeat, signals);
    const dependencyDown = mysql === 'down' || redis === 'down';
    return {
      status: dependencyDown ? 'down' : alerts.length ? 'degraded' : 'ok',
      dependencies: { mysql, redis },
      worker: heartbeat,
      alerts,
    };
  }

  private alerts(
    mysql: PreventionOperationalStatus,
    redis: PreventionOperationalStatus,
    heartbeat: PreventionHealthSnapshot['worker'],
    signals: { oldestPendingAgeSeconds: PreventionObservabilitySnapshot['oldestPendingAgeSeconds']; terminalFailures: number },
  ): string[] {
    const alerts: string[] = [];
    if (mysql === 'down' || redis === 'down') alerts.push('PREVENTION_DEPENDENCY_DOWN');
    if (heartbeat.status === 'unknown') alerts.push('PREVENTION_WORKER_HEARTBEAT_MISSING');
    if (heartbeat.status === 'degraded') alerts.push('PREVENTION_WORKER_HEARTBEAT_STALE');
    if (signals.oldestPendingAgeSeconds.outbox >= this.configuration.delayAlertSeconds) alerts.push('PREVENTION_OUTBOX_DELAYED');
    if (signals.oldestPendingAgeSeconds.scheduler >= this.configuration.delayAlertSeconds) alerts.push('PREVENTION_SCHEDULER_DELAYED');
    if (signals.oldestPendingAgeSeconds.checkpoints >= this.configuration.delayAlertSeconds) alerts.push('PREVENTION_CHECKPOINT_DELAYED');
    if (signals.terminalFailures > 0) alerts.push('PREVENTION_TERMINAL_FAILURE');
    return alerts;
  }
}
