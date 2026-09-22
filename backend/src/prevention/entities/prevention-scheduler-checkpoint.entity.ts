import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('prevention_scheduler_checkpoints')
@Index('UQ_prevention_scheduler_checkpoints_run_org', ['runId', 'organizationId'], { unique: true })
@Index('UQ_prevention_scheduler_checkpoints_id_org', ['id', 'organizationId'], { unique: true })
@Index('IDX_prevention_scheduler_checkpoints_org_status', ['organizationId', 'status'])
export class PreventionSchedulerCheckpoint {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) runId: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'varchar', length: 36, nullable: true }) reportCursor: string | null;
  @Column({ type: 'enum', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'], default: 'PENDING' })
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  @Column({ type: 'int', unsigned: true, default: 0 }) processedReports: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) pendingJobs: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) failedJobs: number;
  @Column({ type: 'tinyint', default: 0 }) scanComplete: boolean;
  @Column({ type: 'int', unsigned: true, default: 0 }) attempts: number;
  @Column({ type: 'datetime', precision: 6 }) availableAt: Date;
  @Column({ type: 'datetime', precision: 6, nullable: true }) lockedAt: Date | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) lockedBy: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) lastError: string | null;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
