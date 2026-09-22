import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prevention_budget_audit')
@Index('IDX_prevention_budget_audit_org_scenario', ['organizationId', 'scenarioId', 'scenarioVersion'])
export class PreventionBudgetAudit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'varchar', length: 36 }) scenarioId: string;
  @Column({ type: 'int', unsigned: true }) scenarioVersion: number;
  @Column({ type: 'enum', enum: ['BUILD', 'RECALCULATE', 'REFRESH_ITEM', 'RECONCILE'] })
  action: 'BUILD' | 'RECALCULATE' | 'REFRESH_ITEM' | 'RECONCILE';
  @Column({ type: 'varchar', length: 36, nullable: true }) actorId: string | null;
  @Column({ type: 'json', nullable: true }) beforeState: Record<string, unknown> | null;
  @Column({ type: 'json' }) afterState: Record<string, unknown>;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
}

