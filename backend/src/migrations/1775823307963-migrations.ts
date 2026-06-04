import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1775823307963 implements MigrationInterface {
    name = 'Migrations1775823307963'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`status\` \`status\` enum ('planifiee', 'assignee', 'en_cours', 'terminee', 'validee', 'archivee') NOT NULL DEFAULT 'planifiee'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`status\` \`status\` enum ('planifiee', 'assignee', 'en_cours', 'terminee', 'validee') NOT NULL DEFAULT 'planifiee'`);
    }

}
