import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, OneToOne } from 'typeorm';
import { User } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';

@Entity('visits')
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  missionId: string;

  @OneToOne(() => Mission)
  @JoinColumn({ name: 'missionId' })
  mission: Mission;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'timestamp' })
  visitDate: Date;

  @Column({ type: 'json', nullable: true })
  photos: {
    id: string;
    uri: string;
    analysis: {
      observation: string;
      recommendation: string;
      riskLevel: 'faible' | 'moyen' | 'eleve';
      confidence: number;
    };
    comment?: string;
    validated: boolean;
  }[];

  @Column({ type: 'int', default: 0 })
  photoCount: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ default: false })
  reportGenerated: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
