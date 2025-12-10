import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToOne } from 'typeorm';
import { User } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';

export enum ReportStatus {
  DRAFT = 'brouillon',
  SENT = 'envoye',
  VALIDATED = 'valide',
  REJECTED = 'refuse',
  ARCHIVED = 'archive',
  SENT_TO_CLIENT = 'envoye_au_client',
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // =========================
  // ✅ RELATION AVEC MISSION (ManyToOne)
  // =========================

  @Column('uuid')
  missionId: string;

  @ManyToOne(() => Mission, mission => mission.reports, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'missionId' })
  mission: Mission;

  // =========================
  // ✅ RELATION AVEC VISIT (ManyToOne ✅ AU LIEU DE OneToOne ❌)
  // =========================

  @Column('uuid', { nullable: true })
  visitId: string;

  @ManyToOne(() => Visit, visit => visit.reports, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'visitId' })
  visit: Visit;

  // =========================
  // ✅ RELATION AVEC USER
  // =========================

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, user => user.reports, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  // =========================
  // ✅ DONNÉES MÉTIER
  // =========================

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  header: string;

  @Column({ type: 'text', nullable: true })
  footer: string;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    default: ReportStatus.DRAFT,
  })
  status: ReportStatus;

  @Column({ type: 'float', default: 0 })
  conformityPercentage: number;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date;

  @Column({ nullable: true })
  recipientEmail: string;

  @Column({ nullable: true })
  observations: string;

  @Column({ nullable: true })
  remarquesAdmin: string;

  @Column({ nullable: true })
  reportFileUrl: string;

  @Column({ nullable: true })
  validatedAt: Date;

  @Column({ nullable: true })
  sentToClientAt: Date;

  // =========================
  // ✅ DATES AUTO
  // =========================

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
