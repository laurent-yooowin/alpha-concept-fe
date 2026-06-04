import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';
import { Report } from '../reports/report.entity';
import { Organization } from '../organizations/organization.entity';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

export enum UserRole {
  USER = 'ROLE_USER',
  ADMIN = 'ROLE_ADMIN',
  HYPER_ADMIN = 'ROLE_HYPER_ADMIN',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  company: string;

  @Column({ nullable: true, type: 'int' })
  experience: number;

  @Column({ default: true })
  isActive: boolean;

  // =========================
  // ✅ MULTI-TENANT
  // =========================

  @Index()
  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization | null;

  // Per-module permissions. Null = use role-based defaults (ADMIN_FULL / COORDINATOR).
  @Column({ type: 'json', nullable: true })
  permissions: Record<string, 'none' | 'read' | 'write'> | null;

  // =========================
  // ✅ RELATIONS INVERSÉES
  // =========================

  @OneToMany(() => Mission, mission => mission.user)
  missions: Mission[];

  @OneToMany(() => Visit, visit => visit.user)
  visits: Visit[];

  @OneToMany(() => Report, report => report.user)
  reports: Report[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
