import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum VisitPhotoAssetStatus {
  UPLOADED = 'UPLOADED',
  ATTACHED = 'ATTACHED',
  DETACHED = 'DETACHED',
}

@Entity('visit_photo_assets')
@Index('UQ_visit_photo_assets_org_key', ['organizationId', 's3Key'], { unique: true })
@Index('UQ_visit_photo_assets_org_nonce', ['organizationId', 'receiptNonce'], { unique: true })
@Index('IDX_visit_photo_assets_org_visit_group', ['organizationId', 'visitId', 'groupId'])
export class VisitPhotoAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  uploaderId: string;

  @Column('uuid', { nullable: true })
  visitId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  groupId: string | null;

  @Column({ type: 'varchar', length: 512 })
  s3Key: string;

  @Column({ type: 'char', length: 36 })
  receiptNonce: string;

  @Column({ type: 'datetime', precision: 6 })
  receiptIssuedAt: Date;

  @Column({ type: 'datetime', precision: 6 })
  receiptExpiresAt: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  attachedAt: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  detachedAt: Date | null;

  @Column({ type: 'enum', enum: VisitPhotoAssetStatus, default: VisitPhotoAssetStatus.UPLOADED })
  status: VisitPhotoAssetStatus;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
