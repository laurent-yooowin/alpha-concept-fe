import { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable page checkpoints for the AI part of a global budget year. */
export class PreventionBudgetGlobalEstimateCheckpoints1830000033000 implements MigrationInterface {
  name = 'PreventionBudgetGlobalEstimateCheckpoints1830000033000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_budget_global_runs
      MODIFY COLUMN status enum('PENDING','PROCESSING','SUSPENDED','PUBLISHED','FAILED') NOT NULL DEFAULT 'PENDING'`);
    await q.query(`ALTER TABLE prevention_budget_global_years
      MODIFY COLUMN status enum('PENDING','PROCESSING','SUSPENDED','CALCULATED','FAILED') NOT NULL DEFAULT 'PENDING',
      ADD COLUMN estimateCursor int unsigned NOT NULL DEFAULT 0 AFTER attempts,
      ADD COLUMN estimateCount int unsigned NOT NULL DEFAULT 0 AFTER estimateCursor,
      ADD COLUMN availableAt datetime(6) NULL AFTER estimateCount`);
    await q.query(`ALTER TABLE prevention_budget_scenarios
      ADD COLUMN executionStatus enum('PENDING','PROCESSING','SUSPENDED','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING' AFTER status,
      ADD COLUMN estimateCursor int unsigned NOT NULL DEFAULT 0 AFTER executionStatus,
      ADD COLUMN estimateCount int unsigned NOT NULL DEFAULT 0 AFTER estimateCursor,
      ADD COLUMN availableAt datetime(6) NULL AFTER estimateCount,
      ADD COLUMN lastError varchar(1000) NULL AFTER availableAt`);
    await q.query(`CREATE TABLE prevention_budget_global_estimates (
      id varchar(36) NOT NULL,
      runId varchar(36) NOT NULL,
      year smallint unsigned NOT NULL,
      organizationId varchar(36) NOT NULL,
      itemKey varchar(128) NOT NULL,
      reportId varchar(36) NOT NULL,
      sourceVersion varchar(64) NOT NULL,
      estimate json NOT NULL,
      completedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE INDEX UQ_prevention_budget_global_estimates_key (organizationId,runId,year,itemKey,reportId),
      INDEX IDX_prevention_budget_global_estimates_cursor (organizationId,runId,year,completedAt),
      CONSTRAINT FK_prevention_budget_global_estimates_run_org
        FOREIGN KEY (organizationId,runId) REFERENCES prevention_budget_global_runs(organizationId,id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await q.query(`CREATE TABLE prevention_budget_estimate_checkpoints (
      id varchar(36) NOT NULL,
      runId varchar(36) NOT NULL,
      scenarioId varchar(36) NOT NULL,
      organizationId varchar(36) NOT NULL,
      itemKey varchar(128) NOT NULL,
      reportId varchar(36) NOT NULL,
      sourceVersion varchar(64) NOT NULL,
      estimate json NOT NULL,
      completedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE INDEX UQ_prevention_budget_estimate_checkpoints_key (organizationId,runId,scenarioId,itemKey,reportId),
      INDEX IDX_prevention_budget_estimate_checkpoints_cursor (organizationId,runId,scenarioId,completedAt),
      CONSTRAINT FK_prevention_budget_estimate_checkpoints_org FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT FK_prevention_budget_estimate_checkpoints_scenario
        FOREIGN KEY (organizationId,scenarioId) REFERENCES prevention_budget_scenarios(organizationId,id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE prevention_budget_estimate_checkpoints');
    await q.query('DROP TABLE prevention_budget_global_estimates');
    await q.query("UPDATE prevention_budget_global_years SET status='PENDING' WHERE status='SUSPENDED'");
    await q.query("UPDATE prevention_budget_global_runs SET status='PENDING' WHERE status='SUSPENDED'");
    await q.query(`ALTER TABLE prevention_budget_global_years
      DROP COLUMN estimateCount,
      DROP COLUMN estimateCursor,
      DROP COLUMN availableAt,
      MODIFY COLUMN status enum('PENDING','PROCESSING','CALCULATED','FAILED') NOT NULL DEFAULT 'PENDING'`);
    await q.query(`ALTER TABLE prevention_budget_global_runs
      MODIFY COLUMN status enum('PENDING','PROCESSING','PUBLISHED','FAILED') NOT NULL DEFAULT 'PENDING'`);
    await q.query(`ALTER TABLE prevention_budget_scenarios
      DROP COLUMN lastError,
      DROP COLUMN availableAt,
      DROP COLUMN estimateCount,
      DROP COLUMN estimateCursor,
      DROP COLUMN executionStatus`);
  }
}
