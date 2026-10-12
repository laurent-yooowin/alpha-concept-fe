import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('prevention_scheduler_runs')
@Index('UQ_prevention_scheduler_runs_occurrence', ['jobType', 'scheduledFor'], { unique: true })
@Index('IDX_prevention_scheduler_runs_status_available', ['status', 'availableAt'])
export class PreventionSchedulerRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 50 }) jobType: string;
  @Column({ type: 'datetime', precision: 6 }) scheduledFor: Date;
  @Column({ type: 'enum', enum: ['PENDING', 'PROCESSING', 'SCHEDULED', 'SUSPENDED', 'COMPLETED', 'FAILED'], default: 'PENDING' })
  status: 'PENDING' | 'PROCESSING' | 'SCHEDULED' | 'SUSPENDED' | 'COMPLETED' | 'FAILED';
  @Column({ type: 'varchar', length: 36, nullable: true }) organizationCursor: string | null;
  @Column({ type: 'int', unsigned: true, default: 0 }) processedOrganizations: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) enqueuedJobs: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) reportCount: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) findingCount: number;
  @Column({ type: 'int', unsigned: true, default: 0 }) immediateLimit: number;
  @Column({ type: 'enum', enum: ['IMMEDIATE', 'SCHEDULED'], default: 'IMMEDIATE' }) executionMode: 'IMMEDIATE' | 'SCHEDULED';
  @Column({ type: 'varchar', length: 32, default: 'AUTOMATIC' }) workKind: 'AUTOMATIC' | 'ACTIVATION' | 'ADMIN_RECONSTRUCTION' | 'BUDGET';
  @Column({ type: 'tinyint', default: 0 }) dispatchComplete: boolean;
  @Column({ type: 'int', unsigned: true, default: 0 }) attempts: number;
  @Column({ type: 'datetime', precision: 6 }) availableAt: Date;
  @Column({ type: 'datetime', precision: 6, nullable: true }) lockedAt: Date | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) lockedBy: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) lastError: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
