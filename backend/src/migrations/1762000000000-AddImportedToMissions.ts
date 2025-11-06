import { MigrationInterface, QueryRunner } from "typeorm";

export class AddImportedToMissions1762000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE missions
            ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE missions
            DROP COLUMN imported
        `);
    }
}
