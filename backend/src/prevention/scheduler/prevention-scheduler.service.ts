import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PREVENTION_QUEUE_NAME, PREVENTION_UPSERT_JOB } from '../outbox/prevention-outbox.types';
import { PREVENTION_STATISTICS_REFRESH_JOB } from '../statistics/prevention-statistics.jobs';
import { loadPreventionSchedulerConfiguration, PreventionSchedulerConfiguration } from './prevention-scheduler.config';
import {
  PREVENTION_CLEANUP_JOB,
  PREVENTION_CONSOLIDATION_JOB,
  PREVENTION_DIFFERENTIAL_JOB,
  PREVENTION_MONTHLY_AUDIT_JOB,
  PREVENTION_AUDIT_REPORT_JOB,
  PREVENTION_RECOVERY_JOB,
  PREVENTION_MANUAL_REBUILD_JOB,
  PREVENTION_ORGANIZATION_SCAN_JOB,
  PREVENTION_SCHEDULED_JOBS,
  PREVENTION_SCHEDULER_TECHNICAL_JOBS,
  PREVENTION_SCHEDULE_DEFINITIONS,
  PREVENTION_WEEKLY_AUDIT_JOB,
  PreventionScheduledJobName,
  PreventionOrganizationScanPayload,
  PreventionRecoveryPayload,
  PreventionManualRebuildPayload,
} from './prevention-scheduler.types';

function deterministicUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function exactIso(value: unknown, fallbackTimestamp: number): string {
  if (value !== undefined) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
        Number.isNaN(Date.parse(value))) throw new Error('Invalid prevention scheduler occurrence');
    return value;
  }
  return new Date(fallbackTimestamp).toISOString();
}

export function isFirstSundayInParis(scheduledFor: string): boolean {
  const date = new Date(scheduledFor);
  const day = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', day: 'numeric',
  }).format(date));
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', weekday: 'short',
  }).format(date);
  return weekday === 'Sun' && day >= 1 && day <= 7;
}

