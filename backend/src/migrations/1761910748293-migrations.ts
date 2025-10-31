import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1761910748293 implements MigrationInterface {
    name = 'Migrations1761910748293'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`refClient\``);
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`refClient\` text NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`refClient\``);
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`refClient\` varchar(255) NOT NULL`);
    }

}
