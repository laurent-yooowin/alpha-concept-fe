import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionScopedRebuild1830000038000 implements MigrationInterface {
  name = 'PreventionScopedRebuild1830000038000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `prevention_scheduler_checkpoints` ADD COLUMN `scopeDigest` varchar(64) NULL, ADD COLUMN `scopeMissionIds` json NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `prevention_scheduler_checkpoints` DROP COLUMN `scopeMissionIds`, DROP COLUMN `scopeDigest`');
  }
}