@Injectable()
export class PreventionSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PreventionSchedulerService.name);
  private readonly settings: PreventionSchedulerConfiguration;
  private queue: Queue | null = null;
  private readonly instanceId = randomUUID();

  constructor(private readonly dataSource: DataSource, config: ConfigService) {
    this.settings = loadPreventionSchedulerConfiguration(config);
    if (this.settings.enabled) {
      this.queue = new Queue(PREVENTION_QUEUE_NAME, {
        connection: createPreventionRedisOptions(config),
      });
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.queue) return;
    for (const schedule of PREVENTION_SCHEDULE_DEFINITIONS) {
      const pattern = this.settings[schedule.configKey as keyof PreventionSchedulerConfiguration];
      await this.queue.upsertJobScheduler(
        schedule.id,
        { pattern: String(pattern), tz: this.settings.timezone },
        {
          name: schedule.name,
          data: { cursor: null },
          opts: { attempts: 4, backoff: { type: 'exponential', delay: 60_000 } },
        },
      );
    }
    await this.recoverAndContinue('CHECKPOINT', null, new Date().toISOString());
    await this.recoverAndContinue('TASK', null, new Date().toISOString());
  }

  async onApplicationShutdown(): Promise<void> {
    const queue = this.queue;
    this.queue = null;
    if (queue) await queue.close();
  }

  handles(name: string): name is PreventionScheduledJobName {
    return (PREVENTION_SCHEDULED_JOBS as readonly string[]).includes(name);
  }

  async process(job: Job): Promise<string> {
    if (!this.queue || !this.handles(job.name)) throw new Error('Unknown prevention scheduler job');
    const keys = Object.keys(job.data ?? {}).sort().join('|');
    let expected = job.name === PREVENTION_ORGANIZATION_SCAN_JOB
      ? (keys.includes('runId') ? 'organizationId|parentJobType|reportCursor|runId|scheduledFor' : 'organizationId|parentJobType|reportCursor|scheduledFor')
      : job.name === PREVENTION_RECOVERY_JOB
        ? 'cursor|recoveryType|scheduledFor'
      : keys === 'cursor' ? 'cursor' : 'cursor|scheduledFor';
    if (job.name === PREVENTION_MANUAL_REBUILD_JOB) expected = 'organizationId|runId|scheduledFor';
    if (keys !== expected) throw new Error('Invalid prevention scheduler payload fields');
    const scheduledFor = exactIso((job.data as any)?.scheduledFor, job.timestamp);
    const distance = Math.abs(Date.now() - Date.parse(scheduledFor));
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scheduledFor) ||
        distance > 366 * 86_400_000) throw new Error('Invalid prevention scheduler occurrence');
    if (job.name === PREVENTION_MANUAL_REBUILD_JOB) {
      const payload = job.data as PreventionManualRebuildPayload;
      if (keys !== 'organizationId|runId|scheduledFor' || !/^[0-9a-f-]{36}$/i.test(payload.organizationId) ||
          !/^[0-9a-f-]{36}$/i.test(payload.runId)) throw new Error('Invalid prevention manual rebuild payload');
      const [run]: Array<{ id: string }> = await this.dataSource.query(
        `SELECT r.id FROM prevention_scheduler_runs r
         JOIN prevention_scheduler_checkpoints c ON c.runId=r.id
         WHERE r.id=? AND r.jobType='MANUAL_REBUILD' AND r.status='PROCESSING'
           AND c.organizationId=? LIMIT 1`,
        [payload.runId, payload.organizationId],
      );
      if (!run) throw new Error('Invalid prevention manual rebuild ownership');
      await this.enqueueOrganizationScan(
        PREVENTION_CONSOLIDATION_JOB, payload.organizationId, scheduledFor, null, payload.runId,
      );
      await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET enqueuedJobs=1
         WHERE id=? AND jobType='MANUAL_REBUILD' AND status='PROCESSING'`,
        [payload.runId],
      );
      return 'ENQUEUED';
    }
    if (job.name === PREVENTION_ORGANIZATION_SCAN_JOB) {
      return this.processOrganizationScan(job.data as PreventionOrganizationScanPayload);
    }
    if (job.name === PREVENTION_RECOVERY_JOB) {
      const payload = job.data as PreventionRecoveryPayload;
      if (!['CHECKPOINT', 'TASK'].includes(payload.recoveryType) ||
          (payload.cursor !== null && !/^[0-9a-f-]{36}$/i.test(payload.cursor))) {
        throw new Error('Invalid prevention recovery payload');
      }
      await this.recoverAndContinue(payload.recoveryType, payload.cursor, scheduledFor);
      return 'COMPLETED';
    }
    if (job.name === PREVENTION_MONTHLY_AUDIT_JOB && !isFirstSundayInParis(scheduledFor)) {
      return 'SKIPPED_NOT_FIRST_SUNDAY';
    }
    if (job.name === PREVENTION_CLEANUP_JOB) {
      return this.cleanup(scheduledFor);
    }
    return this.processBatch(job.name, scheduledFor);
  }

  private async processBatch(jobType: PreventionScheduledJobName, scheduledFor: string): Promise<string> {
    await this.recoverAndContinue('CHECKPOINT', null, new Date().toISOString());
    await this.recoverAndContinue('TASK', null, new Date().toISOString());
    const runId = deterministicUuid(`${jobType}|${scheduledFor}`);
    await this.dataSource.query(
      `INSERT IGNORE INTO prevention_scheduler_runs
        (id,jobType,scheduledFor,status,organizationCursor,availableAt)
       VALUES (?,?,?,'PENDING',NULL,UTC_TIMESTAMP(6))`,
      [runId, jobType, scheduledFor],
    );
    const claimed = await this.dataSource.transaction(async (manager) => {
      const [run]: Array<any> = await manager.query(
        `SELECT id,organizationCursor,status FROM prevention_scheduler_runs
         WHERE id=? AND (status='PENDING' OR
           (status='PROCESSING' AND lockedAt<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE)))
         FOR UPDATE`,
        [runId],
      );
      if (!run) return null;
      await manager.query(
        `UPDATE prevention_scheduler_runs SET status='PROCESSING',lockedAt=UTC_TIMESTAMP(6),
          lockedBy=?,attempts=attempts+1,lastError=NULL WHERE id=?`,
        [this.instanceId, runId],
      );
      return { cursor: run.organizationCursor as string | null };
    });
    if (!claimed) return 'SKIPPED';
    try {
      const organizations: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM organizations WHERE isActive=1 AND (? IS NULL OR id>?)
         ORDER BY id LIMIT ?`,
        [claimed.cursor, claimed.cursor, this.settings.organizationBatchSize + 1],
      );
      const batch = organizations.slice(0, this.settings.organizationBatchSize);
      let enqueued = 0;
      for (const organization of batch) {
        enqueued += await this.processOrganization(jobType, organization.id, scheduledFor);
      }
      const hasMore = organizations.length > batch.length;
      const cursor = batch.at(-1)?.id ?? claimed.cursor;
      const awaitsChildren = jobType !== PREVENTION_CLEANUP_JOB && batch.length > 0;
      const advanced: any = await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET status=?,organizationCursor=?,processedOrganizations=processedOrganizations+?,
          enqueuedJobs=enqueuedJobs+?,dispatchComplete=?,lockedAt=NULL,lockedBy=NULL
          WHERE id=? AND lockedBy=?`,
        [hasMore ? 'PENDING' : awaitsChildren ? 'PROCESSING' : 'COMPLETED', cursor,
          batch.length, enqueued, hasMore ? 0 : 1, runId, this.instanceId],
      );
      if (!advanced?.affectedRows) throw new Error('Prevention scheduler run lease was lost');
      if (hasMore) await this.enqueueContinuation(jobType, scheduledFor, cursor);
      else await this.finalizeRunIfComplete(runId);
      return hasMore ? 'CONTINUED' : 'COMPLETED';
    } catch (error: any) {
      await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET status='PENDING',availableAt=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),
          lockedAt=NULL,lockedBy=NULL,lastError=? WHERE id=? AND lockedBy=?`,
        [String(error?.code ?? error?.name ?? 'UNKNOWN').slice(0, 500), runId, this.instanceId],
      );
      throw error;
    }
  }

  private async processOrganization(
    jobType: PreventionScheduledJobName,
    organizationId: string,
    scheduledFor: string,
  ): Promise<number> {
    if (jobType !== PREVENTION_DIFFERENTIAL_JOB && jobType !== PREVENTION_CONSOLIDATION_JOB &&
        jobType !== PREVENTION_WEEKLY_AUDIT_JOB &&
        jobType !== PREVENTION_MONTHLY_AUDIT_JOB) {
      throw new Error('Invalid prevention organization scheduler job');
    }
    await this.enqueueOrganizationScan(jobType, organizationId, scheduledFor, null);
    return 1;
  }

  private async processOrganizationScan(payload: PreventionOrganizationScanPayload): Promise<string> {
    if (!payload || (Object.keys(payload).sort().join('|') !== 'organizationId|parentJobType|reportCursor|scheduledFor' && Object.keys(payload).sort().join('|') !== 'organizationId|parentJobType|reportCursor|runId|scheduledFor') ||
        !/^\d{4}-\d{2}-\d{2}T/.test(payload.scheduledFor) ||
        !/^[0-9a-f-]{36}$/i.test(payload.organizationId) ||
        ![PREVENTION_DIFFERENTIAL_JOB, PREVENTION_CONSOLIDATION_JOB, PREVENTION_WEEKLY_AUDIT_JOB,
          PREVENTION_MONTHLY_AUDIT_JOB].includes(payload.parentJobType) ||
        (payload.reportCursor !== null && !/^[0-9a-f-]{36}$/i.test(payload.reportCursor))) {
      throw new Error('Invalid prevention organization scan payload');
    }
    const runId = payload.runId ?? deterministicUuid(`${payload.parentJobType}|${payload.scheduledFor}`);
    const checkpointId = deterministicUuid(`${runId}|${payload.organizationId}`);
    await this.dataSource.query(
      `INSERT IGNORE INTO prevention_scheduler_checkpoints
        (id,runId,organizationId,reportCursor,status,processedReports)
       VALUES (?,?,?,NULL,'PENDING',0)`,
      [checkpointId, runId, payload.organizationId],
    );
    const checkpoint = await this.dataSource.transaction(async (manager) => {
      const [row]: Array<{ reportCursor: string | null; status: string }> = await manager.query(
        `SELECT reportCursor,status FROM prevention_scheduler_checkpoints
         WHERE id=? AND organizationId=? FOR UPDATE`, [checkpointId, payload.organizationId]);
      if (!row || row.status === 'COMPLETED') return null;
      const claim: any = await manager.query(
        `UPDATE prevention_scheduler_checkpoints SET status='PROCESSING',lockedAt=UTC_TIMESTAMP(6),
          lockedBy=?,attempts=attempts+1,lastError=NULL WHERE id=? AND organizationId=? AND
          (status='PENDING' OR lockedAt<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE))`,
        [this.instanceId, checkpointId, payload.organizationId]);
      return claim?.affectedRows ? row : null;
    });
    if (!checkpoint) return 'SKIPPED';
    try {
    const fullRebuild = payload.parentJobType !== PREVENTION_DIFFERENTIAL_JOB;
    const reports: Array<{ id: string; updatedAt: Date }> = await this.dataSource.query(
      `SELECT r.id,r.updatedAt FROM reports r
       LEFT JOIN prevention_report_snapshots s ON s.organizationId=r.organizationId AND s.reportId=r.id
       WHERE r.organizationId=? AND r.id>? ${fullRebuild ? '' : 'AND (s.id IS NULL OR s.sourceUpdatedAt<r.updatedAt)'}
       ORDER BY r.id LIMIT ?`,
      [payload.organizationId, checkpoint.reportCursor ?? '', this.settings.reportBatchSize + 1],
    );
    const page = reports.slice(0, this.settings.reportBatchSize);
    for (const report of page) {
      const eventId = deterministicUuid(`${payload.parentJobType}|${payload.scheduledFor}|${payload.organizationId}|${report.id}`);
      await this.dataSource.query(
        `INSERT IGNORE INTO prevention_scheduler_tasks
          (id,checkpointId,organizationId,reportId,status,attempts)
         VALUES (?,?,?,?,'PENDING',0)`,
        [eventId, checkpointId, payload.organizationId, report.id],
      );
      await this.enqueueAuditTask({ id: eventId, checkpointId,
        organizationId: payload.organizationId, reportId: report.id,
        aggregateVersion: new Date(report.updatedAt).toISOString(),
        scheduledFor: payload.scheduledFor });
    }
    const cursor = page.at(-1)?.id ?? checkpoint.reportCursor;
    const hasMore = reports.length > page.length;
    const advanced: any = await this.dataSource.query(
      `UPDATE prevention_scheduler_checkpoints SET status=?,reportCursor=?,processedReports=processedReports+?,
        scanComplete=?,lockedAt=NULL,lockedBy=NULL
       WHERE id=? AND organizationId=? AND lockedBy=?`,
      [hasMore ? 'PENDING' : 'PROCESSING', cursor, page.length,
        hasMore ? 0 : 1, checkpointId,
        payload.organizationId, this.instanceId],
    );
    if (!advanced?.affectedRows) throw new Error('Prevention checkpoint lease was lost');
    if (hasMore) await this.enqueueOrganizationScan(
      payload.parentJobType, payload.organizationId, payload.scheduledFor, cursor, payload.runId,
    );
    if (!hasMore) await this.completeCheckpointIfTasksDone(checkpointId, payload.organizationId);
    return hasMore ? 'CONTINUED' : 'COMPLETED';
    } catch (error: any) {
      await this.dataSource.query(
        `UPDATE prevention_scheduler_checkpoints SET status='PENDING',availableAt=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),
          lockedAt=NULL,lockedBy=NULL,lastError=? WHERE id=? AND organizationId=? AND lockedBy=?`,
        [String(error?.code ?? error?.name ?? 'UNKNOWN').slice(0, 500), checkpointId,
          payload.organizationId, this.instanceId],
      );
      throw error;
    }
  }

  private async finalizeRunIfComplete(runId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE prevention_scheduler_runs r SET status='COMPLETED',lockedAt=NULL,lockedBy=NULL
       WHERE r.id=? AND r.status='PROCESSING' AND r.dispatchComplete=1 AND NOT EXISTS (
         SELECT 1 FROM prevention_scheduler_checkpoints c
         WHERE c.runId=r.id AND c.status<>'COMPLETED')`, [runId],
    );
  }

  async recordAuditSuccess(taskId: string, checkpointId: string, organizationId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE prevention_scheduler_tasks SET status='COMPLETED',lastError=NULL
       WHERE id=? AND checkpointId=? AND organizationId=? AND status='PENDING'`,
      [taskId, checkpointId, organizationId],
    );
    await this.completeCheckpointIfTasksDone(checkpointId, organizationId);
  }

  async recordAuditTerminalFailure(taskId: string, checkpointId: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const result: any = await manager.query(
        `UPDATE prevention_scheduler_tasks SET status='FAILED',attempts=attempts+1,
          lastError='AUDIT_JOB_FAILED'
         WHERE id=? AND checkpointId=? AND organizationId=? AND status='PENDING'`,
        [taskId, checkpointId, organizationId],
      );
      if (!result?.affectedRows) return;
      await manager.query(
        `UPDATE prevention_scheduler_checkpoints SET status='FAILED',failedJobs=failedJobs+1,
          lastError='AUDIT_JOB_FAILED',lockedAt=NULL,lockedBy=NULL
         WHERE id=? AND organizationId=? AND status<>'COMPLETED'`,
        [checkpointId, organizationId],
      );
      await manager.query(
        `UPDATE prevention_scheduler_runs r
         JOIN prevention_scheduler_checkpoints c ON c.runId=r.id
         SET r.status='FAILED',r.lastError='AUDIT_JOB_FAILED',r.lockedAt=NULL,r.lockedBy=NULL
         WHERE c.id=? AND c.organizationId=? AND r.status<>'COMPLETED'`,
        [checkpointId, organizationId],
      );
    });
  }

  private async completeCheckpointIfTasksDone(checkpointId: string, organizationId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE prevention_scheduler_checkpoints c SET status='COMPLETED',lockedAt=NULL,lockedBy=NULL
       WHERE c.id=? AND c.organizationId=? AND c.scanComplete=1 AND NOT EXISTS (
         SELECT 1 FROM prevention_scheduler_tasks t WHERE t.checkpointId=c.id AND t.status<>'COMPLETED')`,
      [checkpointId, organizationId],
    );
    const [row]: Array<{ runId: string }> = await this.dataSource.query(
      'SELECT runId FROM prevention_scheduler_checkpoints WHERE id=? AND organizationId=? AND status=\'COMPLETED\'',
      [checkpointId, organizationId],
    );
    if (row) await this.finalizeRunIfComplete(row.runId);
  }

  private async recoverIncompleteCheckpoints(cursor: string | null): Promise<string | null> {
    if (!this.queue) return null;
    const rows: Array<any> = await this.dataSource.query(
      `SELECT c.id,c.runId,c.organizationId,c.reportCursor,r.jobType,r.scheduledFor
       FROM prevention_scheduler_checkpoints c JOIN prevention_scheduler_runs r ON r.id=c.runId
       WHERE c.id>? AND (c.status='PENDING' OR (c.status='PROCESSING' AND c.scanComplete=0 AND
         c.lockedAt<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE)))
       ORDER BY c.id LIMIT 101`, [cursor ?? ""],
    );
    for (const row of rows.slice(0, 100)) {
      const manual = row.jobType === "MANUAL_REBUILD";
      await this.enqueueOrganizationScan(
        manual ? PREVENTION_CONSOLIDATION_JOB : row.jobType, row.organizationId,
        new Date(row.scheduledFor).toISOString(), row.reportCursor, manual ? row.runId : undefined,
      );
    }
    return rows.length > 100 ? rows[99].id : null;
  }

  private async recoverIncompleteTasks(cursor: string | null): Promise<string | null> {
    if (!this.queue) return null;
    const tasks: Array<any> = await this.dataSource.query(
      `SELECT t.id,t.checkpointId,t.organizationId,t.reportId,r.scheduledFor,rep.updatedAt
       FROM prevention_scheduler_tasks t
       JOIN prevention_scheduler_checkpoints c ON c.id=t.checkpointId
       JOIN prevention_scheduler_runs r ON r.id=c.runId
       LEFT JOIN reports rep ON rep.id=t.reportId AND rep.organizationId=t.organizationId
       WHERE t.status='PENDING' AND t.id>? ORDER BY t.id LIMIT 101`, [cursor ?? ''],
    );
    for (const task of tasks.slice(0, 100)) {
      if (!task.updatedAt) {
        await this.recordAuditSuccess(task.id, task.checkpointId, task.organizationId);
        continue;
      }
      await this.enqueueAuditTask({ id: task.id, checkpointId: task.checkpointId,
        organizationId: task.organizationId, reportId: task.reportId,
        aggregateVersion: new Date(task.updatedAt).toISOString(),
        scheduledFor: new Date(task.scheduledFor).toISOString() });
    }
    return tasks.length > 100 ? tasks[99].id : null;
  }

  private async recoverAndContinue(
    recoveryType: PreventionRecoveryPayload['recoveryType'], cursor: string | null,
    scheduledFor: string,
  ): Promise<void> {
    const nextCursor = recoveryType === 'CHECKPOINT'
      ? await this.recoverIncompleteCheckpoints(cursor)
      : await this.recoverIncompleteTasks(cursor);
    if (!nextCursor) return;
    const digest = createHash('sha256').update(`${recoveryType}|${scheduledFor}|${nextCursor}`).digest('hex');
    await this.queue!.add(PREVENTION_RECOVERY_JOB, { recoveryType, cursor: nextCursor, scheduledFor }, {
      jobId: `prevention-scheduler-recovery-${digest}`, attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
  }

  private async enqueueAuditTask(task: { id: string; checkpointId: string; organizationId: string;
    reportId: string; aggregateVersion: string; scheduledFor: string }): Promise<void> {
    const jobId = `prevention-scheduler-${task.id}`;
    const existing = await this.queue!.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
      else return;
    }
    await this.queue!.add(PREVENTION_AUDIT_REPORT_JOB, {
      eventId: task.id, checkpointId: task.checkpointId, organizationId: task.organizationId,
      reportId: task.reportId, eventType: 'REPORT_UPSERTED',
      aggregateVersion: task.aggregateVersion, occurredAt: task.scheduledFor,
    }, { jobId, attempts: 4, backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 1000, removeOnFail: 1000 });
  }

  private async enqueueOrganizationScan(
    parentJobType: PreventionOrganizationScanPayload['parentJobType'],
    organizationId: string,
    scheduledFor: string,
    reportCursor: string | null,
    runId?: string,
  ): Promise<void> {
    const digest = createHash('sha256').update(
      `${parentJobType}|${scheduledFor}|${organizationId}|${reportCursor ?? 'FIRST'}|${runId ?? 'SCHEDULED'}`,
    ).digest('hex');
    const jobId = `prevention-scheduler-org-${digest}`;
    const existing = await this.queue!.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
      else return;
    }
    await this.queue!.add(PREVENTION_ORGANIZATION_SCAN_JOB, {
      ...(runId ? { runId } : {}), parentJobType, organizationId, scheduledFor, reportCursor,
    }, { jobId, attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000,
      removeOnFail: 1000 });
  }

  private async enqueueStatistics(organizationId: string, scheduledFor: string, source: string): Promise<void> {
    const eventId = deterministicUuid(`${source}|${scheduledFor}|${organizationId}`);
    await this.queue!.add(PREVENTION_STATISTICS_REFRESH_JOB, {
      organizationId, referenceDate: scheduledFor.slice(0, 10), triggerEventId: eventId,
    }, { jobId: `prevention-scheduler-statistics-${eventId}`, attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 1000 });
  }

  private async enqueueContinuation(jobType: PreventionScheduledJobName, scheduledFor: string, cursor: string | null): Promise<void> {
    const digest = createHash('sha256').update(`${jobType}|${scheduledFor}|${cursor}`).digest('hex');
    await this.queue!.add(jobType, { scheduledFor, cursor }, {
      jobId: `prevention-scheduler-page-${digest}`, attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
  }

  private async cleanup(scheduledFor: string): Promise<string> {
    const runId = deterministicUuid(`${PREVENTION_CLEANUP_JOB}|${scheduledFor}`);
    const inserted: any = await this.dataSource.query(
      `INSERT IGNORE INTO prevention_scheduler_runs
        (id,jobType,scheduledFor,status,availableAt,processedOrganizations,enqueuedJobs)
       VALUES (?,?,?,'PENDING',UTC_TIMESTAMP(6),0,0)`,
      [runId, PREVENTION_CLEANUP_JOB, scheduledFor],
    );
    const claim: any = await this.dataSource.query(
      `UPDATE prevention_scheduler_runs SET status='PROCESSING',lockedAt=UTC_TIMESTAMP(6),lockedBy=?,
        attempts=attempts+1 WHERE id=? AND (status='PENDING' OR
        (status='PROCESSING' AND lockedAt<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE)))`,
      [this.instanceId, runId],
    );
    if (!claim?.affectedRows) return 'SKIPPED';
    try {
      const completed = await this.removeExpiredSchedulerJobs(
        'completed', this.settings.completedRetentionSeconds,
      );
      const failed = await this.removeExpiredSchedulerJobs(
        'failed', this.settings.failedRetentionSeconds,
      );
      await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET status='COMPLETED',enqueuedJobs=?,lockedAt=NULL,lockedBy=NULL
         WHERE id=? AND lockedBy=?`,
        [completed.length + failed.length, runId, this.instanceId],
      );
      this.logger.log(`Prevention BullMQ cleanup completed removed=${completed.length + failed.length}`);
      return 'COMPLETED';
    } catch (error: any) {
      await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET status='PENDING',lockedAt=NULL,lockedBy=NULL,lastError=?
         WHERE id=? AND lockedBy=?`,
        [String(error?.code ?? error?.name ?? 'UNKNOWN').slice(0, 500), runId, this.instanceId],
      );
      throw error;
    }
  }

  private async removeExpiredSchedulerJobs(
    state: 'completed' | 'failed',
    retentionSeconds: number,
  ): Promise<string[]> {
    const jobs = await this.queue!.getJobs([state], 0, 999, true);
    const cutoff = Date.now() - retentionSeconds * 1000;
    const removed: string[] = [];
    for (const job of jobs) {
      const finishedAt = job.finishedOn ?? job.timestamp;
      if (PREVENTION_SCHEDULER_TECHNICAL_JOBS.includes(job.name) &&
          job.name !== PREVENTION_CLEANUP_JOB && finishedAt < cutoff) {
        await job.remove();
        if (job.id) removed.push(job.id);
      }
    }
    return removed;
  }
}
