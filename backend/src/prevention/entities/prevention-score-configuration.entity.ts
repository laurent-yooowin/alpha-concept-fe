import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organizations/organization.entity';
import { PreventionScoreConfigurationSource } from '../statistics/prevention-statistics.enums';

/** A complete, versioned set of values used by the priority formula. */
@Entity('prevention_score_configurations')
@Index('UQ_prevention_score_configurations_organization_version', [
  'organizationId',
  'version',
], { unique: true })
@Index('IDX_prevention_score_configurations_organization_active', [
  'organizationId',
  'isActive',
])
export class PreventionScoreConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'int', unsigned: true })
  version: number;

  @Column({
    type: 'enum',
    enum: PreventionScoreConfigurationSource,
    default: PreventionScoreConfigurationSource.ADMIN,
  })
  source: PreventionScoreConfigurationSource;

  @Column({ type: 'char', length: 64 })
  configurationFingerprint: string;

  @Column({ type: 'json' })
  weights: Record<string, number>;

  @Column({ type: 'json' })
  factors: Record<string, number>;

  @Column({ type: 'json' })
  thresholds: Record<string, number>;

  @Column({ type: 'tinyint', default: 1 })
  isActive: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;
}
