import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1761910748294 implements MigrationInterface {
    name = 'Migrations1761910748294'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` MODIFY COLUMN status ENUM('planifiee', 'en_cours', 'terminee', 'validee') NOT NULL DEFAULT 'planifiee'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {


    }
}