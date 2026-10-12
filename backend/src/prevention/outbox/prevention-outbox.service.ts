import { Injectable, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { PreventionOutboxEvent, PreventionOutboxAggregateType } from './prevention-outbox.entity';
import {
  PreventionReportEventPayload,
  PreventionReportEventType,
  preventionDeduplicationKey,
} from './prevention-outbox.types';
import { PreventionActivationService } from '../prevention-activation.service';

@Injectable()
export class PreventionOutboxService {
  constructor(@Optional() private readonly activation?: PreventionActivationService) {}

  async enqueueReportEvent(
    manager: EntityManager,
    input: {
      organizationId?: string | null;
      reportId: string;
      eventType: PreventionReportEventType;
      aggregateVersion: string;
      occurredAt?: Date;
    },
  ): Promise<PreventionOutboxEvent | null> {
    // Historical reports without a tenant are intentionally left to the P9
    // backfill. Never trust a client-provided tenant or create an unscoped job.
    if (!input.organizationId) return null;
    if (this.activation && !(await this.activation.isEnabled(input.organizationId, manager))) return null;

    const eventId = uuid();
    const occurredAt = input.occurredAt ?? new Date();
    const payload: PreventionReportEventPayload = {
      eventId,
      organizationId: input.organizationId,
      reportId: input.reportId,
      eventType: input.eventType,
      aggregateVersion: input.aggregateVersion,
      occurredAt: occurredAt.toISOString(),
    };
    const repository = manager.getRepository(PreventionOutboxEvent);
    const event = repository.create({
      id: eventId,
      organizationId: input.organizationId,
      aggregateType: PreventionOutboxAggregateType.REPORT,
      aggregateId: input.reportId,
      eventType: input.eventType,
      aggregateVersion: input.aggregateVersion,
      deduplicationKey: preventionDeduplicationKey(
        input.organizationId,
        input.reportId,
        input.eventType,
        input.aggregateVersion,
      ),
      payload,
      status: 'PENDING' as any,
      attempts: 0,
      availableAt: occurredAt,
      lockedAt: null,
      lockedBy: null,
      publishedAt: null,
      lastError: null,
    });

    try {
      await repository
        .createQueryBuilder()
        .insert()
        .values({
          ...event,
          // Use the database clock for scheduling so the API process timezone
          // cannot make a new event appear in the future.
          availableAt: () => 'UTC_TIMESTAMP(6)',
        })
        .execute();
      return repository.findOneByOrFail({ id: event.id });
    } catch (error: any) {
      // The unique key is the idempotency boundary. A retry of the same
      // logical version is a successful no-op. Other DB errors are handled by
      // the independent Prevention caller after the SPS transaction commits.
      if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) {
        return repository.findOneBy({
          deduplicationKey: event.deduplicationKey,
        });
      }
      throw error;
    }
  }
}
