import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PreventionGroupProcessingStatus = 'PENDING' | 'PROCESSING' | 'RETRY' | 'READY' | 'FAILED';

@Entity('prevention_group_processing_jobs')
@Index('UQ_prevention_group_processing_org_visit_source', ['organizationId', 'visitId', 'sourceGroupId'], { unique: true })
@Index('IDX_prevention_group_processing_due', ['processingStatus', 'availableAt', 'organizationId'])
@Index('IDX_prevention_group_processing_visit', ['organizationId', 'visitId'])
@Index('IDX_prevention_group_processing_recovery', ['organizationId', 'recoveryRunId', 'processingStatus'])
export class PreventionGroupProcessingJob {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'varchar', length: 36 }) visitId: string;
  @Column({ type: 'varchar', length: 36 }) missionId: string;
  @Column({ type: 'varchar', length: 100 }) sourceGroupId: string;
  @Column({ type: 'enum', enum: ['PHOTO', 'DIRECTIVE', 'MIXED'] }) sourceKind: 'PHOTO' | 'DIRECTIVE' | 'MIXED';
  @Column({ type: 'enum', enum: ['PENDING', 'PROCESSING', 'RETRY', 'READY', 'FAILED'], default: 'PENDING' }) processingStatus: PreventionGroupProcessingStatus;
  @Column({ type: 'enum', enum: ['PROPOSED', 'VALIDATED'], default: 'PROPOSED' }) phaseStatus: 'PROPOSED' | 'VALIDATED';
  @Column({ type: 'enum', enum: ['GROS_OEUVRE', 'STRUCTURE_CLOS_COUVERT', 'SECOND_OEUVRE', 'INSTALLATIONS_FINITIONS', 'INSTALLATION_ELECTRIQUE', 'FINITIONS_INTERIEURES', 'FINITIONS_EXTERIEURES'], nullable: true }) proposedPhase: string | null;
  @Column({ type: 'varchar', length: 43, nullable: true }) effectivePhase: string | null;
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true }) confidence: string | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) justification: string | null;
  @Column({ type: 'json', nullable: true }) riskAssessments: unknown;
  @Column({ type: 'json', nullable: true }) recommendationOverrides: unknown;
  @Column({ type: 'json' }) sourcePayload: Record<string, unknown>;
  @Column({ type: 'char', length: 64 }) sourceHash: string;
  @Column({ type: 'varchar', length: 36, nullable: true }) recoveryRunId: string | null;
  @Column({ type: 'int', unsigned: true, default: 0 }) attempts: number;
  @Column({ type: 'datetime', precision: 6 }) availableAt: Date;
  @Column({ type: 'datetime', precision: 6, nullable: true }) lockedAt: Date | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) lockedBy: string | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) lastError: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) validatedBy: string | null;
  @Column({ type: 'datetime', precision: 6, nullable: true }) validatedAt: Date | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
