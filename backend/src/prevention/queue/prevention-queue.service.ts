import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID, createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  PreventionOutboxEvent,
  PreventionOutboxStatus,
} from '../outbox/prevention-outbox.entity';
import {
  PREVENTION_DELETE_JOB,
  PREVENTION_UPSERT_JOB,
  PreventionReportEventPayload,
} from '../outbox/prevention-outbox.types';
import { PREVENTION_GROUP_QUEUE, PREVENTION_REDIS, PREVENTION_QUEUE } from './prevention-queue.constants';
import { PreventionActivationService } from '../prevention-activation.service';

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const LOCK_TTL_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

function observabilityCorrelation(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function preventionRetryState(attempts: number, now = Date.now()): {
  status: PreventionOutboxStatus;
  availableAt: Date | null;
  delayMs: number | null;
} {
  if (attempts > RETRY_DELAYS_MS.length) {
    return { status: PreventionOutboxStatus.FAILED, availableAt: null, delayMs: null };
  }
  const delayMs = RETRY_DELAYS_MS[attempts - 1];
  return {
    status: PreventionOutboxStatus.PENDING,
    availableAt: new Date(now + delayMs),
    delayMs,
  };
}

export function preventionJobId(deduplicationKey: string): string {
  // BullMQ job ids must not contain ':'; hashing preserves deterministic
  // idempotency without exposing tenant/report identifiers in Redis keys.
  return `prevention-${createHash('sha256').update(deduplicationKey).digest('hex')}`;
}

@Injectable()
export class PreventionQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreventionQueueService.name);
  private readonly instanceId = randomUUID();
  private publisherTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(PREVENTION_QUEUE) private readonly queue: Queue,
    @Inject(PREVENTION_GROUP_QUEUE) private readonly groupQueue: Queue,
    @Inject(PREVENTION_REDIS) private readonly redis: Redis,
    @Inject(PreventionActivationService) private readonly activation: PreventionActivationService,
  ) {}

  onModuleInit(): void {
    if (this.config.get('PREVENTION_PUBLISHER_ENABLED', 'true') === 'false') return;
    const configuredInterval = Number(
      this.config.get('PREVENTION_PUBLISHER_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
    );
    const interval = Number.isFinite(configuredInterval)
      ? Math.max(1_000, configuredInterval)
      : DEFAULT_POLL_INTERVAL_MS;
    this.publisherTimer = setInterval(() => {
      void this.publishBatch().catch(() => {
        this.logger.warn({ message: 'Prevention outbox polling failed', context: PreventionQueueService.name,
          event: 'PREVENTION_OUTBOX_POLL_FAILED' } as any);
      });
    }, interval);
    this.queue.on('error', () => {
      this.logger.warn({ message: 'Prevention queue unavailable', context: PreventionQueueService.name,
        event: 'PREVENTION_QUEUE_UNAVAILABLE' } as any);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.publisherTimer) clearInterval(this.publisherTimer);
    await this.groupQueue.close().catch(() => undefined);
    await this.queue.close().catch(() => undefined);
    await this.redis.quit().catch(() => undefined);
  }

  async publishBatch(): Promise<void> {
    const repository = this.dataSource.getRepository(PreventionOutboxEvent);
    await this.recoverExpiredClaims(repository);

    const claimed = await this.claimPending(repository);
    for (const event of claimed) await this.publishEvent(repository, event);
  }

  private async recoverExpiredClaims(repository: Repository<PreventionOutboxEvent>): Promise<void> {
    await repository.query(
      `UPDATE prevention_outbox_events
       SET status = ?, lockedAt = NULL, lockedBy = NULL
       WHERE status = ? AND lockedAt IS NOT NULL
         AND lockedAt < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND)`,
      [PreventionOutboxStatus.PENDING, PreventionOutboxStatus.PROCESSING, LOCK_TTL_MS / 1000],
    );
  }

  private async claimPending(repository: Repository<PreventionOutboxEvent>): Promise<PreventionOutboxEvent[]> {
    const configuredBatchSize = Number(
      this.config.get('PREVENTION_PUBLISHER_BATCH_SIZE', DEFAULT_BATCH_SIZE),
    );
    const batchSize = Number.isFinite(configuredBatchSize)
      ? Math.max(1, Math.min(Math.trunc(configuredBatchSize), 100))
      : DEFAULT_BATCH_SIZE;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const rows: Array<{ id: string }> = await manager.query(
             `SELECT id FROM prevention_outbox_events
             WHERE status = ? AND availableAt <= UTC_TIMESTAMP(6)
               AND EXISTS (SELECT 1 FROM organizations o WHERE o.id=prevention_outbox_events.organizationId AND o.isActive=1 AND o.preventionEnabled=1)
             ORDER BY availableAt ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
            [PreventionOutboxStatus.PENDING, batchSize],
          );
          if (!rows.length) return [];
          const ids = rows.map((row) => row.id);
          const placeholders = ids.map(() => '?').join(',');
          await manager.query(
            `UPDATE prevention_outbox_events
             SET status = ?, lockedAt = UTC_TIMESTAMP(6), lockedBy = ?
             WHERE id IN (${placeholders}) AND status = ?`,
            [PreventionOutboxStatus.PROCESSING, this.instanceId, ...ids, PreventionOutboxStatus.PENDING],
          );
          return manager.getRepository(PreventionOutboxEvent).find({
            where: { id: In(ids), status: PreventionOutboxStatus.PROCESSING, lockedBy: this.instanceId },
          });
        });
      } catch (error: any) {
        const deadlock = error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213;
        if (!deadlock || attempt === 3) throw error;
        this.logger.warn({ message: 'Prevention outbox claim deadlock', context: PreventionQueueService.name,
          event: 'PREVENTION_OUTBOX_CLAIM_RETRY', attempt } as any);
      }
    }
    return [];
  }

  private async publishEvent(
    repository: Repository<PreventionOutboxEvent>,
    event: PreventionOutboxEvent,
  ): Promise<void> {
    if (!(await this.activation.isEnabled(event.organizationId, repository.manager))) {
      await repository.update(
        { id: event.id, status: PreventionOutboxStatus.PROCESSING, lockedBy: this.instanceId },
        { status: PreventionOutboxStatus.PENDING, lockedAt: null, lockedBy: null },
      );
      return;
    }
    const payload: PreventionReportEventPayload = {
      eventId: event.payload.eventId,
      organizationId: event.payload.organizationId,
      reportId: event.payload.reportId,
      eventType: event.payload.eventType,
      aggregateVersion: event.payload.aggregateVersion,
      occurredAt: event.payload.occurredAt,
    };
    try {
      await this.queue.add(
        payload.eventType === 'REPORT_DELETED' ? PREVENTION_DELETE_JOB : PREVENTION_UPSERT_JOB,
        payload,
        {
          jobId: preventionJobId(event.deduplicationKey),
          delay: 2 * 60_000,
          attempts: 4,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
      await repository.update(
        { id: event.id, status: PreventionOutboxStatus.PROCESSING, lockedBy: this.instanceId },
        {
          status: PreventionOutboxStatus.PUBLISHED,
          publishedAt: (() => 'UTC_TIMESTAMP(6)') as any,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      );
    } catch (error: any) {
      await this.recordFailure(repository, event, error);
    }
  }

  private async recordFailure(
    repository: Repository<PreventionOutboxEvent>,
    event: PreventionOutboxEvent,
    error: any,
  ): Promise<void> {
    const attempts = event.attempts + 1;
    const retry = preventionRetryState(attempts);
    const errorCode = typeof error?.code === 'string' ? error.code.slice(0, 100) : 'UNKNOWN';
    const message = `queue publish failed (${errorCode})`;
    await repository.update(
      { id: event.id, status: PreventionOutboxStatus.PROCESSING, lockedBy: this.instanceId },
      {
        attempts,
        status: retry.status,
        availableAt: retry.delayMs === null
          ? event.availableAt
          : (() => `DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${retry.delayMs * 1000} MICROSECOND)`) as any,
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    );
    this.logger.warn({
      message: 'Prevention outbox publish failed',
      context: PreventionQueueService.name,
      event: 'PREVENTION_OUTBOX_PUBLISH_FAILED',
      correlationId: observabilityCorrelation(event.id),
      attempts,
      terminal: retry.status === PreventionOutboxStatus.FAILED,
    } as any);
  }
}
