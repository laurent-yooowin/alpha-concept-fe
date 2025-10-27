import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1761564365606 implements MigrationInterface {
    name = 'Migrations1761564365606'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_2a5c63e8f800488134d9d48c74\` ON \`visits\``);
        await queryRunner.query(`DROP INDEX \`IDX_16430323a8c6eb04b64394a166\` ON \`reports\``);
        await queryRunner.query(`DROP INDEX \`IDX_244de3312c8989d7fd4113cbfd\` ON \`reports\``);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_244de3312c8989d7fd4113cbfd\` ON \`reports\` (\`visitId\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_16430323a8c6eb04b64394a166\` ON \`reports\` (\`missionId\`)`);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_2a5c63e8f800488134d9d48c74\` ON \`visits\` (\`missionId\`)`);
    }

}
