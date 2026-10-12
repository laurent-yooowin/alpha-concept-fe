import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionBudgetSeverity1830000023000 implements MigrationInterface {
  name = 'PreventionBudgetSeverity1830000023000';

  async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE prevention_budget_scenarios ADD COLUMN severity varchar(16) NULL AFTER categoryId");
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE prevention_budget_scenarios DROP COLUMN severity');
  }
}
