import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrgLoginCustomization1830000002000 implements MigrationInterface {
  name = 'OrgLoginCustomization1830000002000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`organizations\` ADD COLUMN \`privacyContent\` text NULL`);
    await q.query(`ALTER TABLE \`organizations\` ADD COLUMN \`loginTitle\` varchar(255) NULL`);
    await q.query(`ALTER TABLE \`organizations\` ADD COLUMN \`loginContent\` text NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`organizations\` DROP COLUMN \`loginContent\``);
    await q.query(`ALTER TABLE \`organizations\` DROP COLUMN \`loginTitle\``);
    await q.query(`ALTER TABLE \`organizations\` DROP COLUMN \`privacyContent\``);
  }
}