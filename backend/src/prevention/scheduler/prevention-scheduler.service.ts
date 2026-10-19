import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PREVENTION_UPSERT_JOB } from '../outbox/prevention-outbox.types';
import { PREVENTION_BULK_QUEUE_NAME, PREVENTION_GROUP_QUEUE_NAME } from '../queue/prevention-queue.constants';
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
import { PreventionActivationService } from '../prevention-activation.service';
import { PreventionExtractionService } from '../extraction/prevention-extraction.service';
import { PreventionBudgetService } from '../budget/prevention-budget.service';
import { PreventionBulkAdmissionService } from './prevention-bulk-admission.service';
import { PreventionBulkLease } from './prevention-bulk-admission.types';
import { PreventionGroupProcessingService } from '../worker/prevention-group-processing.service';

function deterministicUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function mysqlUtcIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) {
    throw new Error('Invalid prevention scheduler UTC timestamp');
  }
  return `${value.slice(0, 10)}T${value.slice(11, 23)}Z`;
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
  private groupQueue: Queue | null = null;
  private readonly instanceId = randomUUID();

  private schedulerLog(event: string, correlationValue: string, fields: Record<string, unknown> = {}): void {
    this.logger.log({
      message: event,
      context: PreventionSchedulerService.name,
      event,
      correlationId: createHash('sha256').update(correlationValue).digest('hex').slice(0, 16),
      ...fields,
    } as any);
  }

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
    @Optional() private readonly activation?: PreventionActivationService,
    @Optional() private readonly extraction?: PreventionExtractionService,
    @Optional() private readonly budget?: PreventionBudgetService,
    @Optional() private readonly bulkAdmission?: PreventionBulkAdmissionService,
    @Optional() private readonly groupProcessing?: PreventionGroupProcessingService,
  ) {
    this.settings = loadPreventionSchedulerConfiguration(config);
    if (this.settings.enabled) {
      this.queue = new Queue(PREVENTION_BULK_QUEUE_NAME, {
        connection: createPreventionRedisOptions(config),
      });
      this.groupQueue = new Queue(PREVENTION_GROUP_QUEUE_NAME, {
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
    await this.recoverAndContinue('RUN', null, new Date().toISOString());
    await this.recoverAndContinue('CHECKPOINT', null, new Date().toISOString());
    await this.recoverAndContinue('TASK', null, new Date().toISOString());
  }

  async onApplicationShutdown(): Promise<void> {
    const queue = this.queue;
    this.queue = null;
    if (queue) await queue.close();
    const groupQueue = this.groupQueue;
    this.groupQueue = null;
    if (groupQueue) await groupQueue.close();
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
      if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
      const [run]: Array<{ id: string; executionMode?: 'IMMEDIATE' | 'SCHEDULED' }> = await this.dataSource.query(
        `SELECT r.id,r.executionMode FROM prevention_scheduler_runs r
         JOIN prevention_scheduler_checkpoints c ON c.runId=r.id
         WHERE r.id=? AND r.jobType='MANUAL_REBUILD' AND r.status IN ('PENDING','PROCESSING','SCHEDULED')
           AND c.organizationId=? LIMIT 1`,
        [payload.runId, payload.organizationId],
      );
      if (!run) throw new Error('Invalid prevention manual rebuild ownership');
      if (this.bulkAdmission) {
        const admission = await this.bulkAdmission.admit({
          organizationId: payload.organizationId, runId: payload.runId,
          workKind: 'ADMIN_RECONSTRUCTION', scheduledFor,
          executionMode: run.executionMode ?? 'IMMEDIATE',
        });
        if (!admission.admitted) {
          const availableAt = admission.availableAt ? Date.parse(admission.availableAt) : Date.now() + 60_000;
          await this.dataSource.query(
            `UPDATE prevention_scheduler_runs SET status='SCHEDULED',availableAt=? WHERE id=? AND jobType='MANUAL_REBUILD'`,
            [new Date(availableAt), payload.runId],
          );
          await this.enqueueDeferredManualRebuild(payload, Math.max(1_000, availableAt - Date.now()));
          return 'WAITING';
        }
        await this.dataSource.query(
          `UPDATE prevention_scheduler_runs SET status='PROCESSING',availableAt=UTC_TIMESTAMP(6) WHERE id=? AND jobType='MANUAL_REBUILD'`,
          [payload.runId],
        );
      }
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
      if (!['RUN', 'CHECKPOINT', 'TASK'].includes(payload.recoveryType) ||
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
    const startedAt = Date.now();
    await this.recoverAndContinue('RUN', null, new Date().toISOString());
    await this.recoverAndContinue('CHECKPOINT', null, new Date().toISOString());
    await this.recoverAndContinue('TASK', null, new Date().toISOString());
    const runId = deterministicUuid(`${jobType}|${scheduledFor}`);
    this.schedulerLog('PREVENTION_SCHEDULER_RUN_STARTED', runId, { jobType });
    await this.dataSource.query(
      `INSERT IGNORE INTO prevention_scheduler_runs
        (id,jobType,scheduledFor,status,organizationCursor,availableAt)
       VALUES (?,?,?,'PENDING',NULL,UTC_TIMESTAMP(6))`,
      [runId, jobType, scheduledFor],
    );
    const claimed = await this.dataSource.transaction(async (manager) => {
      const [run]: Array<any> = await manager.query(
        `SELECT id,organizationCursor,status FROM prevention_scheduler_runs
         WHERE id=? AND availableAt<=UTC_TIMESTAMP(6) AND (status='PENDING' OR
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
    if (!claimed) {
      this.schedulerLog('PREVENTION_SCHEDULER_RUN_SKIPPED', runId, { jobType });
      return 'SKIPPED';
    }
    try {
      const organizations: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM organizations WHERE isActive=1 AND preventionEnabled=1 AND (? IS NULL OR id>?)
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
      const [disabledPendingCheckpoint]: Array<{ id: string }> = jobType === PREVENTION_CLEANUP_JOB
        ? []
        : await this.dataSource.query(
          `SELECT c.id FROM prevention_scheduler_checkpoints c
           JOIN organizations o ON o.id=c.organizationId
           WHERE c.runId=? AND c.status<>'COMPLETED' AND (o.isActive=0 OR o.preventionEnabled=0) LIMIT 1`, [runId],
        );
      const awaitsChildren = jobType !== PREVENTION_CLEANUP_JOB &&
        (batch.length > 0 || Boolean(disabledPendingCheckpoint));
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
      this.schedulerLog('PREVENTION_SCHEDULER_RUN_ADVANCED', runId, {
        jobType, result: hasMore ? 'CONTINUED' : 'COMPLETED',
        processedOrganizations: batch.length, enqueuedJobs: enqueued,
        durationMs: Date.now() - startedAt,
      });
      return hasMore ? 'CONTINUED' : 'COMPLETED';
    } catch (error: any) {
      await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET status='PENDING',availableAt=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),
          lockedAt=NULL,lockedBy=NULL,lastError=? WHERE id=? AND lockedBy=?`,
        [String(error?.code ?? error?.name ?? 'UNKNOWN').slice(0, 500), runId, this.instanceId],
      );
      this.schedulerLog('PREVENTION_SCHEDULER_RUN_RETRY_SCHEDULED', runId, {
        jobType, durationMs: Date.now() - startedAt,
      });
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
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return 0;
    await this.enqueueOrganizationScan(jobType, organizationId, scheduledFor, null);
    return 1;
  }

  private async processOrganizationScan(payload: PreventionOrganizationScanPayload): Promise<string> {
    const startedAt = Date.now();
    if (!payload || (Object.keys(payload).sort().join('|') !== 'organizationId|parentJobType|reportCursor|scheduledFor' && Object.keys(payload).sort().join('|') !== 'organizationId|parentJobType|reportCursor|runId|scheduledFor') ||
        !/^\d{4}-\d{2}-\d{2}T/.test(payload.scheduledFor) ||
        !/^[0-9a-f-]{36}$/i.test(payload.organizationId) ||
        ![PREVENTION_DIFFERENTIAL_JOB, PREVENTION_CONSOLIDATION_JOB, PREVENTION_WEEKLY_AUDIT_JOB,
          PREVENTION_MONTHLY_AUDIT_JOB].includes(payload.parentJobType) ||
        (payload.reportCursor !== null && !/^[0-9a-f-]{36}$/i.test(payload.reportCursor))) {
      throw new Error('Invalid prevention organization scan payload');
    }
    if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
    const runId = payload.runId ?? deterministicUuid(`${payload.parentJobType}|${payload.scheduledFor}`);
    if (payload.runId) {
      if (payload.parentJobType !== PREVENTION_CONSOLIDATION_JOB) {
        throw new Error('Invalid prevention organization scan job type');
      }
      const [owned]: Array<{ id: string }> = await this.dataSource.query(
        `SELECT r.id FROM prevention_scheduler_runs r
         JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?
         WHERE r.id=? AND r.jobType='MANUAL_REBUILD' AND r.workKind='ADMIN_RECONSTRUCTION'
           AND r.status IN ('PENDING','PROCESSING','SCHEDULED') LIMIT 1`,
        [payload.organizationId, runId],
      );
      if (!owned) throw new Error('Invalid prevention organization scan ownership');
    } else {
      const [run]: Array<{ workKind: string; checkpointId: string | null }> = await this.dataSource.query(
        `SELECT r.workKind,c.id AS checkpointId FROM prevention_scheduler_runs r
         LEFT JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?
         WHERE r.id=? AND r.jobType=? LIMIT 1`,
        [payload.organizationId, runId, payload.parentJobType],
      );
      if (run?.workKind === 'ACTIVATION' && !run.checkpointId) {
        throw new Error('Invalid prevention activation scan ownership');
      }
    }
    let bulkLease: PreventionBulkLease | undefined;
    if (this.bulkAdmission) {
      const executionMode = payload.runId ? await this.bulkExecutionMode(runId) : undefined;
      const admission = await this.bulkAdmission.admit({
        organizationId: payload.organizationId,
        runId,
        workKind: payload.runId ? 'ADMIN_RECONSTRUCTION' : 'AUTOMATIC',
        scheduledFor: payload.scheduledFor,
        ...(executionMode ? { executionMode } : {}),
      });
      if (!admission.admitted) {
        await this.enqueueDeferredOrganizationScan(payload, admission.availableAt ? Date.parse(admission.availableAt) - Date.now() : 60_000);
        return 'WAITING';
      }
      bulkLease = admission.lease;
      if (bulkLease) await this.bulkAdmission.assertLease(bulkLease);
    }
    const checkpointId = deterministicUuid(`${runId}|${payload.organizationId}`);
    this.schedulerLog('PREVENTION_CHECKPOINT_STARTED', checkpointId, {
      jobType: payload.parentJobType,
    });
    await this.dataSource.query(
      `INSERT IGNORE INTO prevention_scheduler_checkpoints
        (id,runId,organizationId,reportCursor,status,processedReports)
       VALUES (?,?,?,NULL,'PENDING',0)`,
      [checkpointId, runId, payload.organizationId],
    );
    const checkpoint = await this.dataSource.transaction(async (manager) => {
      const [row]: Array<{ reportCursor: string | null; status: string; scanComplete: number; scopeMissionIds: unknown }> = await manager.query(
        `SELECT reportCursor,status,scanComplete,scopeMissionIds FROM prevention_scheduler_checkpoints
         WHERE id=? AND organizationId=? FOR UPDATE`, [checkpointId, payload.organizationId]);
      if (!row || row.status === 'COMPLETED' || row.scanComplete) return null;
      const claim: any = await manager.query(
        `UPDATE prevention_scheduler_checkpoints SET status='PROCESSING',lockedAt=UTC_TIMESTAMP(6),
          lockedBy=?,attempts=attempts+1,lastError=NULL WHERE id=? AND organizationId=? AND
          scanComplete=0 AND availableAt<=UTC_TIMESTAMP(6) AND
          (status='PENDING' OR lockedAt<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE))`,
        [this.instanceId, checkpointId, payload.organizationId]);
      return claim?.affectedRows ? row : null;
    });
    if (!checkpoint) {
      if (bulkLease) {
        const [state]: Array<{ status: string; scanComplete: number; pendingJobs: number; lockedBy: string | null }> = await this.dataSource.query(
          `SELECT status,scanComplete,pendingJobs,lockedBy
           FROM prevention_scheduler_checkpoints WHERE id=? AND organizationId=? LIMIT 1`,
          [checkpointId, payload.organizationId],
        );
        // A concurrent PROCESSING claimant may still be protecting audit
        // tasks with this lease. Release only terminal/empty checkpoints.
        const safeToRelease = !state || state.status === 'COMPLETED' || state.status === 'FAILED' ||
          (Boolean(state.scanComplete) && Number(state.pendingJobs) === 0 && !state.lockedBy);
        if (safeToRelease) await this.bulkAdmission!.release(bulkLease);
      }
      this.schedulerLog('PREVENTION_CHECKPOINT_SKIPPED', checkpointId, {
        jobType: payload.parentJobType,
      });
      return 'SKIPPED';
    }
    let checkpointAdvanced = false;
    try {
    const rawScope = checkpoint.scopeMissionIds;
    const parsedScope: unknown = rawScope === null || rawScope === undefined ? null
      : typeof rawScope === 'string' ? JSON.parse(rawScope) : rawScope;
    if (parsedScope !== null && (!Array.isArray(parsedScope) || parsedScope.length > 10000 ||
        parsedScope.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))) {
      throw new Error('Invalid durable prevention rebuild scope');
    }
    const scopedMissionIds = parsedScope as string[] | null;
    if (bulkLease) await this.bulkAdmission!.assertLease(bulkLease);
    if (scopedMissionIds === null && !checkpoint.reportCursor &&
        (payload.parentJobType === PREVENTION_CONSOLIDATION_JOB ||
         payload.parentJobType === PREVENTION_WEEKLY_AUDIT_JOB ||
         payload.parentJobType === PREVENTION_MONTHLY_AUDIT_JOB)) {
      const referenceDate = payload.scheduledFor.slice(0, 10);
      const repairedPartitions = await this.extraction?.reconcileDeletedReportEffects(
        payload.organizationId,
        referenceDate,
      ) ?? 0;
      await this.budget?.reconcileOrphanedReportSources(payload.organizationId);
      if (repairedPartitions > 0) {
        await this.enqueueStatistics(payload.organizationId, payload.scheduledFor, `${checkpointId}|delete-repair`);
      }
    }
    const fullRebuild = payload.parentJobType !== PREVENTION_DIFFERENTIAL_JOB;
    const reports: Array<{ id: string; updatedAt: Date }> = await this.dataSource.query(
      `SELECT r.id,r.updatedAt FROM reports r
       INNER JOIN visits v ON v.organizationId=r.organizationId AND v.id=r.visitId
       LEFT JOIN prevention_report_snapshots s ON s.organizationId=r.organizationId AND s.reportId=r.id
       WHERE r.organizationId=? AND r.id>?
         ${scopedMissionIds === null ? '' : scopedMissionIds.length ? 'AND v.missionId IN (?)' : 'AND 1=0'}
         ${fullRebuild ? '' : 'AND (s.id IS NULL OR s.sourceUpdatedAt<r.updatedAt OR s.indexedAt<v.updatedAt)'}
       ORDER BY r.id LIMIT ?`,
      [payload.organizationId, checkpoint.reportCursor ?? '', ...(scopedMissionIds?.length ? [scopedMissionIds] : []), this.settings.reportBatchSize + 1],
    );
    const page = reports.slice(0, this.settings.reportBatchSize);
    const cursor = page.at(-1)?.id ?? checkpoint.reportCursor;
    const hasMore = reports.length > page.length;
    if (!hasMore) await this.backfillActivationGroups(runId, payload.organizationId);
    const tasks: Array<{ id: string; reportId: string; aggregateVersion: string }> = [];
    await this.dataSource.transaction(async (manager) => {
      const [current]: Array<{ reportCursor: string | null; status: string; scanComplete: number; lockedBy: string | null }> = await manager.query(
        `SELECT reportCursor,status,scanComplete,lockedBy FROM prevention_scheduler_checkpoints
         WHERE id=? AND organizationId=? FOR UPDATE`, [checkpointId, payload.organizationId]);
      if (!current || current.status !== 'PROCESSING' || current.scanComplete || current.lockedBy !== this.instanceId ||
          current.reportCursor !== checkpoint.reportCursor) {
        throw new Error('Prevention checkpoint lease was lost');
      }
      let insertedTasks = 0;
      for (const report of page) {
        const eventId = deterministicUuid(`${payload.parentJobType}|${payload.scheduledFor}|${payload.organizationId}|${report.id}`);
        const result: any = await manager.query(
          `INSERT IGNORE INTO prevention_scheduler_tasks
            (id,checkpointId,organizationId,reportId,status,attempts)
           VALUES (?,?,?,?,'PENDING',0)`,
          [eventId, checkpointId, payload.organizationId, report.id],
        );
        insertedTasks += Number(result?.affectedRows ?? 0);
        tasks.push({ id: eventId, reportId: report.id, aggregateVersion: new Date(report.updatedAt).toISOString() });
      }
      const advanced: any = await manager.query(
        `UPDATE prevention_scheduler_checkpoints SET status=?,reportCursor=?,processedReports=processedReports+?,
          pendingJobs=pendingJobs+?,scanComplete=?,lockedAt=NULL,lockedBy=NULL
         WHERE id=? AND organizationId=? AND lockedBy=? AND scanComplete=0`,
        [hasMore ? 'PENDING' : 'PROCESSING', cursor, page.length, insertedTasks,
          hasMore ? 0 : 1, checkpointId, payload.organizationId, this.instanceId],
      );
      if (!advanced?.affectedRows) throw new Error('Prevention checkpoint lease was lost');
    });
    checkpointAdvanced = true;
    for (const task of tasks) {
      await this.enqueueAuditTask({ id: task.id, checkpointId,
        organizationId: payload.organizationId, reportId: task.reportId,
        aggregateVersion: task.aggregateVersion,
        scheduledFor: payload.scheduledFor });
    }
    if (hasMore) await this.enqueueOrganizationScan(
      payload.parentJobType, payload.organizationId, payload.scheduledFor, cursor, payload.runId,
    );
    if (!hasMore) await this.completeCheckpointIfTasksDone(checkpointId, payload.organizationId);
    this.schedulerLog('PREVENTION_CHECKPOINT_ADVANCED', checkpointId, {
      jobType: payload.parentJobType,
      result: hasMore ? 'CONTINUED' : 'SCAN_COMPLETED',
      processedReports: page.length,
      enqueuedTasks: tasks.length,
      durationMs: Date.now() - startedAt,
    });
    return hasMore ? 'CONTINUED' : 'COMPLETED';
    } catch (error: any) {
      if (!checkpointAdvanced) {
        await this.dataSource.query(
          `UPDATE prevention_scheduler_checkpoints SET status='PENDING',availableAt=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 MINUTE),
            lockedAt=NULL,lockedBy=NULL,lastError=? WHERE id=? AND organizationId=? AND lockedBy=?`,
          [String(error?.code ?? error?.name ?? 'UNKNOWN').slice(0, 500), checkpointId,
            payload.organizationId, this.instanceId],
        );
      }
      this.schedulerLog('PREVENTION_CHECKPOINT_RETRY_SCHEDULED', checkpointId, {
        jobType: payload.parentJobType,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  private async backfillActivationGroups(runId: string, organizationId: string): Promise<void> {
    const [run]: Array<{ workKind: string }> = await this.dataSource.query(
      `SELECT r.workKind FROM prevention_scheduler_runs r
       JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?
       WHERE r.id=? AND r.jobType=? LIMIT 1`,
      [organizationId, runId, PREVENTION_DIFFERENTIAL_JOB],
    );
    if (run?.workKind !== 'ACTIVATION') return;
    if (!this.groupProcessing) throw new Error('Prevention group processing unavailable for activation');
    let cursor: string | undefined;
    // Replaying this scan after a crash is safe: group staging is idempotent.
    // Keep one worker attempt bounded, including for unexpectedly large tenants.
    for (let page = 0; page < 1000; page += 1) {
      const result = await this.groupProcessing.backfillOrganization(organizationId, 100, cursor, this.groupQueue ?? undefined);
      if (result.visits < 100) return;
      if (!result.nextCursor || result.nextCursor === cursor) throw new Error('Prevention activation group backfill did not advance');
      cursor = result.nextCursor;
    }
    throw new Error('Prevention activation group backfill exceeded 100000 visits');
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
    await this.dataSource.transaction(async (manager) => {
      const result: any = await manager.query(
        `UPDATE prevention_scheduler_tasks SET status='COMPLETED',lastError=NULL
         WHERE id=? AND checkpointId=? AND organizationId=? AND status='PENDING'`,
        [taskId, checkpointId, organizationId],
      );
      if (result?.affectedRows) {
        await manager.query(
          `UPDATE prevention_scheduler_checkpoints SET pendingJobs=GREATEST(pendingJobs-1,0)
           WHERE id=? AND organizationId=?`, [checkpointId, organizationId],
        );
      }
    });
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
          pendingJobs=GREATEST(pendingJobs-1,0),lastError='AUDIT_JOB_FAILED',lockedAt=NULL,lockedBy=NULL
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
    if (this.bulkAdmission) {
      const [failedRun]: Array<{ runId: string }> = await this.dataSource.query(
        `SELECT runId FROM prevention_scheduler_checkpoints WHERE id=? AND organizationId=? LIMIT 1`,
        [checkpointId, organizationId],
      );
      if (failedRun) await this.releaseBulkLease(failedRun.runId, organizationId);
    }
    this.schedulerLog('PREVENTION_AUDIT_TERMINAL_FAILURE', checkpointId, {
      jobType: PREVENTION_AUDIT_REPORT_JOB,
      taskCorrelationId: createHash('sha256').update(taskId).digest('hex').slice(0, 16),
    });
  }

  async isManualRebuildTask(checkpointId: string, organizationId: string): Promise<boolean> {
    const [run]: Array<{ jobType: string }> = await this.dataSource.query(
      `SELECT r.jobType FROM prevention_scheduler_checkpoints c
       JOIN prevention_scheduler_runs r ON r.id=c.runId
       WHERE c.id=? AND c.organizationId=? LIMIT 1`,
      [checkpointId, organizationId],
    );
    return run?.jobType === 'MANUAL_REBUILD';
  }

  async bulkRunId(checkpointId: string, organizationId: string): Promise<string | null> {
    const [run]: Array<{ id: string }> = await this.dataSource.query(
      `SELECT r.id FROM prevention_scheduler_checkpoints c
       JOIN prevention_scheduler_runs r ON r.id=c.runId
       WHERE c.id=? AND c.organizationId=? LIMIT 1`, [checkpointId, organizationId],
    );
    return run?.id ?? null;
  }

  async bulkExecutionMode(runId: string): Promise<'IMMEDIATE' | 'SCHEDULED'> {
    const [run]: Array<{ executionMode: 'IMMEDIATE' | 'SCHEDULED' }> = await this.dataSource.query(
      `SELECT executionMode FROM prevention_scheduler_runs WHERE id=? LIMIT 1`, [runId],
    );
    return run?.executionMode ?? 'IMMEDIATE';
  }

  private async completeCheckpointIfTasksDone(checkpointId: string, organizationId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE prevention_scheduler_checkpoints c SET status='COMPLETED',pendingJobs=0,lockedAt=NULL,lockedBy=NULL
       WHERE c.id=? AND c.organizationId=? AND c.scanComplete=1 AND NOT EXISTS (
         SELECT 1 FROM prevention_scheduler_tasks t WHERE t.checkpointId=c.id AND t.status<>'COMPLETED')`,
      [checkpointId, organizationId],
    );
    const [row]: Array<{ runId: string }> = await this.dataSource.query(
      'SELECT runId FROM prevention_scheduler_checkpoints WHERE id=? AND organizationId=? AND status=\'COMPLETED\'',
      [checkpointId, organizationId],
    );
    if (row) await this.finalizeRunIfComplete(row.runId);
    if (row) await this.releaseBulkLease(row.runId, organizationId);
  }

  private async releaseBulkLease(runId: string, organizationId: string): Promise<void> {
    if (!this.bulkAdmission) return;
    const [lease]: Array<any> = await this.dataSource.query(
      `SELECT organizationId,runId,workKind,leaseToken FROM prevention_scheduler_bulk_admission
       WHERE id=1 AND organizationId=? AND runId=? AND leaseToken IS NOT NULL`, [organizationId, runId],
    );
    if (lease?.leaseToken) await this.bulkAdmission.release({
      organizationId, runId, workKind: lease.workKind, leaseToken: lease.leaseToken,
    });
  }

  private async retireDisabledAutomaticCheckpoints(): Promise<void> {
    const automaticJobs = [PREVENTION_DIFFERENTIAL_JOB, PREVENTION_CONSOLIDATION_JOB,
      PREVENTION_WEEKLY_AUDIT_JOB, PREVENTION_MONTHLY_AUDIT_JOB];
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE prevention_scheduler_tasks t
         JOIN prevention_scheduler_checkpoints c ON c.id=t.checkpointId AND c.organizationId=t.organizationId
         JOIN prevention_scheduler_runs r ON r.id=c.runId
         JOIN organizations o ON o.id=c.organizationId
         SET t.status='COMPLETED',t.lastError='ORGANIZATION_DISABLED'
         WHERE r.jobType IN (?,?,?,?) AND c.status IN ('PENDING','PROCESSING')
           AND (o.isActive=0 OR o.preventionEnabled=0) AND t.status='PENDING'`, automaticJobs,
      );
      await manager.query(
        `UPDATE prevention_scheduler_checkpoints c
         JOIN prevention_scheduler_runs r ON r.id=c.runId
         JOIN organizations o ON o.id=c.organizationId
         SET c.status='COMPLETED',c.scanComplete=1,c.pendingJobs=0,
             c.lastError='ORGANIZATION_DISABLED',c.lockedAt=NULL,c.lockedBy=NULL
         WHERE r.jobType IN (?,?,?,?) AND c.status IN ('PENDING','PROCESSING')
           AND (o.isActive=0 OR o.preventionEnabled=0)`, automaticJobs,
      );
      await manager.query(
        `UPDATE prevention_scheduler_runs r
         SET r.status='COMPLETED',r.lockedAt=NULL,r.lockedBy=NULL
         WHERE r.jobType IN (?,?,?,?) AND r.status='PROCESSING' AND r.dispatchComplete=1
           AND NOT EXISTS (SELECT 1 FROM prevention_scheduler_checkpoints c
             WHERE c.runId=r.id AND c.status<>'COMPLETED')`, automaticJobs,
      );
    });
  }

  private async recoverIncompleteCheckpoints(cursor: string | null): Promise<string | null> {
    if (!this.queue) return null;
    if (cursor === null) await this.retireDisabledAutomaticCheckpoints();
    const rows: Array<any> = await this.dataSource.query(
      `SELECT c.id,c.runId,c.organizationId,c.reportCursor,r.jobType,
         DATE_FORMAT(r.scheduledFor,'%Y-%m-%d %H:%i:%s.%f') AS scheduledForUtc
       FROM prevention_scheduler_checkpoints c JOIN prevention_scheduler_runs r ON r.id=c.runId
       JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1
       WHERE c.id>? AND (r.status IN ('PENDING','PROCESSING','SCHEDULED') OR
         (r.status='COMPLETED' AND r.jobType IN (?,?,?,?)))
         AND c.scanComplete=0 AND c.availableAt<=UTC_TIMESTAMP(6) AND (c.status='PENDING' OR (c.status='PROCESSING' AND
         c.lockedAt<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE)))
       ORDER BY c.id LIMIT 101`, [cursor ?? "", PREVENTION_DIFFERENTIAL_JOB,
        PREVENTION_CONSOLIDATION_JOB, PREVENTION_WEEKLY_AUDIT_JOB, PREVENTION_MONTHLY_AUDIT_JOB],
    );
    for (const row of rows.slice(0, 100)) {
      const manual = row.jobType === "MANUAL_REBUILD";
      await this.enqueueOrganizationScan(
        manual ? PREVENTION_CONSOLIDATION_JOB : row.jobType, row.organizationId,
        mysqlUtcIso(row.scheduledForUtc), row.reportCursor, manual ? row.runId : undefined,
      );
    }
    return rows.length > 100 ? rows[99].id : null;
  }

  private async recoverIncompleteRuns(cursor: string | null): Promise<string | null> {
    if (!this.queue) return null;
    const rows: Array<any> = await this.dataSource.query(
      `SELECT id,jobType,scheduledFor,organizationCursor
       FROM prevention_scheduler_runs
       WHERE id>? AND dispatchComplete=0 AND availableAt<=UTC_TIMESTAMP(6)
         AND jobType IN (?,?,?,?)
         AND (status='PENDING' OR (status='PROCESSING' AND
           lockedAt<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE)))
       ORDER BY id LIMIT 101`,
      [cursor ?? '', PREVENTION_DIFFERENTIAL_JOB, PREVENTION_CONSOLIDATION_JOB,
        PREVENTION_WEEKLY_AUDIT_JOB, PREVENTION_MONTHLY_AUDIT_JOB],
    );
    for (const row of rows.slice(0, 100)) {
      const recovered = await this.dataSource.transaction(async (manager) => {
        const [current]: Array<any> = await manager.query(
          `SELECT id,jobType,organizationCursor,status,dispatchComplete,lockedAt,availableAt,
             DATE_FORMAT(scheduledFor,'%Y-%m-%d %H:%i:%s.%f') AS scheduledForUtc
           FROM prevention_scheduler_runs WHERE id=? FOR UPDATE`, [row.id],
        );
        if (!current || Number(current.dispatchComplete) === 1 || Number.isNaN(new Date(current.availableAt).getTime()) ||
            new Date(current.availableAt).getTime() > Date.now() ||
            ![PREVENTION_DIFFERENTIAL_JOB, PREVENTION_CONSOLIDATION_JOB,
              PREVENTION_WEEKLY_AUDIT_JOB, PREVENTION_MONTHLY_AUDIT_JOB].includes(current.jobType) ||
            (current.status !== 'PENDING' &&
              !(current.status === 'PROCESSING' && current.lockedAt &&
                new Date(current.lockedAt).getTime() < Date.now() - 15 * 60_000))) {
          return null;
        }
        if (current.status === 'PROCESSING') {
          await manager.query(
            `UPDATE prevention_scheduler_runs SET status='PENDING',lockedAt=NULL,lockedBy=NULL,lastError=NULL
             WHERE id=? AND status='PROCESSING'`, [current.id],
          );
        }
        return {
          jobType: current.jobType as PreventionScheduledJobName,
          scheduledFor: mysqlUtcIso(current.scheduledForUtc),
          cursor: current.organizationCursor as string | null,
        };
      });
      if (recovered) await this.enqueueContinuation(recovered.jobType, recovered.scheduledFor, recovered.cursor);
    }
    return rows.length > 100 ? rows[99].id : null;
  }

  private async recoverIncompleteTasks(cursor: string | null): Promise<string | null> {
    if (!this.queue) return null;
    const tasks: Array<any> = await this.dataSource.query(
      `SELECT t.id,t.checkpointId,t.organizationId,t.reportId,rep.updatedAt,
         DATE_FORMAT(r.scheduledFor,'%Y-%m-%d %H:%i:%s.%f') AS scheduledForUtc
       FROM prevention_scheduler_tasks t
       JOIN prevention_scheduler_checkpoints c ON c.id=t.checkpointId
       JOIN prevention_scheduler_runs r ON r.id=c.runId
       JOIN organizations o ON o.id=t.organizationId AND o.isActive=1 AND o.preventionEnabled=1
       LEFT JOIN reports rep ON rep.id=t.reportId AND rep.organizationId=t.organizationId
       WHERE t.status='PENDING' AND t.id>? AND (r.status IN ('PENDING','PROCESSING','SCHEDULED') OR
         (r.status='COMPLETED' AND r.jobType IN (?,?,?,?)))
         AND c.status<>'FAILED' AND c.availableAt<=UTC_TIMESTAMP(6)
       ORDER BY t.id LIMIT 101`, [cursor ?? '', PREVENTION_DIFFERENTIAL_JOB,
        PREVENTION_CONSOLIDATION_JOB, PREVENTION_WEEKLY_AUDIT_JOB, PREVENTION_MONTHLY_AUDIT_JOB],
    );
    for (const task of tasks.slice(0, 100)) {
      if (!task.updatedAt) {
        await this.recordAuditSuccess(task.id, task.checkpointId, task.organizationId);
        continue;
      }
      await this.enqueueAuditTask({ id: task.id, checkpointId: task.checkpointId,
        organizationId: task.organizationId, reportId: task.reportId,
        aggregateVersion: new Date(task.updatedAt).toISOString(),
        scheduledFor: mysqlUtcIso(task.scheduledForUtc) });
    }
    return tasks.length > 100 ? tasks[99].id : null;
  }

  private async recoverAndContinue(
    recoveryType: PreventionRecoveryPayload['recoveryType'], cursor: string | null,
    scheduledFor: string,
  ): Promise<void> {
    const nextCursor = recoveryType === 'RUN'
      ? await this.recoverIncompleteRuns(cursor)
      : recoveryType === 'CHECKPOINT'
        ? await this.recoverIncompleteCheckpoints(cursor)
        : await this.recoverIncompleteTasks(cursor);
    if (!nextCursor) return;
    this.schedulerLog('PREVENTION_SCHEDULER_RECOVERY_CONTINUED', nextCursor, {
      recoveryType,
    });
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

  private async enqueueDeferredOrganizationScan(
    payload: PreventionOrganizationScanPayload,
    delayMs: number,
  ): Promise<void> {
    const digest = createHash('sha256').update(
      `${payload.parentJobType}|${payload.scheduledFor}|${payload.organizationId}|${payload.reportCursor ?? 'FIRST'}|${payload.runId ?? 'SCHEDULED'}|${Math.floor(Date.now() / 60_000)}`,
    ).digest('hex');
    await this.queue!.add(PREVENTION_ORGANIZATION_SCAN_JOB, payload, {
      jobId: `prevention-scheduler-org-retry-${digest}`,
      delay: Math.max(1_000, Math.min(delayMs, 86_400_000)), attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
  }

  private async enqueueDeferredManualRebuild(
    payload: PreventionManualRebuildPayload,
    delayMs: number,
  ): Promise<void> {
    const digest = createHash('sha256').update(
      `${payload.organizationId}|${payload.runId}|${Math.floor(Date.now() / 60_000)}`,
    ).digest('hex');
    await this.queue!.add(PREVENTION_MANUAL_REBUILD_JOB, payload, {
      jobId: `prevention-manual-rebuild-retry-${digest}`,
      delay: Math.max(1_000, Math.min(delayMs, 86_400_000)), attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
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
      this.logger.log({
        message: 'Prevention BullMQ cleanup completed',
        context: PreventionSchedulerService.name,
        event: 'PREVENTION_QUEUE_CLEANUP_COMPLETED',
        removedJobs: completed.length + failed.length,
      } as any);
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
