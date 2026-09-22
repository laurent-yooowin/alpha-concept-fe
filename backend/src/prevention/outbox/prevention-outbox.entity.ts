import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  PreventionReportEventPayload,
  PreventionReportEventType,
} from './prevention-outbox.types';
import { Organization } from '../../organizations/organization.entity';

export enum PreventionOutboxAggregateType {
  REPORT = 'REPORT',
}

export enum PreventionOutboxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

@Entity('prevention_outbox_events')
@Index('IDX_prevention_outbox_status_available', ['status', 'availableAt'])
@Index('IDX_prevention_outbox_org_aggregate_created', [
  'organizationId',
  'aggregateId',
  'createdAt',
])
export class PreventionOutboxEvent {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 36 })
  organizationId: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'enum', enum: PreventionOutboxAggregateType })
  aggregateType: PreventionOutboxAggregateType;

  @Column({ type: 'varchar', length: 36 })
  aggregateId: string;

  @Column({ type: 'enum', enum: ['REPORT_UPSERTED', 'REPORT_DELETED'] })
  eventType: PreventionReportEventType;

  @Column({ type: 'varchar', length: 64 })
  aggregateVersion: string;

  @Column({ type: 'varchar', length: 190, unique: true })
  deduplicationKey: string;

  @Column({ type: 'json' })
  payload: PreventionReportEventPayload;

  @Column({ type: 'enum', enum: PreventionOutboxStatus, default: PreventionOutboxStatus.PENDING })
  status: PreventionOutboxStatus;

  @Column({ type: 'int', unsigned: true, default: 0 })
  attempts: number;

  @Column({ type: 'datetime', precision: 6 })
  availableAt: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lockedBy: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
