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
import { Mission } from '../../missions/mission.entity';
import { Organization } from '../../organizations/organization.entity';
import { Report } from '../../reports/report.entity';
import { Visit } from '../../visits/visit.entity';

@Entity('prevention_report_snapshots')
@Index('UQ_prevention_report_snapshots_organization_report', ['organizationId', 'reportId'], {
  unique: true,
})
@Index('IDX_prevention_report_snapshots_organization_business_date', [
  'organizationId',
  'businessDate',
])
@Index('IDX_prevention_report_snapshots_organization_source_updated_at', [
  'organizationId',
  'sourceUpdatedAt',
])
@Index('UQ_prevention_report_snapshots_org_id', ['organizationId', 'id'], { unique: true })
@Index('IDX_prevention_report_snapshots_org_visit', ['organizationId', 'visitId'])
@Index('IDX_prevention_report_snapshots_org_mission', ['organizationId', 'missionId'])
export class PreventionReportSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

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

  @Column({ type: 'char', length: 64 })
  sourceHash: string;

  @Column({ type: 'datetime', precision: 6 })
  sourceUpdatedAt: Date;

  @Column({ type: 'date' })
  businessDate: string;

  @Column({ type: 'varchar', length: 32 })
  missionType: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  sourceStatus: string | null;

  @Column({ type: 'int', default: 0 })
  findingCount: number;

  @Column({ type: 'datetime', precision: 6 })
  indexedAt: Date;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
