import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionBulkOrchestration1830000030000 implements MigrationInterface {
  name = 'PreventionBulkOrchestration1830000030000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE prevention_scheduler_runs
        MODIFY status enum('PENDING','PROCESSING','SCHEDULED','SUSPENDED','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
        ADD COLUMN reportCount int unsigned NOT NULL DEFAULT 0 AFTER enqueuedJobs,
        ADD COLUMN findingCount int unsigned NOT NULL DEFAULT 0 AFTER reportCount,
        ADD COLUMN immediateLimit int unsigned NOT NULL DEFAULT 0 AFTER findingCount,
        ADD COLUMN executionMode enum('IMMEDIATE','SCHEDULED') NOT NULL DEFAULT 'IMMEDIATE' AFTER immediateLimit,
        ADD COLUMN workKind enum('AUTOMATIC','ADMIN_RECONSTRUCTION','BUDGET') NOT NULL DEFAULT 'AUTOMATIC' AFTER executionMode
    `);
    await q.query(`
      CREATE TABLE prevention_scheduler_bulk_admission (
        id tinyint unsigned NOT NULL,
        organizationId varchar(36) NULL,
        runId varchar(36) NULL,
        workKind enum('AUTOMATIC','ADMIN_RECONSTRUCTION','BUDGET') NULL,
        leaseToken varchar(36) NULL,
        leaseExpiresAt datetime(6) NULL,
        availableAt datetime(6) NULL,
        lastError varchar(500) NULL,
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX IDX_prevention_scheduler_bulk_admission_expiry (leaseExpiresAt),
        CONSTRAINT FK_prevention_scheduler_bulk_admission_org FOREIGN KEY (organizationId)
          REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await q.query(`
      INSERT INTO prevention_scheduler_bulk_admission (id,availableAt)
      VALUES (1,UTC_TIMESTAMP(6))
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE prevention_scheduler_bulk_admission');
    await q.query(`UPDATE prevention_scheduler_runs SET status='PENDING' WHERE status IN ('SCHEDULED','SUSPENDED')`);
    await q.query(`
      ALTER TABLE prevention_scheduler_runs
        DROP COLUMN workKind,
        DROP COLUMN executionMode,
        DROP COLUMN immediateLimit,
        DROP COLUMN findingCount,
        DROP COLUMN reportCount,
        MODIFY status enum('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING'
    `);
  }
}
