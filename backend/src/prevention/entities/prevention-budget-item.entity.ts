import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { PreventionBudgetPriority, PreventionBudgetStatus } from '../budget/prevention-budget.types';

@Entity('prevention_budget_items')
@Index('UQ_prevention_budget_items_org_id', ['organizationId', 'id'], { unique: true })
@Index('UQ_prevention_budget_items_org_scenario_key', ['organizationId', 'scenarioId', 'itemKey'], { unique: true })
@Index('IDX_prevention_budget_items_org_status', ['organizationId', 'status'])
@Index('IDX_prev_budget_item_org_client', ['organizationId', 'clientKey'])
export class PreventionBudgetItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'varchar', length: 36 }) scenarioId: string;
  @Column({ type: 'char', length: 64 }) itemKey: string;
  @Column({ type: 'varchar', length: 36, nullable: true }) catalogId: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) categoryId: string | null;
  @Column({ type: 'varchar', length: 80 }) categoryKey: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) clientKey: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) clientLabel: string | null;
  @Column({ type: 'varchar', length: 500 }) title: string;
  @Column({ type: 'enum', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' }) priority: PreventionBudgetPriority;
  @Column({ type: 'decimal', precision: 18, scale: 4 }) quantity: string;
  @Column({ type: 'varchar', length: 50 }) unit: string;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) unitCostHt: string | null;
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) totalHt: string;
  @Column({ type: 'enum', enum: ['A_CHIFFRER', 'ESTIME', 'VALIDE', 'ENGAGE', 'REALISE'], default: 'A_CHIFFRER' }) status: PreventionBudgetStatus;
  @Column({ type: 'text', nullable: true }) justification: string | null;
  @Column({ type: 'json', nullable: true }) aiEstimateDetails: Record<string, unknown> | null;
  @Column({ type: 'text', nullable: true }) adminPrompt: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) adminPromptActorId: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) priceSource: string | null;
  @Column({ type: 'tinyint', default: 0 }) lockedManual: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) updatedAt: Date;
}
