import { MigrationInterface, QueryRunner } from 'typeorm';

export class MailingListPerMission1830000005000 implements MigrationInterface {
  name = 'MailingListPerMission1830000005000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`mailing_list_entries\` ADD COLUMN \`missionId\` varchar(36) NULL`);
    await q.query(`CREATE INDEX \`IDX_mailing_list_mission\` ON \`mailing_list_entries\`(\`missionId\`)`);
    await q.query(`DROP INDEX \`UQ_mailing_list_org_email\` ON \`mailing_list_entries\``);
    await q.query(`CREATE UNIQUE INDEX \`UQ_mailing_list_org_mission_email\` ON \`mailing_list_entries\`(\`organizationId\`, \`missionId\`, \`email\`)`);
    await q.query(`ALTER TABLE \`mailing_list_entries\` ADD CONSTRAINT \`FK_mailing_list_mission\` FOREIGN KEY (\`missionId\`) REFERENCES \`missions\`(\`id\`) ON DELETE CASCADE`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`mailing_list_entries\` DROP FOREIGN KEY \`FK_mailing_list_mission\``);
    await q.query(`DROP INDEX \`UQ_mailing_list_org_mission_email\` ON \`mailing_list_entries\``);
    await q.query(`CREATE UNIQUE INDEX \`UQ_mailing_list_org_email\` ON \`mailing_list_entries\`(\`organizationId\`, \`email\`)`);
    await q.query(`DROP INDEX \`IDX_mailing_list_mission\` ON \`mailing_list_entries\``);
    await q.query(`ALTER TABLE \`mailing_list_entries\` DROP COLUMN \`missionId\``);
  }
}
