import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppSettings1830000007000 implements MigrationInterface {
  name = 'AppSettings1830000007000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`app_settings\` (
        \`key\` varchar(100) NOT NULL,
        \`value\` longtext NULL,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE \`app_settings\``);
  }
}
