import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../organizations/organization.entity';
import { PreventionFindingType } from './prevention.enums';
import { PreventionStatisticsPartitionStatus } from '../statistics/prevention-statistics.enums';

@Entity('prevention_score_partitions')
@Index('UQ_prevention_score_partitions_dimensions', [
  'organizationId', 'patternKey', 'missionType', 'categoryKey', 'findingType',
], { unique: true })
@Index('IDX_prevention_score_partitions_claim', ['status', 'availableAt', 'organizationId'])
export class PreventionScorePartition {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' }) organization: Organization;
  @Column({ type: 'char', length: 64 }) patternKey: string;
  @Column({ type: 'varchar', length: 32 }) missionType: string;
  @Column({ type: 'varchar', length: 36 }) categoryKey: string;
  @Column({ type: 'enum', enum: PreventionFindingType }) findingType: PreventionFindingType;
  @Column({ type: 'date' }) referenceDate: string;
  @Column({ type: 'enum', enum: PreventionStatisticsPartitionStatus,
    default: PreventionStatisticsPartitionStatus.PENDING })
  status: PreventionStatisticsPartitionStatus;
  @Column({ type: 'bigint', unsigned: true, default: 1 }) version: string;
  @Column({ type: 'datetime', precision: 6 }) availableAt: Date;
  @Column({ type: 'datetime', precision: 6, nullable: true }) claimedAt: Date | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) claimToken: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
