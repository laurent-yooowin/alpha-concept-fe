import { MigrationInterface, QueryRunner } from 'typeorm';

export class VisitPhotoAssetsAndLlmQuota1830000020000 implements MigrationInterface {
  name = 'VisitPhotoAssetsAndLlmQuota1830000020000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE visit_photo_assets (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        uploaderId varchar(36) NOT NULL,
        visitId varchar(36) NULL,
        groupId varchar(100) NULL,
        s3Key varchar(512) NOT NULL,
        receiptNonce char(36) NOT NULL,
        receiptIssuedAt datetime(6) NOT NULL,
        receiptExpiresAt datetime(6) NOT NULL,
        attachedAt datetime(6) NULL,
        detachedAt datetime(6) NULL,
        status enum('UPLOADED','ATTACHED','DETACHED') NOT NULL DEFAULT 'UPLOADED',
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX UQ_visit_photo_assets_org_key (organizationId,s3Key),
        UNIQUE INDEX UQ_visit_photo_assets_org_nonce (organizationId,receiptNonce),
        INDEX IDX_visit_photo_assets_org_visit_group (organizationId,visitId,groupId),
        CONSTRAINT FK_visit_photo_assets_org FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT FK_visit_photo_assets_uploader FOREIGN KEY (uploaderId) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT FK_visit_photo_assets_visit FOREIGN KEY (organizationId,visitId) REFERENCES visits(organizationId,id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await q.query(`ALTER TABLE visit_analysis_requests ADD COLUMN userId varchar(36) NULL, ADD COLUMN quotaUnits int unsigned NOT NULL DEFAULT 1`);
    await q.query(`ALTER TABLE visit_analysis_requests ADD INDEX IDX_visit_analysis_requests_quota (organizationId,userId,createdAt)`);
    await q.query(`ALTER TABLE visit_analysis_requests ADD CONSTRAINT FK_visit_analysis_requests_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL`);
    await q.query(`
      CREATE TABLE llm_quota_events (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        userId varchar(36) NOT NULL,
        operation varchar(64) NOT NULL,
        units int unsigned NOT NULL DEFAULT 1,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX IDX_llm_quota_events_org_created (organizationId,createdAt),
        INDEX IDX_llm_quota_events_user_created (organizationId,userId,createdAt),
        CONSTRAINT FK_llm_quota_events_org FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT FK_llm_quota_events_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE visit_analysis_requests DROP FOREIGN KEY FK_visit_analysis_requests_user`);
    await q.query(`ALTER TABLE visit_analysis_requests DROP INDEX IDX_visit_analysis_requests_quota`);
    await q.query(`ALTER TABLE visit_analysis_requests DROP COLUMN quotaUnits, DROP COLUMN userId`);
    await q.query(`DROP TABLE visit_photo_assets`);
    await q.query(`DROP TABLE llm_quota_events`);
  }
}
