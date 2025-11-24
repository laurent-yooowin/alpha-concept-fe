import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1763988256268 implements MigrationInterface {
    name = 'Migrations1763988256268'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`endDate\` date NULL`);
        await queryRunner.query(`ALTER TABLE \`missions\` ADD \`refBusiness\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`time\` \`time\` varchar(10) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`missions\` CHANGE \`time\` \`time\` varchar(10) NOT NULL`);
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`refBusiness\``);
        await queryRunner.query(`ALTER TABLE \`missions\` DROP COLUMN \`endDate\``);
    }

}
