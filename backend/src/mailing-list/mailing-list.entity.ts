import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Mission } from '../missions/mission.entity';

@Entity('mailing_list_entries')
@Unique('UQ_mailing_list_org_mission_email', ['organizationId', 'missionId', 'email'])
export class MailingListEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  organizationId: string;

  @Index()
  @Column('uuid', { nullable: true })
  missionId: string | null;

  @ManyToOne(() => Mission, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'missionId' })
  mission: Mission | null;

  @Column({ length: 255 })
  email: string;

  @Column({ length: 255, nullable: true })
  name: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
