import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationLegalValidation1830000006000 implements MigrationInterface {
  name = 'OrganizationLegalValidation1830000006000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`organizations\` ADD COLUMN \`legalValidationStatus\` varchar(32) NOT NULL DEFAULT 'termine'`);
    await q.query(`ALTER TABLE \`organizations\` ADD COLUMN \`legalValidationRequestedAt\` datetime NULL`);
    await q.query(`ALTER TABLE \`organizations\` ADD COLUMN \`legalValidationValidatedAt\` datetime NULL`);
    await q.query(`ALTER TABLE \`organizations\` ADD COLUMN \`legalValidationRequestedByEmail\` varchar(255) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`organizations\` DROP COLUMN \`legalValidationRequestedByEmail\``);
    await q.query(`ALTER TABLE \`organizations\` DROP COLUMN \`legalValidationValidatedAt\``);
    await q.query(`ALTER TABLE \`organizations\` DROP COLUMN \`legalValidationRequestedAt\``);
    await q.query(`ALTER TABLE \`organizations\` DROP COLUMN \`legalValidationStatus\``);
  }
}
