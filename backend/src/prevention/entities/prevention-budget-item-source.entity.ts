import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prevention_budget_item_sources')
@Index('UQ_prevention_budget_item_sources_org_item_kind_source', ['organizationId', 'itemId', 'sourceKind', 'sourceKey'], { unique: true })
export class PreventionBudgetItemSource {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'varchar', length: 36 }) itemId: string;
  @Column({ type: 'enum', enum: ['RECOMMENDATION', 'FINDING', 'REPORT'] }) sourceKind: 'RECOMMENDATION' | 'FINDING' | 'REPORT';
  @Column({ type: 'char', length: 64 }) sourceKey: string;
  @Column({ type: 'varchar', length: 36, nullable: true }) findingId: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) reportId: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
}

