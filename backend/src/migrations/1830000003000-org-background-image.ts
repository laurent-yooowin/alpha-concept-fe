import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrgBackgroundImage1830000003000 implements MigrationInterface {
  name = 'OrgBackgroundImage1830000003000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE \`organizations\` ADD COLUMN \`backgroundImageS3Key\` varchar(500) NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE \`organizations\` DROP COLUMN \`backgroundImageS3Key\``,
    );
  }
}