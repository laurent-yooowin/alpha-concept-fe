import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PreventionBudgetReconciliationIntentStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED';

/**
 * Durable hand-off between report deletion and the budget worker.
 *
 * reportId is deliberately an opaque identifier without a foreign key: the
 * report (and its cascaded source rows) may be deleted before the worker can
 * consume the intent.
 */
@Entity('prevention_budget_reconciliation_intents')
@Index('UQ_prevention_budget_reconciliation_intents_org_event_scenario', ['organizationId', 'eventId', 'scenarioId'], { unique: true })
@Index('IDX_prevention_budget_reconciliation_intents_org_status_available', ['organizationId', 'status', 'availableAt'])
@Index('IDX_prevention_budget_reconciliation_intents_org_report', ['organizationId', 'reportId', 'status'])
export class PreventionBudgetReconciliationIntent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) eventId: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'varchar', length: 36 }) reportId: string;
  @Column({ type: 'varchar', length: 36 }) scenarioId: string;
  @Column({ type: 'int', unsigned: true }) scenarioVersion: number;
  @Column({ type: 'varchar', length: 64 }) sourceVersion: string;
  @Column({ type: 'enum', enum: ['PENDING', 'PROCESSING', 'PROCESSED'], default: 'PENDING' })
  status: PreventionBudgetReconciliationIntentStatus;
  @Column({ type: 'int', unsigned: true, default: 0 }) attempts: number;
  @Column({ type: 'datetime', precision: 6 }) availableAt: Date;
  @Column({ type: 'datetime', precision: 6, nullable: true }) lockedAt: Date | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) lockedBy: string | null;
  @Column({ type: 'datetime', precision: 6, nullable: true }) processedAt: Date | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) lastError: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
