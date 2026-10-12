import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PreventionBudgetScenarioStatus = 'DRAFT' | 'CALCULATED' | 'VALIDATED' | 'ARCHIVED';
export type PreventionBudgetScenarioPeriodMode = 'BOUNDED' | 'ALL';

@Entity('prevention_budget_scenarios')
@Index('UQ_prevention_budget_scenarios_org_id', ['organizationId', 'id'], { unique: true })
@Index('UQ_prevention_budget_scenarios_org_key_version', ['organizationId', 'scenarioKey', 'version'], { unique: true })
@Index('UQ_prevention_budget_scenarios_org_key_source', ['organizationId', 'scenarioKey', 'sourceVersion'], { unique: true })
@Index('IDX_prevention_budget_scenarios_org_period', ['organizationId', 'periodStart', 'periodEnd'])
@Index('IDX_prev_budget_scenario_org_mission', ['organizationId', 'missionId'])
@Index('IDX_prev_budget_scenario_org_category', ['organizationId', 'categoryId'])
export class PreventionBudgetScenario {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'char', length: 64 }) scenarioKey: string;
  @Column({ type: 'int', unsigned: true }) version: number;
  @Column({ type: 'varchar', length: 64 }) sourceVersion: string;
  @Column({ type: 'date', nullable: true }) periodStart: string | null;
  @Column({ type: 'date', nullable: true }) periodEnd: string | null;
  /** ALL is an unbounded, stable identity; BOUNDED preserves historical ranges. */
  @Column({ type: 'enum', enum: ['BOUNDED', 'ALL'], default: 'BOUNDED' }) periodMode: PreventionBudgetScenarioPeriodMode;
  @Column({ type: 'varchar', length: 36, nullable: true }) missionId: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) categoryId: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) severity: string | null;
  @Column({ type: 'json', nullable: true }) clientKeys: string[] | null;
  @Column({ type: 'text', nullable: true }) adminPrompt: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) adminPromptActorId: string | null;
  @Column({ type: 'enum', enum: ['DRAFT', 'CALCULATED', 'VALIDATED', 'ARCHIVED'], default: 'DRAFT' })
  status: PreventionBudgetScenarioStatus;
  /** Set only when a targeted draft reached a terminal worker/enqueue failure. */
  @Column({ type: 'datetime', precision: 6, nullable: true })
  failedAt: Date | null;
  @Column({ type: 'decimal', precision: 5, scale: 2 }) contingencyRatePercent: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) retainedBudgetHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) estimatedBudgetHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) validatedBudgetHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) contingencyAmountHt: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) totalBudgetHt: string;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
}
