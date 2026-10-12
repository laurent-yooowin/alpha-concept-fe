import { MigrationInterface, QueryRunner } from 'typeorm';

/** Track which group analyses belong to a confirmed full Hyper Admin recovery. */
export class PreventionGroupRecoveryRun1830000036000 implements MigrationInterface {
  name = 'PreventionGroupRecoveryRun1830000036000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE prevention_group_processing_jobs ADD COLUMN recoveryRunId varchar(36) NULL');
    await q.query('CREATE INDEX IDX_prevention_group_processing_recovery ON prevention_group_processing_jobs (organizationId,recoveryRunId,processingStatus)');
    await q.query('ALTER TABLE prevention_hyper_admin_recovery_runs ADD COLUMN expectedGroupCount int unsigned NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE prevention_hyper_admin_recovery_runs DROP COLUMN expectedGroupCount');
    await q.query('DROP INDEX IDX_prevention_group_processing_recovery ON prevention_group_processing_jobs');
    await q.query('ALTER TABLE prevention_group_processing_jobs DROP COLUMN recoveryRunId');
  }
}
