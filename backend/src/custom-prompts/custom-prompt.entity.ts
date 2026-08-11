import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MissionType } from '../missions/mission.dto';
import { Organization } from '../organizations/organization.entity';
import { User } from '../user/user.entity';

@Entity('custom_prompts')
@Index('IDX_custom_prompts_scope', ['organizationId', 'missionType', 'isActive'])
export class CustomPrompt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_custom_prompts_organization')
  @Column('uuid')
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column({ length: 150 })
  name: string;

  @Column({ type: 'enum', enum: MissionType })
  missionType: MissionType;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ type: 'int', default: 0 })
  displayOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @Column('uuid', { nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
