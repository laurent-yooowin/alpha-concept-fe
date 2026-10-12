import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Targeted budget recalculation creates an auditable scenario action. The
 * original enum predates that action, so this migration extends it and adds a
 * durable marker for terminal targeted drafts.
 */
export class PreventionBudgetItemRetry1830000028000 implements MigrationInterface {
  name = 'PreventionBudgetItemRetry1830000028000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_budget_scenarios
      ADD COLUMN failedAt datetime(6) NULL AFTER status`);
    await q.query(`ALTER TABLE prevention_budget_audit
      MODIFY COLUMN action enum('BUILD','RECALCULATE','RECALCULATE_ITEM','REFRESH_ITEM','RECONCILE') NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query(`SELECT COUNT(*) count FROM prevention_budget_audit WHERE action='RECALCULATE_ITEM'`);
    if (Number(row?.count ?? 0) > 0) {
      throw new Error('Cannot remove RECALCULATE_ITEM while targeted budget audit rows exist');
    }
    await q.query(`ALTER TABLE prevention_budget_audit
      MODIFY COLUMN action enum('BUILD','RECALCULATE','REFRESH_ITEM','RECONCILE') NOT NULL`);
    await q.query('ALTER TABLE prevention_budget_scenarios DROP COLUMN failedAt');
  }
}
