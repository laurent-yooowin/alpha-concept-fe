import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionDataFoundation1830000009000 implements MigrationInterface {
  name = 'PreventionDataFoundation1830000009000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `reports` ADD UNIQUE INDEX `UQ_reports_org_id` (`organizationId`, `id`)');
    await q.query('ALTER TABLE `visits` ADD UNIQUE INDEX `UQ_visits_org_id` (`organizationId`, `id`)');
    await q.query('ALTER TABLE `missions` ADD UNIQUE INDEX `UQ_missions_org_id` (`organizationId`, `id`)');

    await q.query(`
      CREATE TABLE \`prevention_categories\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`code\` varchar(80) NOT NULL,
        \`label\` varchar(150) NOT NULL,
        \`description\` text NULL,
        \`color\` varchar(16) NULL,
        \`displayOrder\` int NOT NULL DEFAULT 0,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_categories_organization_code\` (\`organizationId\`, \`code\`),
        INDEX \`IDX_prevention_categories_organization_active_order\` (\`organizationId\`, \`isActive\`, \`displayOrder\`),
        UNIQUE INDEX \`UQ_prevention_categories_org_id\` (\`organizationId\`, \`id\`),
        CONSTRAINT \`FK_prevention_categories_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TABLE \`prevention_report_snapshots\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`reportId\` varchar(36) NOT NULL,
        \`visitId\` varchar(36) NOT NULL,
        \`missionId\` varchar(36) NOT NULL,
        \`sourceHash\` char(64) NOT NULL,
        \`sourceUpdatedAt\` datetime(6) NOT NULL,
        \`businessDate\` date NOT NULL,
        \`missionType\` varchar(32) NOT NULL,
        \`sourceStatus\` varchar(32) NULL,
        \`findingCount\` int NOT NULL DEFAULT 0,
        \`indexedAt\` datetime(6) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_report_snapshots_organization_report\` (\`organizationId\`, \`reportId\`),
        INDEX \`IDX_prevention_report_snapshots_organization_business_date\` (\`organizationId\`, \`businessDate\`),
        INDEX \`IDX_prevention_report_snapshots_organization_source_updated_at\` (\`organizationId\`, \`sourceUpdatedAt\`),
        UNIQUE INDEX \`UQ_prevention_report_snapshots_org_id\` (\`organizationId\`, \`id\`),
        INDEX \`IDX_prevention_report_snapshots_org_visit\` (\`organizationId\`, \`visitId\`),
        INDEX \`IDX_prevention_report_snapshots_org_mission\` (\`organizationId\`, \`missionId\`),
        CONSTRAINT \`FK_prevention_report_snapshots_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_report_snapshots_report\` FOREIGN KEY (\`organizationId\`, \`reportId\`) REFERENCES \`reports\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_report_snapshots_visit\` FOREIGN KEY (\`organizationId\`, \`visitId\`) REFERENCES \`visits\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_report_snapshots_mission\` FOREIGN KEY (\`organizationId\`, \`missionId\`) REFERENCES \`missions\` (\`organizationId\`, \`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TRIGGER \`TRG_prev_category_org_immutable_bu\`
      BEFORE UPDATE ON \`prevention_categories\`
      FOR EACH ROW
      BEGIN
        IF NOT (NEW.organizationId <=> OLD.organizationId) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention category organization is immutable';
        END IF;
      END
    `);

    await q.query(`
      CREATE TABLE \`prevention_findings\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`snapshotId\` varchar(36) NOT NULL,
        \`reportId\` varchar(36) NOT NULL,
        \`visitId\` varchar(36) NOT NULL,
        \`missionId\` varchar(36) NOT NULL,
        \`sourceGroupId\` varchar(100) NULL,
        \`sourceKind\` enum('PHOTO_GROUP', 'DIRECTIVE_ONLY') NOT NULL,
        \`findingType\` enum('OBSERVATION', 'RECOMMENDATION') NOT NULL,
        \`categoryId\` varchar(36) NULL,
        \`normalizedKey\` char(64) NOT NULL,
        \`content\` text NOT NULL,
        \`danger\` text NULL,
        \`risk\` text NULL,
        \`riskLevel\` enum('faible', 'moyen', 'eleve') NOT NULL,
        \`confidence\` decimal(5,2) NULL,
        \`regulatoryReferences\` json NULL,
        \`businessDate\` date NOT NULL,
        \`missionType\` varchar(32) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_findings_snapshot_key_type\` (\`snapshotId\`, \`normalizedKey\`, \`findingType\`),
        INDEX \`IDX_prevention_findings_organization_business_date_risk_level\` (\`organizationId\`, \`businessDate\`, \`riskLevel\`),
        INDEX \`IDX_prevention_findings_organization_category_business_date\` (\`organizationId\`, \`categoryId\`, \`businessDate\`),
        INDEX \`IDX_prevention_findings_organization_mission_type_business_date\` (\`organizationId\`, \`missionType\`, \`businessDate\`),
        INDEX \`IDX_prevention_findings_organization_report\` (\`organizationId\`, \`reportId\`),
        INDEX \`IDX_prevention_findings_org_snapshot\` (\`organizationId\`, \`snapshotId\`),
        INDEX \`IDX_prevention_findings_org_visit\` (\`organizationId\`, \`visitId\`),
        INDEX \`IDX_prevention_findings_org_mission\` (\`organizationId\`, \`missionId\`),
        INDEX \`IDX_prevention_findings_category\` (\`categoryId\`),
        CONSTRAINT \`FK_prevention_findings_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_findings_snapshot\` FOREIGN KEY (\`organizationId\`, \`snapshotId\`) REFERENCES \`prevention_report_snapshots\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_findings_report\` FOREIGN KEY (\`organizationId\`, \`reportId\`) REFERENCES \`reports\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_findings_visit\` FOREIGN KEY (\`organizationId\`, \`visitId\`) REFERENCES \`visits\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_findings_mission\` FOREIGN KEY (\`organizationId\`, \`missionId\`) REFERENCES \`missions\` (\`organizationId\`, \`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_findings_category\` FOREIGN KEY (\`categoryId\`) REFERENCES \`prevention_categories\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TABLE \`prevention_daily_statistics\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`statDate\` date NOT NULL,
        \`missionType\` varchar(32) NOT NULL,
        \`categoryId\` varchar(36) NULL,
        \`categoryKey\` varchar(36) NOT NULL DEFAULT 'UNCATEGORIZED',
        \`riskLevel\` enum('faible', 'moyen', 'eleve') NOT NULL,
        \`findingType\` enum('OBSERVATION', 'RECOMMENDATION') NOT NULL,
        \`findingCount\` int unsigned NOT NULL DEFAULT 0,
        \`reportCount\` int unsigned NOT NULL DEFAULT 0,
        \`visitCount\` int unsigned NOT NULL DEFAULT 0,
        \`missionCount\` int unsigned NOT NULL DEFAULT 0,
        \`calculatedAt\` datetime(6) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_daily_statistics_dimensions\` (\`organizationId\`, \`statDate\`, \`missionType\`, \`categoryKey\`, \`riskLevel\`, \`findingType\`),
        INDEX \`IDX_prevention_daily_statistics_organization_stat_date\` (\`organizationId\`, \`statDate\`),
        INDEX \`IDX_prevention_daily_statistics_org_mission_type_date\` (\`organizationId\`, \`missionType\`, \`statDate\`),
        INDEX \`IDX_prevention_daily_statistics_category\` (\`categoryId\`),
        CONSTRAINT \`FK_prevention_daily_statistics_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_daily_statistics_category\` FOREIGN KEY (\`categoryId\`) REFERENCES \`prevention_categories\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TRIGGER \`TRG_prev_find_cat_tenant_bi\`
      BEFORE INSERT ON \`prevention_findings\`
      FOR EACH ROW
      BEGIN
        IF NEW.categoryId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM \`prevention_categories\`
          WHERE \`id\` = NEW.categoryId AND \`organizationId\` = NEW.organizationId
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention finding category tenant mismatch';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_find_cat_tenant_bu\`
      BEFORE UPDATE ON \`prevention_findings\`
      FOR EACH ROW
      BEGIN
        IF NEW.categoryId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM \`prevention_categories\`
          WHERE \`id\` = NEW.categoryId AND \`organizationId\` = NEW.organizationId
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention finding category tenant mismatch';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_stat_cat_tenant_bi\`
      BEFORE INSERT ON \`prevention_daily_statistics\`
      FOR EACH ROW
      BEGIN
        IF NEW.categoryId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM \`prevention_categories\`
          WHERE \`id\` = NEW.categoryId AND \`organizationId\` = NEW.organizationId
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention statistic category tenant mismatch';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_stat_cat_tenant_bu\`
      BEFORE UPDATE ON \`prevention_daily_statistics\`
      FOR EACH ROW
      BEGIN
        IF NEW.categoryId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM \`prevention_categories\`
          WHERE \`id\` = NEW.categoryId AND \`organizationId\` = NEW.organizationId
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention statistic category tenant mismatch';
        END IF;
      END
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER `TRG_prev_category_org_immutable_bu`');
    await q.query('DROP TRIGGER `TRG_prev_stat_cat_tenant_bu`');
    await q.query('DROP TRIGGER `TRG_prev_stat_cat_tenant_bi`');
    await q.query('DROP TRIGGER `TRG_prev_find_cat_tenant_bu`');
    await q.query('DROP TRIGGER `TRG_prev_find_cat_tenant_bi`');
    await q.query('DROP TABLE \`prevention_daily_statistics\`');
    await q.query('DROP TABLE \`prevention_findings\`');
    await q.query('DROP TABLE \`prevention_report_snapshots\`');
    await q.query('DROP TABLE \`prevention_categories\`');
    await q.query('ALTER TABLE `missions` DROP INDEX `UQ_missions_org_id`');
    await q.query('ALTER TABLE `visits` DROP INDEX `UQ_visits_org_id`');
    await q.query('ALTER TABLE `reports` DROP INDEX `UQ_reports_org_id`');
  }
}
