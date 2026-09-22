import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P5 analytical storage.  All tables are organisation-scoped and the
 * configuration rows are append-only apart from their activation flag.
 */
export class PreventionStatistics1830000011000 implements MigrationInterface {
  name = 'PreventionStatistics1830000011000';

  public async up(q: QueryRunner): Promise<void> {
    // Existing P4 rows are backfilled before the column becomes mandatory.
    // This is the SQL equivalent of the canonical text normalisation used by
    // extraction (type + lower-cased, whitespace-collapsed content).
    await q.query('ALTER TABLE \`prevention_findings\` ADD COLUMN \`patternKey\` char(64) NULL AFTER \`normalizedKey\`');
    await q.query(`
      UPDATE \`prevention_findings\`
      SET \`patternKey\` = SHA2(
        CONCAT(
          \`findingType\`, '|',
          LOWER(TRIM(REGEXP_REPLACE(\`content\`, '[[:space:]]+', ' ')))
        ),
        256
      )
      WHERE \`patternKey\` IS NULL
    `);
    await q.query('ALTER TABLE \`prevention_findings\` MODIFY COLUMN \`patternKey\` char(64) NOT NULL');
    await q.query(`
      CREATE INDEX \`IDX_prevention_findings_organization_pattern_business_date\`
      ON \`prevention_findings\` (\`organizationId\`, \`patternKey\`, \`businessDate\`)
    `);
    await q.query(`
      CREATE INDEX \`IDX_prevention_findings_organization_pattern_type\`
      ON \`prevention_findings\` (\`organizationId\`, \`patternKey\`, \`findingType\`)
    `);

    await q.query(`
      CREATE TABLE \`prevention_score_configurations\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`version\` int unsigned NOT NULL,
        \`source\` enum('ADMIN','ENVIRONMENT') NOT NULL DEFAULT 'ADMIN',
        \`configurationFingerprint\` char(64) NOT NULL,
        \`weights\` json NOT NULL,
        \`factors\` json NOT NULL,
        \`thresholds\` json NOT NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`activeSlot\` tinyint
          GENERATED ALWAYS AS (IF(\`isActive\` = 1, 1, NULL)) STORED,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_score_configurations_organization_version\` (\`organizationId\`, \`version\`),
        UNIQUE INDEX \`UQ_prevention_score_configurations_organization_id\` (\`organizationId\`, \`id\`),
        INDEX \`IDX_prevention_score_configurations_organization_active\` (\`organizationId\`, \`isActive\`),
        UNIQUE INDEX \`UQ_prevention_score_configurations_one_active\` (\`organizationId\`, \`activeSlot\`),
        CONSTRAINT \`FK_prevention_score_configurations_organization\`
          FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // The active flag is mutable only for activation/deactivation. Values and
    // versions themselves remain immutable once an admin version is created.
    await q.query(`
      CREATE TRIGGER \`TRG_prev_score_config_active_bi\`
      BEFORE INSERT ON \`prevention_score_configurations\`
      FOR EACH ROW
      BEGIN
        IF NEW.version <> COALESCE((
          SELECT MAX(\`version\`) + 1 FROM \`prevention_score_configurations\`
          WHERE \`organizationId\` = NEW.organizationId
        ), 1) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention score configuration version must be monotonic';
        END IF;
        IF NEW.isActive = 1 AND EXISTS (
          SELECT 1 FROM \`prevention_score_configurations\`
          WHERE \`organizationId\` = NEW.organizationId AND \`isActive\` = 1
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only one active prevention score configuration is allowed per organization';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_score_config_immutable_bd\`
      BEFORE DELETE ON \`prevention_score_configurations\`
      FOR EACH ROW
      BEGIN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention score configuration versions cannot be deleted';
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_score_config_immutable_bu\`
      BEFORE UPDATE ON \`prevention_score_configurations\`
      FOR EACH ROW
      BEGIN
        IF NOT (NEW.organizationId <=> OLD.organizationId)
          OR NOT (NEW.version <=> OLD.version)
          OR NOT (NEW.source <=> OLD.source)
          OR NOT (NEW.configurationFingerprint <=> OLD.configurationFingerprint)
          OR NOT (NEW.weights <=> OLD.weights)
          OR NOT (NEW.factors <=> OLD.factors)
          OR NOT (NEW.thresholds <=> OLD.thresholds)
          OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention score configuration versions are immutable';
        END IF;
        IF NEW.isActive = 1 AND OLD.isActive = 0 AND EXISTS (
          SELECT 1 FROM \`prevention_score_configurations\`
          WHERE \`organizationId\` = NEW.organizationId AND \`isActive\` = 1 AND \`id\` <> OLD.id
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only one active prevention score configuration is allowed per organization';
        END IF;
      END
    `);

    await q.query(`
      CREATE TABLE \`prevention_statistics_partitions\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`statDate\` date NOT NULL,
        \`missionType\` varchar(32) NOT NULL,
        \`categoryKey\` varchar(36) NOT NULL,
        \`referenceDate\` date NOT NULL,
        \`status\` enum('PENDING','PROCESSING') NOT NULL DEFAULT 'PENDING',
        \`version\` bigint unsigned NOT NULL DEFAULT 1,
        \`attempts\` int unsigned NOT NULL DEFAULT 0,
        \`availableAt\` datetime(6) NOT NULL,
        \`claimedAt\` datetime(6) NULL,
        \`claimToken\` varchar(36) NULL,
        \`lastError\` varchar(1000) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_statistics_partitions_dimensions\` (\`organizationId\`, \`statDate\`, \`missionType\`, \`categoryKey\`),
        INDEX \`IDX_prevention_statistics_partitions_claim\` (\`status\`, \`availableAt\`, \`organizationId\`),
        INDEX \`IDX_prevention_statistics_partitions_organization_date\` (\`organizationId\`, \`statDate\`),
        CONSTRAINT \`FK_prevention_statistics_partitions_organization\`
          FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TABLE \`prevention_score_partitions\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`patternKey\` char(64) NOT NULL,
        \`missionType\` varchar(32) NOT NULL,
        \`categoryKey\` varchar(36) NOT NULL,
        \`findingType\` enum('OBSERVATION','RECOMMENDATION') NOT NULL,
        \`referenceDate\` date NOT NULL,
        \`status\` enum('PENDING','PROCESSING') NOT NULL DEFAULT 'PENDING',
        \`version\` bigint unsigned NOT NULL DEFAULT 1,
        \`availableAt\` datetime(6) NOT NULL,
        \`claimedAt\` datetime(6) NULL,
        \`claimToken\` varchar(36) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_score_partitions_dimensions\`
          (\`organizationId\`,\`patternKey\`,\`missionType\`,\`categoryKey\`,\`findingType\`),
        INDEX \`IDX_prevention_score_partitions_claim\` (\`status\`,\`availableAt\`,\`organizationId\`),
        CONSTRAINT \`FK_prevention_score_partitions_organization\`
          FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TABLE \`prevention_priority_scores\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`patternKey\` char(64) NOT NULL,
        \`missionType\` varchar(32) NOT NULL,
        \`categoryId\` varchar(36) NULL,
        \`categoryKey\` varchar(36) NOT NULL,
        \`findingType\` enum('OBSERVATION','RECOMMENDATION') NOT NULL,
        \`riskLevel\` enum('faible', 'moyen', 'eleve') NOT NULL,
        \`score\` tinyint unsigned NOT NULL,
        \`components\` json NOT NULL,
        \`referenceDate\` date NOT NULL,
        \`periodStartDate\` date NOT NULL,
        \`periodEndDate\` date NOT NULL,
        \`firstOccurrenceDate\` date NOT NULL,
        \`lastOccurrenceDate\` date NOT NULL,
        \`occurrenceCount\` int unsigned NOT NULL,
        \`reportCount\` int unsigned NOT NULL,
        \`visitCount\` int unsigned NOT NULL,
        \`missionCount\` int unsigned NOT NULL,
        \`occurrenceDayCount\` int unsigned NOT NULL,
        \`trendCurrentOccurrenceCount\` int unsigned NOT NULL,
        \`trendPreviousOccurrenceCount\` int unsigned NOT NULL,
        \`configurationSource\` enum('ADMIN','ENVIRONMENT') NOT NULL,
        \`configurationId\` varchar(36) NULL,
        \`configurationVersion\` int unsigned NULL,
        \`configurationFingerprint\` char(64) NOT NULL,
        \`calculatedAt\` datetime(6) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_priority_scores_dimensions\` (
          \`organizationId\`, \`patternKey\`, \`missionType\`, \`categoryKey\`, \`findingType\`
        ),
        INDEX \`IDX_prevention_priority_scores_organization_score\` (\`organizationId\`, \`score\`),
        INDEX \`IDX_prevention_priority_scores_organization_pattern\` (\`organizationId\`, \`patternKey\`),
        INDEX \`IDX_prevention_priority_scores_organization_reference_date\` (\`organizationId\`, \`referenceDate\`),
        CONSTRAINT \`FK_prevention_priority_scores_organization\`
          FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_priority_scores_configuration\`
          FOREIGN KEY (\`organizationId\`, \`configurationId\`)
          REFERENCES \`prevention_score_configurations\` (\`organizationId\`, \`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    await q.query(`
      CREATE TRIGGER \`TRG_prev_priority_score_category_tenant_bi\`
      BEFORE INSERT ON \`prevention_priority_scores\`
      FOR EACH ROW
      BEGIN
        IF NEW.categoryId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM \`prevention_categories\`
          WHERE \`id\` = NEW.categoryId AND \`organizationId\` = NEW.organizationId
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention priority score category tenant mismatch';
        END IF;
      END
    `);
    await q.query(`
      CREATE TRIGGER \`TRG_prev_priority_score_category_tenant_bu\`
      BEFORE UPDATE ON \`prevention_priority_scores\`
      FOR EACH ROW
      BEGIN
        IF NEW.categoryId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM \`prevention_categories\`
          WHERE \`id\` = NEW.categoryId AND \`organizationId\` = NEW.organizationId
        ) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prevention priority score category tenant mismatch';
        END IF;
      END
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER \`TRG_prev_priority_score_category_tenant_bu\`');
    await q.query('DROP TRIGGER \`TRG_prev_priority_score_category_tenant_bi\`');
    await q.query('DROP TRIGGER \`TRG_prev_score_config_immutable_bu\`');
    await q.query('DROP TRIGGER \`TRG_prev_score_config_immutable_bd\`');
    await q.query('DROP TRIGGER \`TRG_prev_score_config_active_bi\`');
    await q.query('DROP TABLE \`prevention_priority_scores\`');
    await q.query('DROP TABLE \`prevention_score_partitions\`');
    await q.query('DROP TABLE \`prevention_statistics_partitions\`');
    await q.query('DROP TABLE \`prevention_score_configurations\`');
    await q.query('DROP INDEX \`IDX_prevention_findings_organization_pattern_type\` ON \`prevention_findings\`');
    await q.query('DROP INDEX \`IDX_prevention_findings_organization_pattern_business_date\` ON \`prevention_findings\`');
    await q.query('ALTER TABLE \`prevention_findings\` DROP COLUMN \`patternKey\`');
  }
}
