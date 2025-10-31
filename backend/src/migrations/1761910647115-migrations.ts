import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1761910647115 implements MigrationInterface {
    name = 'Migrations1761910647115'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`refClient\` varchar(255) NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`refClient\``);
    }

}
