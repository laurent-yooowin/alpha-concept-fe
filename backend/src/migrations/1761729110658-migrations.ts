import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1761729110658 implements MigrationInterface {
    name = 'Migrations1761729110658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`activity_logs\` (\`id\` varchar(36) NOT NULL, \`user_id\` varchar(255) NOT NULL, \`action\` varchar(255) NOT NULL, \`entity_type\` varchar(255) NOT NULL, \`entity_id\` varchar(255) NULL, \`details\` json NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`activity_logs\` ADD CONSTRAINT \`FK_d54f841fa5478e4734590d44036\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`activity_logs\` DROP FOREIGN KEY \`FK_d54f841fa5478e4734590d44036\``);
        await queryRunner.query(`DROP TABLE \`activity_logs\``);
    }

}
