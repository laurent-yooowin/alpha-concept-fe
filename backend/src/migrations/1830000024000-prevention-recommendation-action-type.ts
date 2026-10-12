import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionRecommendationActionType1830000024000 implements MigrationInterface {
  name = 'PreventionRecommendationActionType1830000024000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE prevention_group_processing_jobs ADD COLUMN recommendationOverrides JSON NULL AFTER riskAssessments');
    await q.query(`ALTER TABLE prevention_findings
      ADD COLUMN actionType varchar(48) NULL AFTER confidence,
      ADD COLUMN actionTypeConfidence decimal(5,2) NULL AFTER actionType,
      ADD COLUMN actionTypeVersion varchar(16) NULL AFTER actionTypeConfidence`);
    await q.query(`CREATE INDEX IDX_prevention_findings_org_action_date
      ON prevention_findings (organizationId,actionType,businessDate)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IDX_prevention_findings_org_action_date ON prevention_findings');
    await q.query(`ALTER TABLE prevention_findings
      DROP COLUMN actionTypeVersion,
      DROP COLUMN actionTypeConfidence,
      DROP COLUMN actionType`);
    await q.query('ALTER TABLE prevention_group_processing_jobs DROP COLUMN recommendationOverrides');
  }
}
