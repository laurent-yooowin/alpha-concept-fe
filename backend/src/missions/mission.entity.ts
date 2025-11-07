import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../user/user.entity';

export enum MissionType {
  CSPS = "CSPS",
  AEU = "AEU",
  Divers = "Divers",
}

export enum MissionStatus {
  PLANIFIED = 'planifiee',
  IN_PROGRESS = 'en_cours',
  TERMINATED = 'terminee',
  VALIDATED = 'validee',
}

@Entity('missions')
export class Mission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  client: string;

  @Column({ type: 'text', nullable: true })
  refClient: string;

  @Column({ type: 'text' })
  address: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ length: 10 })
  time: string;

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

  @Column({ length: 50, nullable: true })
  contactPhone: string;

  @Column('uuid', { nullable: true })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ default: false })
  imported: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
