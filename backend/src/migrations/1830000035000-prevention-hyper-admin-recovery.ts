import { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable orchestration state for the Hyper Admin tenant catch-up flow. */
export class PreventionHyperAdminRecovery1830000035000 implements MigrationInterface {
  name = 'PreventionHyperAdminRecovery1830000035000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE prevention_hyper_admin_recovery_runs (
      id varchar(36) NOT NULL,
      organizationId varchar(36) NOT NULL,
      status enum('PENDING','PROCESSING','SCHEDULED','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
      executionMode enum('IMMEDIATE','SCHEDULED') NOT NULL DEFAULT 'SCHEDULED',
      scheduledFor datetime(6) NULL,
      extractionRunId varchar(36) NULL,
      budgetRunId varchar(36) NULL,
      stage enum('EXTRACTION','GROUPS','BUDGET','COMPLETED','FAILED') NOT NULL DEFAULT 'EXTRACTION',
      failedStage enum('EXTRACTION','GROUPS','BUDGET') NULL,
      groupCursor varchar(36) NULL,
      reportCount int unsigned NOT NULL DEFAULT 0,
      findingCount int unsigned NOT NULL DEFAULT 0,
      immediateAllowed tinyint NOT NULL DEFAULT 0,
      sourceVersion char(64) NOT NULL,
      rawSourceVersion char(64) NULL,
      confirmationDigest char(64) NOT NULL,
      leaseOwner varchar(100) NULL,
      leaseUntil datetime(6) NULL,
      lastError varchar(1000) NULL,
      createdBy varchar(36) NULL,
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE INDEX UQ_prevention_hyper_recovery_digest (organizationId,confirmationDigest),
      INDEX IDX_prevention_hyper_recovery_org_status (organizationId,status,createdAt),
      INDEX IDX_prevention_hyper_recovery_lease (status,leaseUntil),
      CONSTRAINT FK_prevention_hyper_recovery_org FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE prevention_hyper_admin_recovery_runs');
  }
}
