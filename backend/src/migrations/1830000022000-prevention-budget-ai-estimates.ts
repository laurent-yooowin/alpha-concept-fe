import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionBudgetAiEstimates1830000022000 implements MigrationInterface {
  name = 'PreventionBudgetAiEstimates1830000022000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE prevention_budget_items
      ADD COLUMN aiEstimateDetails JSON NULL AFTER justification`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Preserve generated explanations during a rollback; the old application
    // ignores this archival column, and a later forward migration can add the
    // active column again without discarding the audit payload.
    await queryRunner.query(`ALTER TABLE prevention_budget_items
      CHANGE COLUMN aiEstimateDetails aiEstimateDetails_rollback JSON NULL`);
  }
}
