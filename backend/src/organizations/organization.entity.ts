import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Index({ unique: true })
  @Column({ length: 100 })
  slug: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logoS3Key: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  backgroundImageS3Key: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  primaryColor: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  secondaryColor: string | null;

  @Column({ type: 'text', nullable: true })
  cguContent: string | null;

  @Column({ type: 'text', nullable: true })
  privacyContent: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  loginTitle: string | null;

  @Column({ type: 'text', nullable: true })
  loginContent: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contactEmail: string | null;

  @Column({ type: 'varchar', length: 32, default: 'termine' })
  legalValidationStatus: 'en_cours' | 'termine';

  @Column({ type: 'datetime', nullable: true })
  legalValidationRequestedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  legalValidationValidatedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  legalValidationRequestedByEmail: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
