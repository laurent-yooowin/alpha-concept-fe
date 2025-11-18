import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1763401042726 implements MigrationInterface {
    name = 'InitSchema1763401042726'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`users\` (\`id\` varchar(36) NOT NULL, \`email\` varchar(255) NOT NULL, \`password\` varchar(255) NOT NULL, \`firstName\` varchar(255) NOT NULL, \`lastName\` varchar(255) NOT NULL, \`role\` enum ('ROLE_USER', 'ROLE_ADMIN') NOT NULL DEFAULT 'ROLE_USER', \`phone\` varchar(255) NULL, \`address\` varchar(255) NULL, \`company\` varchar(255) NULL, \`experience\` int NULL, \`isActive\` tinyint NOT NULL DEFAULT 1, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_97672ac88f789774dd47f7c8be\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`missions\` (\`id\` varchar(36) NOT NULL, \`title\` varchar(255) NOT NULL, \`client\` varchar(255) NOT NULL, \`refClient\` text NULL, \`address\` text NOT NULL, \`date\` date NOT NULL, \`time\` varchar(10) NOT NULL, \`type\` enum ('CSPS', 'AEU', 'Divers') NOT NULL DEFAULT 'CSPS', \`description\` text NULL, \`status\` enum ('planifiee', 'assignee', 'en_cours', 'terminee', 'validee') NOT NULL DEFAULT 'planifiee', \`contactFirstName\` varchar(255) NULL, \`contactLastName\` varchar(255) NULL, \`contactEmail\` varchar(255) NULL, \`contactPhone\` varchar(50) NULL, \`userId\` varchar(255) NULL, \`imported\` tinyint NOT NULL DEFAULT 0, \`assigned\` tinyint NOT NULL DEFAULT 0, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`visits\` (\`id\` varchar(36) NOT NULL, \`missionId\` varchar(255) NOT NULL, \`userId\` varchar(255) NOT NULL, \`visitDate\` timestamp NOT NULL, \`photos\` json NULL, \`photoCount\` int NOT NULL DEFAULT '0', \`notes\` text NULL, \`reportGenerated\` tinyint NOT NULL DEFAULT 0, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`REL_2a5c63e8f800488134d9d48c74\` (\`missionId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`reports\` (\`id\` varchar(36) NOT NULL, \`missionId\` varchar(255) NOT NULL, \`visitId\` varchar(255) NULL, \`userId\` varchar(255) NOT NULL, \`title\` varchar(255) NOT NULL, \`content\` text NOT NULL, \`header\` text NULL, \`footer\` text NULL, \`status\` enum ('brouillon', 'envoye', 'valide', 'refuse', 'archive', 'envoye_au_client') NOT NULL DEFAULT 'brouillon', \`conformityPercentage\` float NOT NULL DEFAULT '0', \`sentAt\` timestamp NULL, \`recipientEmail\` varchar(255) NULL, \`observations\` varchar(255) NULL, \`remarquesAdmin\` varchar(255) NULL, \`reportFileUrl\` varchar(255) NULL, \`validatedAt\` datetime NULL, \`sentToClientAt\` datetime NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`REL_16430323a8c6eb04b64394a166\` (\`missionId\`), UNIQUE INDEX \`REL_244de3312c8989d7fd4113cbfd\` (\`visitId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`mission_assignments\` (\`id\` varchar(36) NOT NULL, \`missionId\` varchar(255) NOT NULL, \`userId\` varchar(255) NOT NULL, \`assignedBy\` varchar(255) NOT NULL, \`notified\` tinyint NOT NULL DEFAULT 0, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`activity_logs\` (\`id\` varchar(36) NOT NULL, \`user_id\` varchar(255) NOT NULL, \`action\` varchar(255) NOT NULL, \`entity_type\` varchar(255) NOT NULL, \`entity_id\` varchar(255) NULL, \`details\` json NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`missions\` ADD CONSTRAINT \`FK_d6aea52b4168ce8c4fb5a7ff0b5\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD CONSTRAINT \`FK_2a5c63e8f800488134d9d48c740\` FOREIGN KEY (\`missionId\`) REFERENCES \`missions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`visits\` ADD CONSTRAINT \`FK_28f19616757b505532162fd6e75\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`reports\` ADD CONSTRAINT \`FK_16430323a8c6eb04b64394a1663\` FOREIGN KEY (\`missionId\`) REFERENCES \`missions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`reports\` ADD CONSTRAINT \`FK_244de3312c8989d7fd4113cbfd1\` FOREIGN KEY (\`visitId\`) REFERENCES \`visits\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`reports\` ADD CONSTRAINT \`FK_bed415cd29716cd707e9cb3c09c\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`mission_assignments\` ADD CONSTRAINT \`FK_e391fdbb10729476ad57e45a8d5\` FOREIGN KEY (\`missionId\`) REFERENCES \`missions\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`mission_assignments\` ADD CONSTRAINT \`FK_ab2a8a0cec3d063cb421fd9faec\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`mission_assignments\` ADD CONSTRAINT \`FK_05541f0d64cc6bd9fa8d55d56e3\` FOREIGN KEY (\`assignedBy\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`activity_logs\` ADD CONSTRAINT \`FK_d54f841fa5478e4734590d44036\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`activity_logs\` DROP FOREIGN KEY \`FK_d54f841fa5478e4734590d44036\``);
        await queryRunner.query(`ALTER TABLE \`mission_assignments\` DROP FOREIGN KEY \`FK_05541f0d64cc6bd9fa8d55d56e3\``);
        await queryRunner.query(`ALTER TABLE \`mission_assignments\` DROP FOREIGN KEY \`FK_ab2a8a0cec3d063cb421fd9faec\``);
        await queryRunner.query(`ALTER TABLE \`mission_assignments\` DROP FOREIGN KEY \`FK_e391fdbb10729476ad57e45a8d5\``);
        await queryRunner.query(`ALTER TABLE \`reports\` DROP FOREIGN KEY \`FK_bed415cd29716cd707e9cb3c09c\``);
        await queryRunner.query(`ALTER TABLE \`reports\` DROP FOREIGN KEY \`FK_244de3312c8989d7fd4113cbfd1\``);
        await queryRunner.query(`ALTER TABLE \`reports\` DROP FOREIGN KEY \`FK_16430323a8c6eb04b64394a1663\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP FOREIGN KEY \`FK_28f19616757b505532162fd6e75\``);
        await queryRunner.query(`ALTER TABLE \`visits\` DROP FOREIGN KEY \`FK_2a5c63e8f800488134d9d48c740\``);
        await queryRunner.query(`ALTER TABLE \`missions\` DROP FOREIGN KEY \`FK_d6aea52b4168ce8c4fb5a7ff0b5\``);
        await queryRunner.query(`DROP TABLE \`activity_logs\``);
        await queryRunner.query(`DROP TABLE \`mission_assignments\``);
        await queryRunner.query(`DROP INDEX \`REL_244de3312c8989d7fd4113cbfd\` ON \`reports\``);
        await queryRunner.query(`DROP INDEX \`REL_16430323a8c6eb04b64394a166\` ON \`reports\``);
        await queryRunner.query(`DROP TABLE \`reports\``);
        await queryRunner.query(`DROP INDEX \`REL_2a5c63e8f800488134d9d48c74\` ON \`visits\``);
        await queryRunner.query(`DROP TABLE \`visits\``);
        await queryRunner.query(`DROP TABLE \`missions\``);
        await queryRunner.query(`DROP INDEX \`IDX_97672ac88f789774dd47f7c8be\` ON \`users\``);
        await queryRunner.query(`DROP TABLE \`users\``);
    }

}
