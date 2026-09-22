import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionScheduler1830000012000 implements MigrationInterface {
  name = 'PreventionScheduler1830000012000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`prevention_scheduler_runs\` (
        \`id\` varchar(36) NOT NULL,
        \`jobType\` varchar(50) NOT NULL,
        \`scheduledFor\` datetime(6) NOT NULL,
        \`status\` enum('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
        \`organizationCursor\` varchar(36) NULL,
        \`processedOrganizations\` int unsigned NOT NULL DEFAULT 0,
        \`enqueuedJobs\` int unsigned NOT NULL DEFAULT 0,
        \`dispatchComplete\` tinyint NOT NULL DEFAULT 0,
        \`attempts\` int unsigned NOT NULL DEFAULT 0,
        \`availableAt\` datetime(6) NOT NULL,
        \`lockedAt\` datetime(6) NULL,
        \`lockedBy\` varchar(36) NULL,
        \`lastError\` varchar(500) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_scheduler_runs_occurrence\` (\`jobType\`,\`scheduledFor\`),
        INDEX \`IDX_prevention_scheduler_runs_status_available\` (\`status\`,\`availableAt\`),
        INDEX \`IDX_prevention_scheduler_runs_job_created\` (\`jobType\`,\`createdAt\`)
      ) ENGINE=InnoDB
    `);
    await q.query(`
      CREATE TABLE \`prevention_scheduler_checkpoints\` (
        \`id\` varchar(36) NOT NULL,
        \`runId\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`reportCursor\` varchar(36) NULL,
        \`status\` enum('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
        \`processedReports\` int unsigned NOT NULL DEFAULT 0,
        \`pendingJobs\` int unsigned NOT NULL DEFAULT 0,
        \`failedJobs\` int unsigned NOT NULL DEFAULT 0,
        \`scanComplete\` tinyint NOT NULL DEFAULT 0,
        \`attempts\` int unsigned NOT NULL DEFAULT 0,
        \`availableAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`lockedAt\` datetime(6) NULL,
        \`lockedBy\` varchar(36) NULL,
        \`lastError\` varchar(500) NULL,
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_scheduler_checkpoints_run_org\` (\`runId\`,\`organizationId\`),
        UNIQUE INDEX \`UQ_prevention_scheduler_checkpoints_id_org\` (\`id\`,\`organizationId\`),
        INDEX \`IDX_prevention_scheduler_checkpoints_org_status\` (\`organizationId\`,\`status\`),
        CONSTRAINT \`FK_prevention_scheduler_checkpoints_run\` FOREIGN KEY (\`runId\`)
          REFERENCES \`prevention_scheduler_runs\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_scheduler_checkpoints_org\` FOREIGN KEY (\`organizationId\`)
          REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await q.query(`
      CREATE TABLE \`prevention_scheduler_tasks\` (
        \`id\` varchar(36) NOT NULL,
        \`checkpointId\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`reportId\` varchar(36) NOT NULL,
        \`status\` enum('PENDING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
        \`attempts\` int unsigned NOT NULL DEFAULT 0,
        \`lastError\` varchar(500) NULL,
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_prevention_scheduler_tasks_checkpoint_status\` (\`checkpointId\`,\`status\`),
        INDEX \`IDX_prevention_scheduler_tasks_org_status\` (\`organizationId\`,\`status\`),
        CONSTRAINT \`FK_prevention_scheduler_tasks_checkpoint_org\`
          FOREIGN KEY (\`checkpointId\`,\`organizationId\`)
          REFERENCES \`prevention_scheduler_checkpoints\` (\`id\`,\`organizationId\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prevention_scheduler_tasks_org\` FOREIGN KEY (\`organizationId\`)
          REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE \`prevention_scheduler_tasks\`');
    await q.query('DROP TABLE \`prevention_scheduler_checkpoints\`');
    await q.query('DROP TABLE \`prevention_scheduler_runs\`');
  }
}
