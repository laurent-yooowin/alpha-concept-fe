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
  private queue: Queue | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly extraction: PreventionExtractionService,
    private readonly statistics: PreventionStatisticsService,
    private readonly scheduler: PreventionSchedulerService,
    @Optional() private readonly budget?: PreventionBudgetService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('PREVENTION_CONSUMER_ENABLED', 'true') === 'false') return;
    const concurrency = Number(this.config.get('PREVENTION_WORKER_CONCURRENCY', 2));
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      throw new Error('PREVENTION_WORKER_CONCURRENCY must be an integer between 1 and 20');
    }
    const connection = createPreventionRedisOptions(this.config);
    this.queue = new Queue(PREVENTION_QUEUE_NAME, { connection });
    this.worker = new Worker(
      PREVENTION_QUEUE_NAME,
      (job) => this.process(job),
      { connection, concurrency },
    );
    this.worker.on('failed', (job) => {
      this.logger.warn(`Prevention job failed id=${job?.id ?? 'unknown'} name=${job?.name ?? 'unknown'}`);
    });
    this.worker.on('error', () => this.logger.warn('Prevention consumer connection error'));
  }

  async onApplicationShutdown(): Promise<void> {
    const worker = this.worker;
    const queue = this.queue;
    this.worker = null;
    this.queue = null;
    if (worker) await worker.close();
    if (queue) await queue.close();
  }

  private async process(job: Job): Promise<string> {
    if (this.scheduler.handles(job.name)) return this.scheduler.process(job);
    if (job.name.startsWith('prevention.budget.')) {
      if (!this.budget) throw new Error('Prevention budget service is unavailable');
      return this.budget.process(job);
    }
    if (job.name === PREVENTION_STATISTICS_REFRESH_JOB) {
      const payload = this.validateStatisticsPayload(job.data);
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
    try {
      let result: string;
      const referenceDate = payload.occurredAt.slice(0, 10);
      if (payload.eventType === 'REPORT_DELETED') {
        result = await this.extraction.deleteReport(
          payload.organizationId, payload.reportId, referenceDate,
        );
      } else {
        result = await this.extraction.indexReport(
          payload.organizationId, payload.reportId, referenceDate,
          job.name === PREVENTION_AUDIT_REPORT_JOB,
        );
      }
      if (result !== 'MISSING') {
        if (job.name === PREVENTION_AUDIT_REPORT_JOB) {
          await this.statistics.refreshOrganization(payload.organizationId, referenceDate);
        } else await this.enqueueStatisticsRefresh({
          organizationId: payload.organizationId,
          referenceDate,
          triggerEventId: payload.eventId,
        });
        if (this.budget) {
          try {
            await this.budget.enqueueReconcileForReport(payload.organizationId, payload.reportId, payload.aggregateVersion);
          } catch (error) {
            this.logger.warn(`Prevention budget reconciliation enqueue failed: ${String((error as any)?.code ?? (error as any)?.message ?? 'UNKNOWN')}`);
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
    }
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
