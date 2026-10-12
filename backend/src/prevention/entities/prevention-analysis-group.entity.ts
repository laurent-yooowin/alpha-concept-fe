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
import {
  PREVENTION_CONSTRUCTION_PHASES,
  PreventionConstructionPhase,
  PreventionPhaseSource,
  PreventionPhaseStatus,
} from '../prevention-phase';

@Entity('prevention_analysis_groups')
@Index('UQ_prevention_analysis_groups_org_visit_source', ['organizationId', 'visitId', 'sourceGroupId'], { unique: true })
@Index('IDX_prevention_analysis_groups_org_report_phase', ['organizationId', 'reportId', 'effectivePhase'])
@Index('IDX_prevention_analysis_groups_org_visit_status', ['organizationId', 'visitId', 'status'])
export class PreventionAnalysisGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' }) organization: Organization;

  @Column({ type: 'varchar', length: 36 }) visitId: string;
  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'organizationId', referencedColumnName: 'organizationId' }, { name: 'visitId', referencedColumnName: 'id' }]) visit: Visit;

  @Column({ type: 'varchar', length: 36 }) missionId: string;
  @ManyToOne(() => Mission, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'organizationId', referencedColumnName: 'organizationId' }, { name: 'missionId', referencedColumnName: 'id' }]) mission: Mission;

  @Column({ type: 'varchar', length: 36 }) reportId: string;
  @ManyToOne(() => Report, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'organizationId', referencedColumnName: 'organizationId' }, { name: 'reportId', referencedColumnName: 'id' }]) report: Report;

  @Column({ type: 'varchar', length: 100 }) sourceGroupId: string;
  @Column({ type: 'enum', enum: ['PHOTO', 'DIRECTIVE', 'MIXED'] }) sourceKind: PreventionPhaseSource;
  @Column({ type: 'enum', enum: [...PREVENTION_CONSTRUCTION_PHASES] }) proposedPhase: PreventionConstructionPhase;
  @Column({ type: 'enum', enum: [...PREVENTION_CONSTRUCTION_PHASES] }) effectivePhase: PreventionConstructionPhase;
  @Column({ type: 'enum', enum: ['PROPOSED', 'VALIDATED'], default: 'PROPOSED' }) status: PreventionPhaseStatus;
  @Column({ type: 'decimal', precision: 5, scale: 2 }) confidence: string;
  @Column({ type: 'varchar', length: 1000 }) justification: string;
  @Column({ type: 'enum', enum: ['PHOTO', 'DIRECTIVE', 'MIXED'] }) source: PreventionPhaseSource;
  @Column({ type: 'varchar', length: 100, nullable: true }) modelVersion: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) validatedBy: string | null;
  @Column({ type: 'datetime', precision: 6, nullable: true }) validatedAt: Date | null;
  @Column({ type: 'char', length: 64 }) sourceHash: string;

  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
