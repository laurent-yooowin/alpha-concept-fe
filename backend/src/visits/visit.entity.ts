import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, OneToOne, Index } from 'typeorm';
import { User } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';
import { Report } from '../reports/report.entity';
import { Organization } from '../organizations/organization.entity';

@Entity('visits')
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization | null;

  // =========================
  // ✅ RELATION AVEC MISSION (ManyToOne)
  // =========================

  @Column('uuid')
  missionId: string;

  @ManyToOne(() => Mission, mission => mission.visits, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'missionId' })
  mission: Mission;

  // =========================
  // ✅ RELATION AVEC USER
  // =========================

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, user => user.visits, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  // =========================
  // ✅ RELATION AVEC REPORT (OneToMany ✅)
  // =========================

  @OneToOne(() => Report, report => report.visit, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  report: Report;

  // =========================
  // ✅ DONNÉES MÉTIER
  // =========================

  @Column({ type: 'timestamp' })
  visitDate: Date;

  @Column({ type: 'json', nullable: true })
  photos: {
    id: string;
    uri: string;
    s3Url?: string;
    groupId?: string;
    isDirectiveOnly?: boolean;
    isDetailPhoto?: boolean;
    isReadabilityPhoto?: boolean;
    detailContext?: string;
    analysis: {
      observation: string;
      recommendation: string;
      riskLevel: 'faible' | 'moyen' | 'eleve';
      confidence: number;
      photoConformity?: boolean;
      photoConformityMessage?: string;
      references?: string;
      unreadableSections?: string[];
    };
    comment?: string;
    userDirectives?: string;
    validated: boolean;
  }[];

  @Column({ type: 'int', default: 0 })
  photoCount: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ default: false })
  reportGenerated: boolean;

  // =========================
  // ✅ DATES AUTO
  // =========================

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
