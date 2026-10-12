import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionRecommendationMetric1830000026000 implements MigrationInterface {
  name = 'PreventionRecommendationMetric1830000026000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_findings
      ADD COLUMN actionMetric JSON NULL AFTER actionTypeVersion`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE prevention_findings DROP COLUMN actionMetric');
  }
}
