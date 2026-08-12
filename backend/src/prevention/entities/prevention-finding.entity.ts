import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Mission } from '../../missions/mission.entity';
import { Organization } from '../../organizations/organization.entity';
import { Report } from '../../reports/report.entity';
import { Visit } from '../../visits/visit.entity';
import {
  PreventionFindingType,
  PreventionRiskLevel,
  PreventionSourceKind,
} from './prevention.enums';
import { PreventionCategory } from './prevention-category.entity';
import { PreventionReportSnapshot } from './prevention-report-snapshot.entity';

@Entity('prevention_findings')
@Index('UQ_prevention_findings_snapshot_key_type', ['snapshotId', 'normalizedKey', 'findingType'], {
  unique: true,
})
@Index('IDX_prevention_findings_organization_business_date_risk_level', [
  'organizationId',
  'businessDate',
  'riskLevel',
])
@Index('IDX_prevention_findings_organization_category_business_date', [
  'organizationId',
  'categoryId',
  'businessDate',
])
@Index('IDX_prevention_findings_organization_mission_type_business_date', [
  'organizationId',
  'missionType',
  'businessDate',
])
@Index('IDX_prevention_findings_organization_report', ['organizationId', 'reportId'])
@Index('IDX_prevention_findings_org_snapshot', ['organizationId', 'snapshotId'])
@Index('IDX_prevention_findings_org_visit', ['organizationId', 'visitId'])
@Index('IDX_prevention_findings_org_mission', ['organizationId', 'missionId'])
export class PreventionFinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ type: 'varchar', length: 36 })
  snapshotId: string;

  @ManyToOne(() => PreventionReportSnapshot, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'organizationId', referencedColumnName: 'organizationId' },
    { name: 'snapshotId', referencedColumnName: 'id' },
  ])
  snapshot: PreventionReportSnapshot;

  @Column({ type: 'varchar', length: 36 })
  reportId: string;

  @ManyToOne(() => Report, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'organizationId', referencedColumnName: 'organizationId' },
    { name: 'reportId', referencedColumnName: 'id' },
  ])
  report: Report;

  @Column({ type: 'varchar', length: 36 })
  visitId: string;

  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'organizationId', referencedColumnName: 'organizationId' },
    { name: 'visitId', referencedColumnName: 'id' },
  ])
  visit: Visit;

  @Column({ type: 'varchar', length: 36 })
  missionId: string;

  @ManyToOne(() => Mission, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'organizationId', referencedColumnName: 'organizationId' },
    { name: 'missionId', referencedColumnName: 'id' },
  ])
  mission: Mission;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceGroupId: string | null;

  @Column({ type: 'enum', enum: PreventionSourceKind })
  sourceKind: PreventionSourceKind;

  @Column({ type: 'enum', enum: PreventionFindingType })
  findingType: PreventionFindingType;

  @Column({ type: 'varchar', length: 36, nullable: true })
  categoryId: string | null;

  @ManyToOne(() => PreventionCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category: PreventionCategory | null;

  @Column({ type: 'char', length: 64 })
  normalizedKey: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  danger: string | null;

  @Column({ type: 'text', nullable: true })
  risk: string | null;

  @Column({ type: 'enum', enum: PreventionRiskLevel })
  riskLevel: PreventionRiskLevel;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  confidence: string | null;

  @Column({ type: 'json', nullable: true })
  regulatoryReferences: string[] | null;

  @Column({ type: 'date' })
  businessDate: string;

  @Column({ type: 'varchar', length: 32 })
  missionType: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;
}
