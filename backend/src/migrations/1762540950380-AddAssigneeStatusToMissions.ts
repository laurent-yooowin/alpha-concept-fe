import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAssigneeStatusToMissions1762540950380 implements MigrationInterface {
    name = 'AddAssigneeStatusToMissions1762540950380'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`status\` \`status\` enum ('planifiee', 'assignee', 'en_cours', 'terminee', 'validee') NOT NULL DEFAULT 'planifiee'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`status\` \`status\` enum ('planifiee', 'en_cours', 'terminee', 'validee') NOT NULL DEFAULT 'planifiee'`);
    }

}
