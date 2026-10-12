import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionBudgetClientScope1830000025000 implements MigrationInterface {
  name = 'PreventionBudgetClientScope1830000025000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_budget_scenarios
      ADD COLUMN clientKeys JSON NULL AFTER severity,
      ADD COLUMN adminPrompt TEXT NULL AFTER clientKeys,
      ADD COLUMN adminPromptActorId varchar(36) NULL AFTER adminPrompt`);
    await q.query(`ALTER TABLE prevention_budget_items
      ADD COLUMN clientKey varchar(64) NULL AFTER categoryKey,
      ADD COLUMN clientLabel varchar(255) NULL AFTER clientKey`);
    await q.query('CREATE INDEX IDX_prev_budget_item_org_client ON prevention_budget_items (organizationId,clientKey)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IDX_prev_budget_item_org_client ON prevention_budget_items');
    await q.query('ALTER TABLE prevention_budget_items DROP COLUMN clientLabel, DROP COLUMN clientKey');
    await q.query('ALTER TABLE prevention_budget_scenarios DROP COLUMN adminPromptActorId, DROP COLUMN adminPrompt, DROP COLUMN clientKeys');
  }
}
