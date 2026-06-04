import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiTenantOrganizations1830000000000 implements MigrationInterface {
  name = 'MultiTenantOrganizations1830000000000';

  public async up(q: QueryRunner): Promise<void> {
    // 1. organizations table
    await q.query(`
      CREATE TABLE \`organizations\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`slug\` varchar(100) NOT NULL,
        \`logoS3Key\` varchar(500) NULL,
        \`primaryColor\` varchar(32) NULL,
        \`secondaryColor\` varchar(32) NULL,
        \`cguContent\` text NULL,
        \`contactEmail\` varchar(255) NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_organizations_slug\` (\`slug\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // 2. users.role enum extension + organizationId
    await q.query(`ALTER TABLE \`users\` MODIFY \`role\` enum('ROLE_USER','ROLE_ADMIN','ROLE_HYPER_ADMIN') NOT NULL DEFAULT 'ROLE_USER'`);
    await q.query(`ALTER TABLE \`users\` ADD COLUMN \`organizationId\` varchar(36) NULL`);
    await q.query(`CREATE INDEX \`IDX_users_organizationId\` ON \`users\`(\`organizationId\`)`);

    // 3. user_organizations join table
    await q.query(`
      CREATE TABLE \`user_organizations\` (
        \`userId\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`role\` enum('ROLE_USER','ROLE_ADMIN','ROLE_HYPER_ADMIN') NOT NULL DEFAULT 'ROLE_USER',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`userId\`,\`organizationId\`)
      ) ENGINE=InnoDB
    `);

    // 4. organizationId column on business tables
    for (const table of ['missions', 'visits', 'reports', 'mission_assignments']) {
      await q.query(`ALTER TABLE \`${table}\` ADD COLUMN \`organizationId\` varchar(36) NULL`);
      await q.query(`CREATE INDEX \`IDX_${table}_org\` ON \`${table}\`(\`organizationId\`)`);
    }
    await q.query(`ALTER TABLE \`activity_logs\` ADD COLUMN \`organization_id\` varchar(36) NULL`);
    await q.query(`CREATE INDEX \`IDX_activity_logs_org\` ON \`activity_logs\`(\`organization_id\`)`);

    // 5. clients table (new)
    await q.query(`
      CREATE TABLE \`clients\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NULL,
        \`name\` varchar(255) NOT NULL,
        \`email\` varchar(255) NULL,
        \`phone\` varchar(255) NULL,
        \`address\` text NULL,
        \`contactFirstName\` varchar(255) NULL,
        \`contactLastName\` varchar(255) NULL,
        \`refClient\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_clients_org\` (\`organizationId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // 6. Backfill: create default organization if any users exist
    const userCount = await q.query(`SELECT COUNT(*) AS c FROM \`users\``);
    if (userCount[0].c > 0) {
      await q.query(`
        INSERT INTO \`organizations\` (id, name, slug, isActive)
        VALUES (UUID(), 'Organisation par défaut', 'default', 1)
      `);
      const [defaultOrg] = await q.query(`SELECT id FROM \`organizations\` WHERE slug = 'default' LIMIT 1`);
      const defaultOrgId = defaultOrg.id;

      await q.query(`UPDATE \`users\` SET \`organizationId\` = ? WHERE \`role\` IN ('ROLE_USER','ROLE_ADMIN')`, [defaultOrgId]);
      await q.query(`UPDATE \`missions\` SET \`organizationId\` = ?`, [defaultOrgId]);
      await q.query(`UPDATE \`visits\` SET \`organizationId\` = ?`, [defaultOrgId]);
      await q.query(`UPDATE \`reports\` SET \`organizationId\` = ?`, [defaultOrgId]);
      await q.query(`UPDATE \`mission_assignments\` SET \`organizationId\` = ?`, [defaultOrgId]);
      await q.query(`UPDATE \`activity_logs\` SET \`organization_id\` = ?`, [defaultOrgId]);
    }

    // 7. FKs
    await q.query(`ALTER TABLE \`users\` ADD CONSTRAINT \`FK_users_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\`(\`id\`) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE \`missions\` ADD CONSTRAINT \`FK_missions_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`visits\` ADD CONSTRAINT \`FK_visits_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`reports\` ADD CONSTRAINT \`FK_reports_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`mission_assignments\` ADD CONSTRAINT \`FK_assignments_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`activity_logs\` ADD CONSTRAINT \`FK_activity_logs_org\` FOREIGN KEY (\`organization_id\`) REFERENCES \`organizations\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`clients\` ADD CONSTRAINT \`FK_clients_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`user_organizations\` ADD CONSTRAINT \`FK_uorg_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`user_organizations\` ADD CONSTRAINT \`FK_uorg_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\`(\`id\`) ON DELETE CASCADE`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`user_organizations\` DROP FOREIGN KEY \`FK_uorg_org\``);
    await q.query(`ALTER TABLE \`user_organizations\` DROP FOREIGN KEY \`FK_uorg_user\``);
    await q.query(`ALTER TABLE \`clients\` DROP FOREIGN KEY \`FK_clients_org\``);
    await q.query(`ALTER TABLE \`activity_logs\` DROP FOREIGN KEY \`FK_activity_logs_org\``);
    await q.query(`ALTER TABLE \`mission_assignments\` DROP FOREIGN KEY \`FK_assignments_org\``);
    await q.query(`ALTER TABLE \`reports\` DROP FOREIGN KEY \`FK_reports_org\``);
    await q.query(`ALTER TABLE \`visits\` DROP FOREIGN KEY \`FK_visits_org\``);
    await q.query(`ALTER TABLE \`missions\` DROP FOREIGN KEY \`FK_missions_org\``);
    await q.query(`ALTER TABLE \`users\` DROP FOREIGN KEY \`FK_users_org\``);

    await q.query(`DROP TABLE \`clients\``);
    await q.query(`DROP TABLE \`user_organizations\``);

    await q.query(`DROP INDEX \`IDX_activity_logs_org\` ON \`activity_logs\``);
    await q.query(`ALTER TABLE \`activity_logs\` DROP COLUMN \`organization_id\``);
    for (const table of ['mission_assignments', 'reports', 'visits', 'missions']) {
      await q.query(`DROP INDEX \`IDX_${table}_org\` ON \`${table}\``);
      await q.query(`ALTER TABLE \`${table}\` DROP COLUMN \`organizationId\``);
    }

    await q.query(`DROP INDEX \`IDX_users_organizationId\` ON \`users\``);
    await q.query(`ALTER TABLE \`users\` DROP COLUMN \`organizationId\``);
    await q.query(`ALTER TABLE \`users\` MODIFY \`role\` enum('ROLE_USER','ROLE_ADMIN') NOT NULL DEFAULT 'ROLE_USER'`);

    await q.query(`DROP TABLE \`organizations\``);
  }
}
