import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1764008752153 implements MigrationInterface {
    name = 'Migrations1764008752153'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`date\` \`date\` date NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`date\` \`date\` date NOT NULL`);
    }

}
