import {
  Injectable,
  Logger,
  Optional,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { createHash } from 'crypto';
import {
  PREVENTION_DELETE_JOB,
  PREVENTION_QUEUE_NAME,
  PREVENTION_UPSERT_JOB,
  PreventionReportEventPayload,
} from '../outbox/prevention-outbox.types';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PreventionExtractionService } from '../extraction/prevention-extraction.service';
import { PreventionSourceValidationError } from '../extraction/prevention-canonicalizer';
import { PreventionStatisticsService } from '../statistics/prevention-statistics.service';
import {
  PREVENTION_STATISTICS_REFRESH_JOB,
  PreventionStatisticsRefreshPayload,
} from '../statistics/prevention-statistics.jobs';
import { PreventionSchedulerService } from '../scheduler/prevention-scheduler.service';
import { PREVENTION_AUDIT_REPORT_JOB } from '../scheduler/prevention-scheduler.types';
import { PreventionBudgetService } from '../budget/prevention-budget.service';
import { PreventionActivationService } from '../prevention-activation.service';
import { PreventionGroupProcessingService, PREVENTION_GROUP_JOB, PREVENTION_RECOMMENDATION_JOB, PreventionGroupJobPayload } from './prevention-group-processing.service';
import { PreventionOnlyAiService } from '../ai/prevention-only-ai.service';
import { PREVENTION_BULK_QUEUE_NAME, PREVENTION_GROUP_QUEUE_NAME } from '../queue/prevention-queue.constants';
import { PreventionHyperAdminRecoveryService } from '../api/prevention-hyper-admin-recovery.service';
import { PREVENTION_HYPER_ADMIN_RECOVERY_JOB } from '../scheduler/prevention-scheduler.types';
import { PreventionBulkAdmissionService } from '../scheduler/prevention-bulk-admission.service';
import { PreventionBulkLease } from '../scheduler/prevention-bulk-admission.types';
import { isWithinPreventionBulkWindow, loadPreventionBulkConfiguration, nextPreventionBulkWindowStart } from '../scheduler/prevention-bulk.config';
import { preventionFailureDiagnostic } from './prevention-log-error';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYLOAD_KEYS = [
  'aggregateVersion',
  'eventId',
  'eventType',
  'occurredAt',
  'organizationId',
  'reportId',
];

export function validatePreventionReportPayload(
  jobName: string,
  value: unknown,
): PreventionReportEventPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnrecoverableError('Invalid prevention job payload');
  }
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).sort().join('|') !== PAYLOAD_KEYS.join('|')) {
    throw new UnrecoverableError('Invalid prevention job payload fields');
  }
  if (
    !UUID_PATTERN.test(String(payload.eventId)) ||
    !UUID_PATTERN.test(String(payload.organizationId)) ||
    !UUID_PATTERN.test(String(payload.reportId))
  ) {
    throw new UnrecoverableError('Invalid prevention job identifiers');
  }
  const expectedType = jobName === PREVENTION_UPSERT_JOB || jobName === PREVENTION_AUDIT_REPORT_JOB
    ? 'REPORT_UPSERTED'
    : jobName === PREVENTION_DELETE_JOB
      ? 'REPORT_DELETED'
      : null;
  if (!expectedType || payload.eventType !== expectedType) {
    throw new UnrecoverableError('Invalid prevention job type');
  }
  if (
    typeof payload.aggregateVersion !== 'string' ||
    !payload.aggregateVersion ||
    payload.aggregateVersion.length > 64 ||
    typeof payload.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(payload.occurredAt))
  ) {
    throw new UnrecoverableError('Invalid prevention job version');
  }
  return payload as unknown as PreventionReportEventPayload;
}

