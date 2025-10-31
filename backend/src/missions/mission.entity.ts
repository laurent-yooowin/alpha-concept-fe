import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../user/user.entity';

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

  @Column({ length: 100 })
  type: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 50, default: 'planifiee' })
  status: string;

  @Column({ length: 255, nullable: true })
  contactFirstName: string;

  @Column({ length: 255, nullable: true })
  contactLastName: string;

  @Column({ length: 255, nullable: true })
  contactEmail: string;

  @Column({ length: 50, nullable: true })
  contactPhone: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
