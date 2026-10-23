import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stores the exact multiselect scope while retaining legacy scalar columns. */
export class PreventionBudgetMultiselect1830000040000 implements MigrationInterface {
  name = 'PreventionBudgetMultiselect1830000040000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_budget_scenarios
      ADD COLUMN missionIds JSON NULL AFTER missionId,
      ADD COLUMN categoryIds JSON NULL AFTER categoryId,
      ADD COLUMN severities JSON NULL AFTER severity`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE prevention_budget_scenarios DROP COLUMN severities, DROP COLUMN categoryIds, DROP COLUMN missionIds');
  }
}
