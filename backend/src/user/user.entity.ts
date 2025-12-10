import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';
import { Report } from '../reports/report.entity';
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';

export enum UserRole {
  USER = 'ROLE_USER',
  ADMIN = 'ROLE_ADMIN',
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
  // ✅ RELATIONS INVERSÉES
  // =========================

  @OneToMany(() => Mission, mission => mission.user)
  missions: Mission[];

  @OneToMany(() => Visit, visit => visit.user)
  visits: Visit[];

  @OneToMany(() => Report, report => report.user)
  reports: Report[];

  // =========================
  // ✅ DATES AUTO
  // =========================

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
