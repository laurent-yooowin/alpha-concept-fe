import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PreventionBudgetScenarioStatus = 'DRAFT' | 'CALCULATED' | 'VALIDATED' | 'ARCHIVED';

@Entity('prevention_budget_scenarios')
@Index('UQ_prevention_budget_scenarios_org_id', ['organizationId', 'id'], { unique: true })
@Index('UQ_prevention_budget_scenarios_org_key_version', ['organizationId', 'scenarioKey', 'version'], { unique: true })
@Index('UQ_prevention_budget_scenarios_org_key_source', ['organizationId', 'scenarioKey', 'sourceVersion'], { unique: true })
@Index('IDX_prevention_budget_scenarios_org_period', ['organizationId', 'periodStart', 'periodEnd'])
export class PreventionBudgetScenario {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'char', length: 64 }) scenarioKey: string;
  @Column({ type: 'int', unsigned: true }) version: number;
  @Column({ type: 'varchar', length: 64 }) sourceVersion: string;
  @Column({ type: 'date' }) periodStart: string;
  @Column({ type: 'date' }) periodEnd: string;
  @Column({ type: 'enum', enum: ['DRAFT', 'CALCULATED', 'VALIDATED', 'ARCHIVED'], default: 'DRAFT' })
  status: PreventionBudgetScenarioStatus;
  @Column({ type: 'decimal', precision: 5, scale: 2 }) contingencyRatePercent: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) retainedBudgetHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) estimatedBudgetHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) validatedBudgetHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) contingencyAmountHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) totalBudgetHt: string;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
}

