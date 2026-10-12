import { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable, tenant-scoped report/action prices shared by overlapping budget scopes. */
export class PreventionBudgetReportEstimates1830000037000 implements MigrationInterface {
  name = 'PreventionBudgetReportEstimates1830000037000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE prevention_budget_report_estimates (
      id varchar(36) NOT NULL,
      organizationId varchar(36) NOT NULL,
      itemKey char(64) NOT NULL,
      reportId varchar(36) NOT NULL,
      inputHash char(64) NOT NULL,
      requestEpochMs bigint unsigned NOT NULL,
      requestOrder bigint unsigned NOT NULL DEFAULT 0,
      estimate json NOT NULL,
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      INDEX IDX_prevention_budget_report_estimates_lookup
        (organizationId,itemKey,reportId,inputHash,requestOrder),
      CONSTRAINT FK_prevention_budget_report_estimates_org
        FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await q.query(`CREATE TABLE prevention_budget_estimate_sequence (
      organizationId varchar(36) NOT NULL,
      requestOrder bigint unsigned NOT NULL,
      PRIMARY KEY (organizationId),
      CONSTRAINT FK_prevention_budget_estimate_sequence_org
        FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE prevention_budget_estimate_sequence');
    await q.query('DROP TABLE prevention_budget_report_estimates');
  }
}
