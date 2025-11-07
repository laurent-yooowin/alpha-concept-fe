import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAssigneeStatusToMissions1762540890607 implements MigrationInterface {
    name = 'AddAssigneeStatusToMissions1762540890607'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`status\``);
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`status\` enum ('planifiee', 'en_cours', 'terminee', 'validee') NOT NULL DEFAULT 'planifiee'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`status\``);
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`status\` text NOT NULL`);
    }

}
