import { MigrationInterface, QueryRunner } from 'typeorm';

export class UploadedAssetsRegistry1830000021000 implements MigrationInterface {
  name = 'UploadedAssetsRegistry1830000021000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE uploaded_assets (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        uploaderId varchar(36) NULL,
        s3Key varchar(512) NOT NULL,
        objectType enum('PHOTO','REPORT_PDF','REPORT_FILE','ORGANIZATION_LOGO','ORGANIZATION_BACKGROUND','GENERIC') NOT NULL,
        generation enum('VERIFIED_V1','LEGACY_LINKED','LEGACY_UNRESOLVED','LEGACY_AMBIGUOUS') NOT NULL,
        status enum('ACTIVE','DETACHED') NOT NULL DEFAULT 'ACTIVE',
        visitId varchar(36) NULL,
        reportId varchar(36) NULL,
        sourceRef varchar(64) NULL,
        sourceMetadata json NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX UQ_uploaded_assets_org_key (organizationId,s3Key),
        INDEX IDX_uploaded_assets_generation (generation,status),
        INDEX IDX_uploaded_assets_org_type (organizationId,objectType,status),
        INDEX IDX_uploaded_assets_org_visit (organizationId,visitId),
        INDEX IDX_uploaded_assets_org_report (organizationId,reportId),
        CONSTRAINT FK_uploaded_assets_org FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT FK_uploaded_assets_uploader FOREIGN KEY (uploaderId) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT FK_uploaded_assets_visit FOREIGN KEY (organizationId,visitId) REFERENCES visits(organizationId,id) ON DELETE CASCADE,
        CONSTRAINT FK_uploaded_assets_report FOREIGN KEY (organizationId,reportId) REFERENCES reports(organizationId,id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE uploaded_assets');
  }
}