@Injectable()
export class PreventionReportConsumerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PreventionReportConsumerService.name);
  private worker: Worker | null = null;
  private bulkWorker: Worker | null = null;
  private groupWorker: Worker | null = null;
  private queue: Queue | null = null;
  private bulkQueue: Queue | null = null;
  private groupQueue: Queue | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly extraction: PreventionExtractionService,
    private readonly statistics: PreventionStatisticsService,
    private readonly scheduler: PreventionSchedulerService,
    @Optional() private readonly budget?: PreventionBudgetService,
    @Optional() private readonly activation?: PreventionActivationService,
    @Optional() private readonly groupProcessing?: PreventionGroupProcessingService,
    @Optional() private readonly preventionAi?: PreventionOnlyAiService,
    @Optional() private readonly bulkAdmission?: PreventionBulkAdmissionService,
    @Optional() private readonly hyperAdminRecovery?: PreventionHyperAdminRecoveryService,
  ) {}

  private recoveryNow(): Date { return new Date(); }

  onApplicationBootstrap(): void {
    if (this.config.get('PREVENTION_CONSUMER_ENABLED', 'true') === 'false') return;
    if (!this.groupProcessing || !this.preventionAi) throw new Error('Prevention recommendation worker dependencies are unavailable');
    const concurrency = Number(this.config.get('PREVENTION_WORKER_CONCURRENCY', 2));
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      throw new Error('PREVENTION_WORKER_CONCURRENCY must be an integer between 1 and 20');
    }
    const connection = createPreventionRedisOptions(this.config);
    this.queue = new Queue(PREVENTION_QUEUE_NAME, { connection });
    this.bulkQueue = new Queue(PREVENTION_BULK_QUEUE_NAME, { connection });
    this.groupQueue = new Queue(PREVENTION_GROUP_QUEUE_NAME, { connection });
    this.worker = new Worker(
      PREVENTION_QUEUE_NAME,
      (job) => job.name === PREVENTION_GROUP_JOB || job.name === PREVENTION_RECOMMENDATION_JOB
        ? Promise.reject(new UnrecoverableError('Prevention LLM groups require the dedicated queue'))
        : this.process(job),
      { connection, concurrency },
    );
    const bulkConcurrency = Number(this.config.get('PREVENTION_BULK_WORKER_CONCURRENCY', 1));
    if (!Number.isInteger(bulkConcurrency) || bulkConcurrency < 1 || bulkConcurrency > 3) {
      throw new Error('PREVENTION_BULK_WORKER_CONCURRENCY must be an integer between 1 and 3');
    }
    this.bulkWorker = new Worker(
      PREVENTION_BULK_QUEUE_NAME,
      (job) => this.processBulk(job),
      { connection, concurrency: bulkConcurrency },
    );
    // LLM photo work has its own queue and one execution slot. It cannot
    // occupy every analytical/scheduler slot in the main Prevention queue.
    this.groupWorker = new Worker(
      PREVENTION_GROUP_QUEUE_NAME,
      (job) => job.name === PREVENTION_GROUP_JOB || job.name === PREVENTION_RECOMMENDATION_JOB
        ? this.process(job)
        : Promise.reject(new UnrecoverableError('Unknown Prevention LLM queue job')),
      { connection, concurrency: 1 },
    );
    this.worker.on('active', (job) => {
      this.logger.log(this.jobLog('PREVENTION_JOB_STARTED', job));
    });
    this.worker.on('completed', (job) => {
      this.logger.log(this.jobLog('PREVENTION_JOB_COMPLETED', job));
    });
    this.worker.on('failed', (job) => {
      this.logger.warn(this.jobLog('PREVENTION_JOB_FAILED', job));
    });
    this.worker.on('error', () => this.logger.warn({
      message: 'Prevention consumer connection error',
      context: PreventionReportConsumerService.name,
      event: 'PREVENTION_CONSUMER_CONNECTION_ERROR',
    } as any));
    this.bulkWorker.on('active', (job) => this.logger.log(this.jobLog('PREVENTION_BULK_JOB_STARTED', job)));
    this.bulkWorker.on('completed', (job) => this.logger.log(this.jobLog('PREVENTION_BULK_JOB_COMPLETED', job)));
    this.bulkWorker.on('failed', (job) => this.logger.warn(this.jobLog('PREVENTION_BULK_JOB_FAILED', job)));
    this.bulkWorker.on('error', () => this.logger.warn({
      message: 'Prevention bulk consumer connection error',
      context: PreventionReportConsumerService.name,
      event: 'PREVENTION_BULK_CONSUMER_CONNECTION_ERROR',
    } as any));
    this.groupWorker.on('error', () => this.logger.warn({
      message: 'Prevention group consumer connection error',
      context: PreventionReportConsumerService.name,
      event: 'PREVENTION_GROUP_CONSUMER_CONNECTION_ERROR',
    } as any));
    this.groupWorker.on('active', (job) => this.logger.log(this.jobLog('PREVENTION_GROUP_JOB_STARTED', job)));
    this.groupWorker.on('completed', (job) => this.logger.log(this.jobLog('PREVENTION_GROUP_JOB_COMPLETED', job)));
    this.groupWorker.on('failed', (job) => this.logger.warn(this.jobLog('PREVENTION_GROUP_JOB_FAILED', job)));
  }

  private jobLog(event: string, job?: Job): Record<string, unknown> {
    const rawId = String(job?.id ?? 'unknown');
    const correlationId = createHash('sha256').update(rawId).digest('hex').slice(0, 16);
    const durationMs = job?.processedOn && job?.finishedOn
      ? Math.max(0, job.finishedOn - job.processedOn)
      : undefined;
    const data = job?.data && typeof job.data === 'object' ? job.data as Record<string, unknown> : {};
    const safeUuid = (value: unknown): string | undefined => typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
    const sourceGroupFingerprint = typeof data.sourceGroupId === 'string'
      ? createHash('sha256').update(data.sourceGroupId).digest('hex').slice(0, 16) : undefined;
    const configuredAttempts = Number(job?.opts?.attempts ?? 1);
    const maxAttempts = Number.isInteger(configuredAttempts) && configuredAttempts >= 1 && configuredAttempts <= 100
      ? configuredAttempts : 1;
    const attemptsMade = Number(job?.attemptsMade ?? 0);
    const safeAttemptsMade = Number.isInteger(attemptsMade) && attemptsMade >= 0 && attemptsMade <= 100
      ? attemptsMade : 0;
    return {
      message: event,
      context: PreventionReportConsumerService.name,
      event,
      correlationId,
      jobType: String(job?.name ?? 'unknown').slice(0, 80),
      attemptsMade: safeAttemptsMade,
      ...(event.endsWith('_FAILED') ? { maxAttempts, terminal: safeAttemptsMade >= maxAttempts } : {}),
      ...(safeUuid(data.organizationId) ? { organizationId: safeUuid(data.organizationId) } : {}),
      ...(safeUuid(data.recoveryId) ? { recoveryRunId: safeUuid(data.recoveryId) } : {}),
      ...(safeUuid(data.visitId) ? { visitId: safeUuid(data.visitId) } : {}),
      ...(sourceGroupFingerprint ? { sourceGroupFingerprint } : {}),
      ...(event.endsWith('_FAILED') ? preventionFailureDiagnostic(job?.failedReason) : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  }

  async onApplicationShutdown(): Promise<void> {
    const worker = this.worker;
    const bulkWorker = this.bulkWorker;
    const groupWorker = this.groupWorker;
    const queue = this.queue;
    const bulkQueue = this.bulkQueue;
    const groupQueue = this.groupQueue;
    this.worker = null;
    this.bulkWorker = null;
    this.groupWorker = null;
    this.queue = null;
    this.bulkQueue = null;
    this.groupQueue = null;
    if (worker) await worker.close();
    if (bulkWorker) await bulkWorker.close();
    if (groupWorker) await groupWorker.close();
    if (queue) await queue.close();
    if (bulkQueue) await bulkQueue.close();
    if (groupQueue) await groupQueue.close();
  }

  private async process(job: Job): Promise<string> {
    if (job.name === PREVENTION_GROUP_JOB) {
      if (!this.groupProcessing || !this.preventionAi) throw new Error('Prevention group processor is unavailable');
      const payload = this.validateGroupPayload(job.data);
      if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
      return this.groupProcessing.process(payload, this.preventionAi);
    }
    if (job.name === PREVENTION_RECOMMENDATION_JOB) {
      if (!this.groupProcessing || !this.preventionAi) throw new Error('Prevention recommendation processor is unavailable');
      if (job.data?.recoveryMode === 'SCHEDULED_MISSING_TYPES') {
        const now = this.recoveryNow();
        const configuration = loadPreventionBulkConfiguration(this.config);
        if (!isWithinPreventionBulkWindow(now, configuration)) {
          if (!this.groupQueue) throw new Error('Prevention recommendation queue is unavailable');
          const nextWindow = nextPreventionBulkWindowStart(now, configuration);
          const digest = createHash('sha256').update(JSON.stringify({ payload: job.data, nextWindow: nextWindow.toISOString() })).digest('hex');
          await this.groupQueue.add(PREVENTION_RECOMMENDATION_JOB, job.data, {
            jobId: `prevention-recommendation-recovery-${digest}`,
            delay: Math.max(1_000, nextWindow.getTime() - now.getTime()),
            attempts: 5, backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: true, removeOnFail: true,
          });
          return 'DEFERRED';
        }
      }
      return this.groupProcessing.processEditedRecommendations(job.data, this.preventionAi);
    }
    if (this.scheduler.handles(job.name)) return this.scheduler.process(job);
    if (job.name.startsWith('prevention.budget.')) {
      if (!this.budget) throw new Error('Prevention budget service is unavailable');
      return this.budget.process(job);
    }
    if (job.name === PREVENTION_STATISTICS_REFRESH_JOB) {
      const payload = this.validateStatisticsPayload(job.data);
      if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
      return String(await this.statistics.refreshOrganization(
        payload.organizationId,
        payload.referenceDate,
      ));
    }
    const checkpointId = job.name === PREVENTION_AUDIT_REPORT_JOB
      ? String((job.data as any)?.checkpointId ?? '') : null;
    const reportData = checkpointId
      ? Object.fromEntries(Object.entries(job.data).filter(([key]) => key !== 'checkpointId'))
      : job.data;
    if (job.name === PREVENTION_AUDIT_REPORT_JOB &&
        (!UUID_PATTERN.test(checkpointId!) || Object.keys(job.data).sort().join('|') !==
          'aggregateVersion|checkpointId|eventId|eventType|occurredAt|organizationId|reportId')) {
      throw new UnrecoverableError('Invalid prevention audit payload');
    }
    const payload = validatePreventionReportPayload(job.name, reportData);
    if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
    let bulkLease: PreventionBulkLease | undefined;
    if (checkpointId && this.bulkAdmission && typeof (this.scheduler as any).bulkRunId === 'function') {
      const runId = await this.scheduler.bulkRunId(checkpointId, payload.organizationId);
      if (runId) {
        const executionMode = await this.scheduler.bulkExecutionMode(runId);
        const admission = await this.bulkAdmission.admit({
          organizationId: payload.organizationId, runId,
          workKind: await this.scheduler.isManualRebuildTask(checkpointId, payload.organizationId)
            ? 'ADMIN_RECONSTRUCTION' : 'AUTOMATIC',
          scheduledFor: payload.occurredAt,
          executionMode,
        });
        if (!admission.admitted || !admission.lease) throw new Error(`Prevention bulk work waiting: ${admission.reason}`);
        bulkLease = admission.lease;
        await this.bulkAdmission.assertLease(bulkLease);
      }
    }
    let leaseHeartbeat: NodeJS.Timeout | null = null;
    try {
      if (bulkLease) await this.bulkAdmission!.assertLease(bulkLease);
      if (bulkLease) {
        const intervalMs = Math.max(1_000, Math.floor(this.bulkAdmission!.settings.leaseSeconds * 500));
        leaseHeartbeat = setInterval(() => {
          void this.bulkAdmission!.renew(bulkLease!).catch(() => undefined);
        }, intervalMs);
        leaseHeartbeat.unref();
      }
      let result: string;
      const referenceDate = payload.occurredAt.slice(0, 10);
      if (payload.eventType === 'REPORT_DELETED') {
        result = await this.extraction.deleteReport(
          payload.organizationId, payload.reportId, referenceDate,
        );
      } else {
        const forceRebuild = checkpointId
          ? await this.scheduler.isManualRebuildTask(checkpointId, payload.organizationId)
          : false;
        if (this.groupProcessing && this.groupQueue) {
          await this.groupProcessing.enqueueEditedRecommendationsForReport(payload.organizationId, payload.reportId,
            this.groupQueue, payload.eventId, Boolean(checkpointId) && !forceRebuild);
        }
        result = await this.extraction.indexReport(
          payload.organizationId, payload.reportId, referenceDate,
          forceRebuild,
        );
      }
      // Scheduled rereads may inspect every report, but unchanged analytical
      // data must not fan out into statistics, score or budget recalculation.
      if (result === 'INDEXED' || result === 'DELETED') {
        if (job.name === PREVENTION_AUDIT_REPORT_JOB) {
          await this.statistics.refreshOrganization(payload.organizationId, referenceDate);
        } else await this.enqueueStatisticsRefresh({
          organizationId: payload.organizationId,
          referenceDate,
          triggerEventId: payload.eventId,
        });
        if (this.budget) {
          try {
            if (payload.eventType === 'REPORT_DELETED') {
              // Consume legacy intents and independently discover surviving
              // budget source links after the SPS report has been deleted.
              await this.budget.processDeletionReconciliation(
                payload.eventId, payload.organizationId, payload.reportId,
              );
              await this.budget.reconcileOrphanedReportSources(payload.organizationId, payload.reportId);
            } else {
              await this.budget.enqueueReconcileForReport(payload.organizationId, payload.reportId, payload.aggregateVersion);
            }
          } catch (error) {
            this.logger.warn({
              message: 'Prevention budget reconciliation enqueue failed',
              context: PreventionReportConsumerService.name,
              event: 'PREVENTION_BUDGET_RECONCILIATION_ENQUEUE_FAILED',
              errorCode: typeof (error as any)?.code === 'string'
                ? String((error as any).code).slice(0, 64)
                : 'UNKNOWN',
            } as any);
            throw error;
          }
        }
      }
      if (checkpointId) await this.scheduler.recordAuditSuccess(
        payload.eventId, checkpointId, payload.organizationId,
      );
      return result;
    } catch (error) {
      if (checkpointId && job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1)) {
        await this.scheduler.recordAuditTerminalFailure(
          payload.eventId, checkpointId, payload.organizationId,
        );
      }
      if (error instanceof PreventionSourceValidationError) {
        throw new UnrecoverableError('Invalid prevention analysis source');
      }
      throw error;
    } finally {
      if (leaseHeartbeat) clearInterval(leaseHeartbeat);
    }
  }

  private async processBulk(job: Job): Promise<string> {
    if (job.name === PREVENTION_HYPER_ADMIN_RECOVERY_JOB) {
      if (!this.hyperAdminRecovery) throw new Error('Hyper Admin recovery service is unavailable');
      return this.hyperAdminRecovery.process(job);
    }
    if (this.scheduler.handles(job.name) || job.name === PREVENTION_AUDIT_REPORT_JOB ||
        job.name === PREVENTION_STATISTICS_REFRESH_JOB || job.name.startsWith('prevention.budget.')) {
      return this.process(job);
    }
    throw new UnrecoverableError('Unknown Prevention bulk queue job');
  }

  private validateGroupPayload(value: unknown): PreventionGroupJobPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnrecoverableError('Invalid Prevention group payload');
    const payload = value as Record<string, unknown>;
    if (Object.keys(payload).sort().join('|') !== 'organizationId|sourceGroupId|sourceHash|visitId' ||
      typeof payload.organizationId !== 'string' || !UUID_PATTERN.test(payload.organizationId) ||
      typeof payload.visitId !== 'string' || !UUID_PATTERN.test(payload.visitId) ||
      typeof payload.sourceGroupId !== 'string' || !payload.sourceGroupId || payload.sourceGroupId.length > 100 ||
      typeof payload.sourceHash !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.sourceHash)) {
      throw new UnrecoverableError('Invalid Prevention group payload fields');
    }
    return payload as unknown as PreventionGroupJobPayload;
  }

  private validateStatisticsPayload(value: unknown): PreventionStatisticsRefreshPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UnrecoverableError('Invalid prevention statistics payload');
    }
    const payload = value as Record<string, unknown>;
    if (Object.keys(payload).sort().join('|') !==
        ['organizationId', 'referenceDate', 'triggerEventId'].join('|') ||
        !UUID_PATTERN.test(String(payload.organizationId)) ||
        !UUID_PATTERN.test(String(payload.triggerEventId)) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.referenceDate))) {
      throw new UnrecoverableError('Invalid prevention statistics payload fields');
    }
    return payload as unknown as PreventionStatisticsRefreshPayload;
  }

  private async enqueueStatisticsRefresh(payload: PreventionStatisticsRefreshPayload): Promise<void> {
    if (!this.queue) throw new Error('Prevention queue is unavailable');
    const jobId = `prevention-statistics-${createHash('sha256')
      .update(`${payload.organizationId}|${payload.triggerEventId}`)
      .digest('hex')}`;
    await this.queue.add(PREVENTION_STATISTICS_REFRESH_JOB, payload, {
      jobId, attempts: 4, backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 1000, removeOnFail: 1000,
    });
  }
}
