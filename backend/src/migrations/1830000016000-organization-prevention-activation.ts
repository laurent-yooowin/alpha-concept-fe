import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationPreventionActivation1830000016000 implements MigrationInterface {
  name = 'OrganizationPreventionActivation1830000016000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `organizations` ADD `preventionEnabled` tinyint NOT NULL DEFAULT 0",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `organizations` DROP COLUMN `preventionEnabled`",
    );
  }
}
