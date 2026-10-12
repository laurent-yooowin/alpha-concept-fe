import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionCostCatalogAudit1830000015000 implements MigrationInterface {
  name = 'PreventionCostCatalogAudit1830000015000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`prevention_cost_catalog_audit\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`catalogId\` varchar(36) NOT NULL,
        \`catalogVersion\` int unsigned NOT NULL,
        \`actorId\` varchar(36) NOT NULL,
        \`action\` enum('STATUS_CHANGED') NOT NULL,
        \`beforeState\` json NOT NULL,
        \`afterState\` json NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_prev_catalog_audit_org_catalog\` (\`organizationId\`,\`catalogId\`,\`createdAt\`),
        CONSTRAINT \`FK_prev_catalog_audit_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prev_catalog_audit_catalog\` FOREIGN KEY (\`organizationId\`,\`catalogId\`) REFERENCES \`prevention_cost_catalog\` (\`organizationId\`,\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await q.query(`CREATE TRIGGER \`TRG_prev_catalog_audit_bu\` BEFORE UPDATE ON \`prevention_cost_catalog_audit\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention cost catalog audit is append-only'`);
    await q.query(`CREATE TRIGGER \`TRG_prev_catalog_audit_bd\` BEFORE DELETE ON \`prevention_cost_catalog_audit\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention cost catalog audit is append-only'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER `TRG_prev_catalog_audit_bd`');
    await q.query('DROP TRIGGER `TRG_prev_catalog_audit_bu`');
    await q.query('DROP TABLE `prevention_cost_catalog_audit`');
  }
}
