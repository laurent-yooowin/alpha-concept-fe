import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';

export enum ReportStatus {
  DRAFT = 'brouillon',
  SENT = 'envoye',
  ARCHIVED = 'archive',
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  missionId: string;

  @ManyToOne(() => Mission)
  @JoinColumn({ name: 'missionId' })
  mission: Mission;

  @Column('uuid', { nullable: true })
  visitId: string;

  @ManyToOne(() => Visit, { nullable: true })
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
