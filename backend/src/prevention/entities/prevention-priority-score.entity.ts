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
import { PreventionCategory } from './prevention-category.entity';
import { PreventionFindingType, PreventionRiskLevel } from './prevention.enums';
import { PreventionScoreConfiguration } from './prevention-score-configuration.entity';
import { PreventionScoreConfigurationSource } from '../statistics/prevention-statistics.enums';

@Entity('prevention_priority_scores')
@Index('UQ_prevention_priority_scores_dimensions', [
  'organizationId',
  'patternKey',
  'missionType',
  'categoryKey',
  'findingType',
], { unique: true })
@Index('IDX_prevention_priority_scores_organization_score', ['organizationId', 'score'])
@Index('IDX_prevention_priority_scores_organization_pattern', [
  'organizationId',
  'patternKey',
])
@Index('IDX_prevention_priority_scores_organization_reference_date', [
  'organizationId',
  'referenceDate',
])
export class PreventionPriorityScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'char', length: 64 })
  patternKey: string;

  @Column({ type: 'varchar', length: 32 })
  missionType: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  categoryId: string | null;

  @ManyToOne(() => PreventionCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category: PreventionCategory | null;

  @Column({ type: 'varchar', length: 36 })
  categoryKey: string;

  @Column({ type: 'enum', enum: PreventionFindingType })
  findingType: PreventionFindingType;

  @Column({ type: 'enum', enum: PreventionRiskLevel })
  riskLevel: PreventionRiskLevel;

  @Column({ type: 'tinyint', unsigned: true })
  score: number;

  @Column({ type: 'json' })
  components: Record<string, unknown>;

  @Column({ type: 'date' })
  referenceDate: string;

  @Column({ type: 'date' })
  periodStartDate: string;

  @Column({ type: 'date' })
  periodEndDate: string;

  @Column({ type: 'date' })
  firstOccurrenceDate: string;

  @Column({ type: 'date' })
  lastOccurrenceDate: string;

  @Column({ type: 'int', unsigned: true })
  occurrenceCount: number;

  @Column({ type: 'int', unsigned: true })
  reportCount: number;

  @Column({ type: 'int', unsigned: true })
  visitCount: number;

  @Column({ type: 'int', unsigned: true })
  missionCount: number;

  @Column({ type: 'int', unsigned: true })
  occurrenceDayCount: number;

  @Column({ type: 'int', unsigned: true })
  trendCurrentOccurrenceCount: number;

  @Column({ type: 'int', unsigned: true })
  trendPreviousOccurrenceCount: number;

  @Column({ type: 'enum', enum: PreventionScoreConfigurationSource })
  configurationSource: PreventionScoreConfigurationSource;

  @Column({ type: 'varchar', length: 36, nullable: true })
  configurationId: string | null;

  @ManyToOne(() => PreventionScoreConfiguration, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'organizationId', referencedColumnName: 'organizationId' },
    { name: 'configurationId', referencedColumnName: 'id' },
  ])
  configuration: PreventionScoreConfiguration | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  configurationVersion: number | null;

  @Column({ type: 'char', length: 64 })
  configurationFingerprint: string;

  @Column({ type: 'datetime', precision: 6 })
  calculatedAt: Date;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
