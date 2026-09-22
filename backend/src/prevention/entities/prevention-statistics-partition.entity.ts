import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../organizations/organization.entity';
import { PreventionStatisticsPartitionStatus } from '../statistics/prevention-statistics.enums';

/** Durable work marker; deletion after a successful refresh is safe because events upsert it again. */
@Entity('prevention_statistics_partitions')
@Index('UQ_prevention_statistics_partitions_dimensions', [
  'organizationId',
  'statDate',
  'missionType',
  'categoryKey',
], { unique: true })
@Index('IDX_prevention_statistics_partitions_claim', [
  'status',
  'availableAt',
  'organizationId',
])
@Index('IDX_prevention_statistics_partitions_organization_date', [
  'organizationId',
  'statDate',
])
export class PreventionStatisticsPartition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'date' })
  statDate: string;

  @Column({ type: 'varchar', length: 32 })
  missionType: string;

  @Column({ type: 'varchar', length: 36 })
  categoryKey: string;

  @Column({ type: 'date' })
  referenceDate: string;

  @Column({
    type: 'enum',
    enum: PreventionStatisticsPartitionStatus,
    default: PreventionStatisticsPartitionStatus.PENDING,
  })
  status: PreventionStatisticsPartitionStatus;

  @Column({ type: 'bigint', unsigned: true, default: 1 })
  version: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  attempts: number;

  @Column({ type: 'datetime', precision: 6 })
  availableAt: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  claimToken: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
