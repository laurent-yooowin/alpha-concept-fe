import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prevention_cost_catalog')
@Index('UQ_prevention_cost_catalog_org_id', ['organizationId', 'id'], { unique: true })
@Index('UQ_prevention_cost_catalog_org_version', ['organizationId', 'version'], { unique: true })
@Index('IDX_prevention_cost_catalog_org_match_validity', ['organizationId', 'matchingKey', 'validFrom', 'validTo'])
export class PreventionCostCatalog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) organizationId: string;
  @Column({ type: 'int', unsigned: true }) version: number;
  @Column({ type: 'char', length: 64, nullable: true }) matchingKey: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) categoryId: string | null;
  @Column({ type: 'varchar', length: 80 }) categoryKey: string;
  @Column({ type: 'varchar', length: 255 }) label: string;
  @Column({ type: 'varchar', length: 50 }) unit: string;
  @Column({ type: 'decimal', precision: 18, scale: 2 }) unitCostHt: string;
  @Column({ type: 'varchar', length: 500 }) priceSource: string;
  @Column({ type: 'date' }) validFrom: string;
  @Column({ type: 'date', nullable: true }) validTo: string | null;
  @Column({ type: 'tinyint', default: 1 }) isActive: boolean;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
}

