import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('prevention_phase_catalog')
@Index('UQ_prevention_phase_catalog_label_key', ['labelKey'], { unique: true })
@Index('IDX_prevention_phase_catalog_creator_time', ['createdBy', 'createdAt'])
export class PreventionPhaseCatalog {
  @PrimaryColumn({ type: 'varchar', length: 43 }) code: string;
  @Column({ type: 'varchar', length: 80 }) label: string;
  @Column({ type: 'varchar', length: 160 }) labelKey: string;
  @Column({ type: 'varchar', length: 36 }) createdBy: string;
  @Column({ type: 'varchar', length: 36 }) createdFromOrganizationId: string;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) createdAt: Date;
}
