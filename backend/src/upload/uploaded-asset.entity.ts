import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum UploadedAssetGeneration {
  VERIFIED_V1 = 'VERIFIED_V1',
  LEGACY_LINKED = 'LEGACY_LINKED',
  LEGACY_UNRESOLVED = 'LEGACY_UNRESOLVED',
  LEGACY_AMBIGUOUS = 'LEGACY_AMBIGUOUS',
}

export enum UploadedAssetType {
  PHOTO = 'PHOTO',
  REPORT_PDF = 'REPORT_PDF',
  REPORT_FILE = 'REPORT_FILE',
  ORGANIZATION_LOGO = 'ORGANIZATION_LOGO',
  ORGANIZATION_BACKGROUND = 'ORGANIZATION_BACKGROUND',
  GENERIC = 'GENERIC',
}

export enum UploadedAssetStatus {
  ACTIVE = 'ACTIVE',
  DETACHED = 'DETACHED',
}

@Entity('uploaded_assets')
@Index('UQ_uploaded_assets_org_key', ['organizationId', 's3Key'], { unique: true })
@Index('IDX_uploaded_assets_generation', ['generation', 'status'])
@Index('IDX_uploaded_assets_org_type', ['organizationId', 'objectType', 'status'])
export class UploadedAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid', { nullable: true })
  uploaderId: string | null;

  @Column({ length: 512 })
  s3Key: string;

  @Column({ type: 'enum', enum: UploadedAssetType })
  objectType: UploadedAssetType;

  @Column({ type: 'enum', enum: UploadedAssetGeneration })
  generation: UploadedAssetGeneration;

  @Column({ type: 'enum', enum: UploadedAssetStatus, default: UploadedAssetStatus.ACTIVE })
  status: UploadedAssetStatus;

  @Column({ type: 'uuid', nullable: true })
  visitId: string | null;

  @Column({ type: 'uuid', nullable: true })
  reportId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceRef: string | null;

  @Column({ type: 'json', nullable: true })
  sourceMetadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
