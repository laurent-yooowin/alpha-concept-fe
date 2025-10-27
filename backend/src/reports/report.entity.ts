import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToOne } from 'typeorm';
import { User } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';

export enum ReportStatus {
  DRAFT = 'brouillon',
  SENT = 'envoye',
  VALIDATED = 'valide',
  REJECTED = 'rejete',
  ARCHIVED = 'archive',
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  missionId: string;

  @OneToOne(() => Mission)
  @JoinColumn({ name: 'missionId' })
  mission: Mission;

  @Column('uuid', { nullable: true })
  visitId: string;

  @OneToOne(() => Visit, { nullable: true })
  @JoinColumn({ name: 'visitId' })
  visit: Visit;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text' })
  header: string;

  @Column({ type: 'text' })
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
