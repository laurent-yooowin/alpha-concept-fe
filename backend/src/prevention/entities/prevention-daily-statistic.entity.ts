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
import {
  PreventionFindingType,
  PreventionRiskLevel,
  PREVENTION_UNCATEGORIZED_KEY,
} from './prevention.enums';
import { PreventionCategory } from './prevention-category.entity';

@Entity('prevention_daily_statistics')
@Index(
  'UQ_prevention_daily_statistics_dimensions',
  ['organizationId', 'statDate', 'missionType', 'categoryKey', 'riskLevel', 'findingType'],
  { unique: true },
)
@Index('IDX_prevention_daily_statistics_organization_stat_date', ['organizationId', 'statDate'])
@Index('IDX_prevention_daily_statistics_org_mission_type_date', [
  'organizationId',
  'missionType',
  'statDate',
])
export class PreventionDailyStatistic {
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

  @Column({ type: 'varchar', length: 36, nullable: true })
  categoryId: string | null;

  @ManyToOne(() => PreventionCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category: PreventionCategory | null;

  @Column({ type: 'varchar', length: 36, default: PREVENTION_UNCATEGORIZED_KEY })
  categoryKey: string;

  @Column({ type: 'enum', enum: PreventionRiskLevel })
  riskLevel: PreventionRiskLevel;

  @Column({ type: 'enum', enum: PreventionFindingType })
  findingType: PreventionFindingType;

  @Column({ type: 'int', unsigned: true, default: 0 })
  findingCount: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  reportCount: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  visitCount: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  missionCount: number;

  @Column({ type: 'datetime', precision: 6 })
  calculatedAt: Date;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
