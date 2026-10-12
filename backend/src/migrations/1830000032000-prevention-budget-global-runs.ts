import { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable annual checkpoints for GLOBAL_YEARLY budget commands. */
export class PreventionBudgetGlobalRuns1830000032000 implements MigrationInterface {
  name = 'PreventionBudgetGlobalRuns1830000032000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE prevention_budget_global_runs (
      id varchar(36) NOT NULL,
      organizationId varchar(36) NOT NULL,
      scenarioKey char(64) NOT NULL,
      sourceVersion varchar(64) NOT NULL,
      status enum('PENDING','PROCESSING','PUBLISHED','FAILED') NOT NULL DEFAULT 'PENDING',
      mode enum('GLOBAL_YEARLY') NOT NULL DEFAULT 'GLOBAL_YEARLY',
      executionMode enum('IMMEDIATE','SCHEDULED') NOT NULL DEFAULT 'SCHEDULED',
      filters json NOT NULL,
      adminPrompt text NULL,
      finalScenarioId varchar(36) NULL,
      currentYear int NULL,
      lastError varchar(1000) NULL,
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE INDEX UQ_prevention_budget_global_runs_org_id (organizationId,id),
      INDEX IDX_prevention_budget_global_runs_org_key (organizationId,scenarioKey),
      INDEX IDX_prevention_budget_global_runs_org_status (organizationId,status),
      CONSTRAINT FK_prevention_budget_global_runs_org FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT FK_prevention_budget_global_runs_final FOREIGN KEY (organizationId,finalScenarioId)
        REFERENCES prevention_budget_scenarios(organizationId,id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
    await q.query(`CREATE TABLE prevention_budget_global_years (
      id varchar(36) NOT NULL,
      runId varchar(36) NOT NULL,
      organizationId varchar(36) NOT NULL,
      year smallint unsigned NOT NULL,
      status enum('PENDING','PROCESSING','CALCULATED','FAILED') NOT NULL DEFAULT 'PENDING',
      scenarioId varchar(36) NULL,
      attempts int unsigned NOT NULL DEFAULT 0,
      lockedAt datetime(6) NULL,
      lockedBy varchar(100) NULL,
      completedAt datetime(6) NULL,
      lastError varchar(1000) NULL,
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE INDEX UQ_prevention_budget_global_years_run_year (runId,year),
      INDEX IDX_prevention_budget_global_years_run_status (runId,status,year),
      INDEX IDX_prevention_budget_global_years_due (organizationId,status,year),
      CONSTRAINT FK_prevention_budget_global_years_run_org FOREIGN KEY (organizationId,runId)
        REFERENCES prevention_budget_global_runs(organizationId,id) ON DELETE CASCADE,
      CONSTRAINT FK_prevention_budget_global_years_scenario FOREIGN KEY (organizationId,scenarioId)
        REFERENCES prevention_budget_scenarios(organizationId,id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE prevention_budget_global_years');
    await q.query('DROP TABLE prevention_budget_global_runs');
  }
}
