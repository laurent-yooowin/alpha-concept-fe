import { MigrationInterface, QueryRunner } from 'typeorm';

export class MailingList1830000004000 implements MigrationInterface {
  name = 'MailingList1830000004000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`mailing_list_entries\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`email\` varchar(255) NOT NULL,
        \`name\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_mailing_list_org_email\` (\`organizationId\`, \`email\`),
        INDEX \`IDX_mailing_list_org\` (\`organizationId\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE \`mailing_list_entries\``);
  }
}