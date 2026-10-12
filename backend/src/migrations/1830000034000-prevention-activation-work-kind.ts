import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionActivationWorkKind1830000034000 implements MigrationInterface {
  name = 'PreventionActivationWorkKind1830000034000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_scheduler_runs
      MODIFY workKind enum('AUTOMATIC','ACTIVATION','ADMIN_RECONSTRUCTION','BUDGET') NOT NULL DEFAULT 'AUTOMATIC'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE prevention_scheduler_runs SET workKind='AUTOMATIC' WHERE workKind='ACTIVATION'`);
    await q.query(`ALTER TABLE prevention_scheduler_runs
      MODIFY workKind enum('AUTOMATIC','ADMIN_RECONSTRUCTION','BUDGET') NOT NULL DEFAULT 'AUTOMATIC'`);
  }
}
