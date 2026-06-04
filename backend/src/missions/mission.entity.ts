import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { User } from '../user/user.entity';
import { MissionStatus, MissionType } from './mission.dto';
import { Visit } from '../visits/visit.entity';
import { Report } from '../reports/report.entity';
import { Organization } from '../organizations/organization.entity';


@Entity('missions')
export class Mission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization | null;

  @Column()
  title: string;

  @Column()
  client: string;

  @Column({ type: 'text', nullable: true })
  refClient: string;

  @Column({ type: 'text' })
  address: string;

  @Column({ type: 'date', nullable: true })
  date: Date;

  @Column({ length: 10, nullable: true })
  time: string;

  @Column({ type: 'date', nullable: true })
  endDate: Date;

  @Column({
    type: 'enum',
    enum: MissionType,
    default: MissionType.CSPS
  })
  type: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: MissionStatus,
    default: MissionStatus.PLANIFIED
  })
  status: string;

  @Column({ length: 255, nullable: true })
  contactFirstName: string;

  @Column({ length: 255, nullable: true })
  contactLastName: string;

  @Column({ length: 255, nullable: true })
  contactEmail: string;

  @Column({ length: 255, nullable: true })
  refBusiness: string;

  @Column({ length: 50, nullable: true })
  contactPhone: string;

  // =========================
  // ✅ RELATION AVEC USER
  // =========================

  @Column('uuid', { nullable: true })
  userId: string;

  @ManyToOne(() => User, user => user.missions, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // =========================
  // ✅ RELATIONS CORRIGÉES ManyToOne → OneToMany
  // =========================

  @OneToMany(() => Visit, visit => visit.mission)
  visits: Visit[];

  @OneToMany(() => Report, report => report.mission)
  reports: Report[];

  // =========================

  @Column({ default: false })
  imported: boolean;

  @Column({ default: false })
  assigned: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
