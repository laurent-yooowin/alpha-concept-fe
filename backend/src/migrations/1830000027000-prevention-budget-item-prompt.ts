import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionBudgetItemPrompt1830000027000 implements MigrationInterface {
  name = 'PreventionBudgetItemPrompt1830000027000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_budget_items
      ADD COLUMN adminPrompt TEXT NULL AFTER aiEstimateDetails,
      ADD COLUMN adminPromptActorId varchar(36) NULL AFTER adminPrompt`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE prevention_budget_items DROP COLUMN adminPromptActorId, DROP COLUMN adminPrompt');
  }
}
