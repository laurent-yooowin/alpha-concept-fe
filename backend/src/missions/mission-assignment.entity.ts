import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Mission } from './mission.entity';
import { User } from '../user/user.entity';
import { Organization } from '../organizations/organization.entity';

@Entity('mission_assignments')
export class MissionAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization | null;

  @Column('uuid')
  missionId: string;

  @ManyToOne(() => Mission)
  @JoinColumn({ name: 'missionId' })
  mission: Mission;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column('uuid')
  assignedBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'assignedBy' })
  assignedByUser: User;

  @Column({ default: false })
  notified: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
