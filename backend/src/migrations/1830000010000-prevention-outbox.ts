import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionOutbox1830000010000 implements MigrationInterface {
  name = 'PreventionOutbox1830000010000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`prevention_outbox_events\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`aggregateType\` enum('REPORT') NOT NULL,
        \`aggregateId\` varchar(36) NOT NULL,
        \`eventType\` enum('REPORT_UPSERTED','REPORT_DELETED') NOT NULL,
        \`aggregateVersion\` varchar(64) NOT NULL,
        \`deduplicationKey\` varchar(190) NOT NULL,
        \`payload\` json NOT NULL,
        \`status\` enum('PENDING','PROCESSING','PUBLISHED','FAILED') NOT NULL DEFAULT 'PENDING',
        \`attempts\` int unsigned NOT NULL DEFAULT 0,
        \`availableAt\` datetime(6) NOT NULL,
        \`lockedAt\` datetime(6) NULL,
        \`lockedBy\` varchar(100) NULL,
        \`publishedAt\` datetime(6) NULL,
        \`lastError\` varchar(1000) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_outbox_deduplication_key\` (\`deduplicationKey\`),
        INDEX \`IDX_prevention_outbox_status_available\` (\`status\`, \`availableAt\`),
        INDEX \`IDX_prevention_outbox_org_aggregate_created\` (\`organizationId\`, \`aggregateId\`, \`createdAt\`),
        CONSTRAINT \`FK_prevention_outbox_organization\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `prevention_outbox_events`');
  }
}
