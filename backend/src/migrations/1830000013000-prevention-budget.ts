import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionBudget1830000013000 implements MigrationInterface {
  name = 'PreventionBudget1830000013000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`prevention_cost_catalog\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`version\` int unsigned NOT NULL,
        \`matchingKey\` char(64) NULL,
        \`categoryId\` varchar(36) NULL,
        \`categoryKey\` varchar(80) NOT NULL,
        \`label\` varchar(255) NOT NULL,
        \`unit\` varchar(50) NOT NULL,
        \`unitCostHt\` decimal(18,2) NOT NULL,
        \`priceSource\` varchar(500) NOT NULL,
        \`validFrom\` date NOT NULL,
        \`validTo\` date NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_cost_catalog_org_id\` (\`organizationId\`, \`id\`),
        UNIQUE INDEX \`UQ_prevention_cost_catalog_org_version\` (\`organizationId\`, \`version\`),
        INDEX \`IDX_prevention_cost_catalog_org_match_validity\` (\`organizationId\`, \`matchingKey\`, \`validFrom\`, \`validTo\`),
        INDEX \`IDX_prevention_cost_catalog_org_category_active\` (\`organizationId\`, \`categoryKey\`, \`isActive\`),
        CONSTRAINT \`FK_prevention_cost_catalog_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_cost_catalog_category\` FOREIGN KEY (\`organizationId\`, \`categoryId\`) REFERENCES \`prevention_categories\` (\`organizationId\`, \`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`CK_prevention_cost_catalog_amount\` CHECK (\`unitCostHt\` >= 0),
        CONSTRAINT \`CK_prevention_cost_catalog_validity\` CHECK (\`validTo\` IS NULL OR \`validTo\` >= \`validFrom\`)
      ) ENGINE=InnoDB
    `);
    await q.query(`
      CREATE TABLE \`prevention_budget_scenarios\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`scenarioKey\` char(64) NOT NULL,
        \`version\` int unsigned NOT NULL,
        \`sourceVersion\` varchar(64) NOT NULL,
        \`periodStart\` date NOT NULL,
        \`periodEnd\` date NOT NULL,
        \`status\` enum('DRAFT','CALCULATED','VALIDATED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
        \`contingencyRatePercent\` decimal(5,2) NOT NULL,
        \`retainedBudgetHt\` decimal(18,2) NOT NULL DEFAULT 0,
        \`estimatedBudgetHt\` decimal(18,2) NOT NULL DEFAULT 0,
        \`validatedBudgetHt\` decimal(18,2) NOT NULL DEFAULT 0,
        \`contingencyAmountHt\` decimal(18,2) NOT NULL DEFAULT 0,
        \`totalBudgetHt\` decimal(18,2) NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_budget_scenarios_org_id\` (\`organizationId\`, \`id\`),
        UNIQUE INDEX \`UQ_prevention_budget_scenarios_org_key_version\` (\`organizationId\`, \`scenarioKey\`, \`version\`),
        UNIQUE INDEX \`UQ_prevention_budget_scenarios_org_key_source\` (\`organizationId\`, \`scenarioKey\`, \`sourceVersion\`),
        INDEX \`IDX_prevention_budget_scenarios_org_period\` (\`organizationId\`, \`periodStart\`, \`periodEnd\`),
        INDEX \`IDX_prevention_budget_scenarios_org_status\` (\`organizationId\`, \`status\`),
        CONSTRAINT \`FK_prevention_budget_scenarios_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`CK_prevention_budget_scenarios_period\` CHECK (\`periodEnd\` >= \`periodStart\`),
        CONSTRAINT \`CK_prevention_budget_scenarios_rate\` CHECK (\`contingencyRatePercent\` >= 0 AND \`contingencyRatePercent\` <= 100)
      ) ENGINE=InnoDB
    `);
    await q.query(`
      CREATE TABLE \`prevention_budget_items\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`scenarioId\` varchar(36) NOT NULL,
        \`itemKey\` char(64) NOT NULL,
        \`catalogId\` varchar(36) NULL,
        \`categoryId\` varchar(36) NULL,
        \`categoryKey\` varchar(80) NOT NULL,
        \`title\` varchar(500) NOT NULL,
        \`priority\` enum('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
        \`quantity\` decimal(18,4) NOT NULL,
        \`unit\` varchar(50) NOT NULL,
        \`unitCostHt\` decimal(18,2) NULL,
        \`totalHt\` decimal(18,2) NOT NULL DEFAULT 0,
        \`status\` enum('A_CHIFFRER','ESTIME','VALIDE','ENGAGE','REALISE') NOT NULL DEFAULT 'A_CHIFFRER',
        \`justification\` text NULL,
        \`priceSource\` varchar(500) NULL,
        \`lockedManual\` tinyint NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_budget_items_org_id\` (\`organizationId\`, \`id\`),
        UNIQUE INDEX \`UQ_prevention_budget_items_org_scenario_key\` (\`organizationId\`, \`scenarioId\`, \`itemKey\`),
        INDEX \`IDX_prevention_budget_items_org_status\` (\`organizationId\`, \`status\`),
        INDEX \`IDX_prevention_budget_items_org_category\` (\`organizationId\`, \`categoryKey\`),
        CONSTRAINT \`FK_prevention_budget_items_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_budget_items_scenario\` FOREIGN KEY (\`organizationId\`, \`scenarioId\`) REFERENCES \`prevention_budget_scenarios\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_budget_items_catalog\` FOREIGN KEY (\`organizationId\`, \`catalogId\`) REFERENCES \`prevention_cost_catalog\` (\`organizationId\`, \`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`FK_prevention_budget_items_category\` FOREIGN KEY (\`organizationId\`, \`categoryId\`) REFERENCES \`prevention_categories\` (\`organizationId\`, \`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`CK_prevention_budget_items_quantity\` CHECK (\`quantity\` > 0),
        CONSTRAINT \`CK_prevention_budget_items_amount\` CHECK (\`unitCostHt\` IS NULL OR \`unitCostHt\` >= 0),
        CONSTRAINT \`CK_prevention_budget_items_source_status\` CHECK (
          (\`status\` = 'A_CHIFFRER' AND \`unitCostHt\` IS NULL AND \`priceSource\` IS NULL) OR
          (\`status\` <> 'A_CHIFFRER' AND \`unitCostHt\` IS NOT NULL AND \`priceSource\` IS NOT NULL AND CHAR_LENGTH(TRIM(\`priceSource\`)) > 0)
        )
      ) ENGINE=InnoDB
    `);
    await q.query(`
      CREATE TABLE \`prevention_budget_item_sources\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`itemId\` varchar(36) NOT NULL,
        \`sourceKind\` enum('RECOMMENDATION','FINDING','REPORT') NOT NULL,
        \`findingId\` varchar(36) NULL,
        \`reportId\` varchar(36) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_budget_item_sources_org_item_kind_source\` (\`organizationId\`, \`itemId\`, \`sourceKind\`, \`findingId\`, \`reportId\`),
        INDEX \`IDX_prevention_budget_item_sources_org_finding\` (\`organizationId\`, \`findingId\`),
        INDEX \`IDX_prevention_budget_item_sources_org_report\` (\`organizationId\`, \`reportId\`),
        CONSTRAINT \`FK_prevention_budget_item_sources_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_budget_item_sources_item\` FOREIGN KEY (\`organizationId\`, \`itemId\`) REFERENCES \`prevention_budget_items\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_budget_item_sources_report\` FOREIGN KEY (\`organizationId\`, \`reportId\`) REFERENCES \`reports\` (\`organizationId\`, \`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await q.query(`
      CREATE TABLE \`prevention_budget_audit\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`scenarioId\` varchar(36) NOT NULL,
        \`scenarioVersion\` int unsigned NOT NULL,
        \`action\` enum('BUILD','RECALCULATE','REFRESH_ITEM','RECONCILE') NOT NULL,
        \`actorId\` varchar(36) NULL,
        \`beforeState\` json NULL,
        \`afterState\` json NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_prevention_budget_audit_org_scenario\` (\`organizationId\`, \`scenarioId\`, \`scenarioVersion\`),
        CONSTRAINT \`FK_prevention_budget_audit_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_budget_audit_scenario\` FOREIGN KEY (\`organizationId\`, \`scenarioId\`) REFERENCES \`prevention_budget_scenarios\` (\`organizationId\`, \`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_budget_scenario_bi\` BEFORE INSERT ON \`prevention_budget_scenarios\`
      FOR EACH ROW BEGIN
        IF NEW.version <> COALESCE((SELECT MAX(\`version\`) + 1 FROM \`prevention_budget_scenarios\`
          WHERE \`organizationId\`=NEW.organizationId AND \`scenarioKey\`=NEW.scenarioKey), 1) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget scenario version must be monotonic';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_budget_scenario_bu\` BEFORE UPDATE ON \`prevention_budget_scenarios\`
      FOR EACH ROW BEGIN
        IF NOT (NEW.organizationId <=> OLD.organizationId) OR NOT (NEW.scenarioKey <=> OLD.scenarioKey) OR
           NOT (NEW.version <=> OLD.version) OR NOT (NEW.sourceVersion <=> OLD.sourceVersion) OR
           NOT (NEW.periodStart <=> OLD.periodStart) OR NOT (NEW.periodEnd <=> OLD.periodEnd) OR
           NOT (NEW.contingencyRatePercent <=> OLD.contingencyRatePercent) OR
           NOT (NEW.retainedBudgetHt <=> OLD.retainedBudgetHt) OR NOT (NEW.estimatedBudgetHt <=> OLD.estimatedBudgetHt) OR
           NOT (NEW.validatedBudgetHt <=> OLD.validatedBudgetHt) OR NOT (NEW.contingencyAmountHt <=> OLD.contingencyAmountHt) OR
           NOT (NEW.totalBudgetHt <=> OLD.totalBudgetHt) OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget scenario versions are immutable';
        END IF;
      END
    `);
    await q.query(`CREATE TRIGGER \`TRG_prev_budget_scenario_bd\` BEFORE DELETE ON \`prevention_budget_scenarios\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget scenario versions cannot be deleted'`);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_budget_catalog_bi\` BEFORE INSERT ON \`prevention_cost_catalog\`
      FOR EACH ROW BEGIN
        IF NEW.version <> COALESCE((SELECT MAX(\`version\`) + 1 FROM \`prevention_cost_catalog\` WHERE \`organizationId\`=NEW.organizationId), 1) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention cost catalog version must be monotonic';
        END IF;
        IF NEW.priceSource IS NULL OR CHAR_LENGTH(TRIM(NEW.priceSource))=0 THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention cost catalog price source is required';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_budget_catalog_bu\` BEFORE UPDATE ON \`prevention_cost_catalog\`
      FOR EACH ROW BEGIN
        IF NOT (NEW.organizationId <=> OLD.organizationId) OR NOT (NEW.version <=> OLD.version) OR
           NOT (NEW.matchingKey <=> OLD.matchingKey) OR NOT (NEW.categoryId <=> OLD.categoryId) OR
           NOT (NEW.categoryKey <=> OLD.categoryKey) OR NOT (NEW.label <=> OLD.label) OR
           NOT (NEW.unit <=> OLD.unit) OR NOT (NEW.unitCostHt <=> OLD.unitCostHt) OR
           NOT (NEW.priceSource <=> OLD.priceSource) OR NOT (NEW.validFrom <=> OLD.validFrom) OR
           NOT (NEW.validTo <=> OLD.validTo) OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention cost catalog versions are immutable';
        END IF;
      END
    `);
    await q.query(`CREATE TRIGGER \`TRG_prev_budget_catalog_bd\` BEFORE DELETE ON \`prevention_cost_catalog\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention cost catalog versions cannot be deleted'`);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_budget_source_tenant_bi\` BEFORE INSERT ON \`prevention_budget_item_sources\`
      FOR EACH ROW BEGIN
        IF NOT EXISTS (SELECT 1 FROM prevention_budget_items WHERE organizationId=NEW.organizationId AND id=NEW.itemId) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget source item tenant mismatch';
        END IF;
        IF NEW.findingId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prevention_findings WHERE organizationId=NEW.organizationId AND id=NEW.findingId) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget source finding tenant mismatch';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_budget_source_tenant_bu\` BEFORE UPDATE ON \`prevention_budget_item_sources\`
      FOR EACH ROW BEGIN
        IF NOT EXISTS (SELECT 1 FROM prevention_budget_items WHERE organizationId=NEW.organizationId AND id=NEW.itemId) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget source item tenant mismatch';
        END IF;
        IF NEW.findingId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prevention_findings WHERE organizationId=NEW.organizationId AND id=NEW.findingId) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget source finding tenant mismatch';
        END IF;
      END
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER `TRG_prev_budget_source_tenant_bu`');
    await q.query('DROP TRIGGER `TRG_prev_budget_source_tenant_bi`');
    await q.query('DROP TRIGGER `TRG_prev_budget_catalog_bd`');
    await q.query('DROP TRIGGER `TRG_prev_budget_catalog_bu`');
    await q.query('DROP TRIGGER `TRG_prev_budget_catalog_bi`');
    await q.query('DROP TRIGGER `TRG_prev_budget_scenario_bd`');
    await q.query('DROP TRIGGER `TRG_prev_budget_scenario_bu`');
    await q.query('DROP TRIGGER `TRG_prev_budget_scenario_bi`');
    await q.query('DROP TABLE `prevention_budget_audit`');
    await q.query('DROP TABLE `prevention_budget_item_sources`');
    await q.query('DROP TABLE `prevention_budget_items`');
    await q.query('DROP TABLE `prevention_budget_scenarios`');
    await q.query('DROP TABLE `prevention_cost_catalog`');
  }
}

