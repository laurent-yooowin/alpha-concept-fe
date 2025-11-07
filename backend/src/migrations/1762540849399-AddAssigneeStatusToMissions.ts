import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAssigneeStatusToMissions1762540849399 implements MigrationInterface {
    name = 'AddAssigneeStatusToMissions1762540849399'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`status\` text NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`status\``);
    }

}
