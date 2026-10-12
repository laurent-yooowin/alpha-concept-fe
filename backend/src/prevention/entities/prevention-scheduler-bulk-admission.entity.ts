import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('prevention_scheduler_bulk_admission')
export class PreventionSchedulerBulkAdmission {
  @PrimaryColumn({ type: 'tinyint', unsigned: true }) id: number;
  @Column({ type: 'varchar', length: 36, nullable: true }) organizationId: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) runId: string | null;
  @Column({ type: 'enum', enum: ['AUTOMATIC', 'ADMIN_RECONSTRUCTION', 'BUDGET'], nullable: true }) workKind: 'AUTOMATIC' | 'ADMIN_RECONSTRUCTION' | 'BUDGET' | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) leaseToken: string | null;
  @Column({ type: 'datetime', precision: 6, nullable: true }) leaseExpiresAt: Date | null;
  @Column({ type: 'datetime', precision: 6, nullable: true }) availableAt: Date | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) lastError: string | null;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
