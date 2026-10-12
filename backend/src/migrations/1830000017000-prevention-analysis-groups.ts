import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionAnalysisGroups1830000017000 implements MigrationInterface {
  name = 'PreventionAnalysisGroups1830000017000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE \`prevention_analysis_groups\` (
        \`id\` varchar(36) NOT NULL,
        \`organizationId\` varchar(36) NOT NULL,
        \`visitId\` varchar(36) NOT NULL,
        \`missionId\` varchar(36) NOT NULL,
        \`reportId\` varchar(36) NOT NULL,
        \`sourceGroupId\` varchar(100) NOT NULL,
        \`sourceKind\` enum('PHOTO','DIRECTIVE','MIXED') NOT NULL,
        \`proposedPhase\` enum('GROS_OEUVRE','STRUCTURE_CLOS_COUVERT','SECOND_OEUVRE','INSTALLATIONS_FINITIONS','INSTALLATION_ELECTRIQUE','FINITIONS_INTERIEURES','FINITIONS_EXTERIEURES') NOT NULL,
        \`effectivePhase\` enum('GROS_OEUVRE','STRUCTURE_CLOS_COUVERT','SECOND_OEUVRE','INSTALLATIONS_FINITIONS','INSTALLATION_ELECTRIQUE','FINITIONS_INTERIEURES','FINITIONS_EXTERIEURES') NOT NULL,
        \`status\` enum('PROPOSED','VALIDATED') NOT NULL DEFAULT 'PROPOSED',
        \`confidence\` decimal(5,2) NOT NULL,
        \`justification\` varchar(1000) NOT NULL,
        \`source\` enum('PHOTO','DIRECTIVE','MIXED') NOT NULL,
        \`modelVersion\` varchar(100) NULL,
        \`validatedBy\` varchar(36) NULL,
        \`validatedAt\` datetime(6) NULL,
        \`sourceHash\` char(64) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_prevention_analysis_groups_org_visit_source\` (\`organizationId\`,\`visitId\`,\`sourceGroupId\`),
        INDEX \`IDX_prevention_analysis_groups_org_report_phase\` (\`organizationId\`,\`reportId\`,\`effectivePhase\`),
        INDEX \`IDX_prevention_analysis_groups_org_visit_status\` (\`organizationId\`,\`visitId\`,\`status\`),
        CONSTRAINT \`FK_prev_analysis_groups_org\` FOREIGN KEY (\`organizationId\`) REFERENCES \`organizations\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prev_analysis_groups_visit\` FOREIGN KEY (\`organizationId\`,\`visitId\`) REFERENCES \`visits\` (\`organizationId\`,\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prev_analysis_groups_mission\` FOREIGN KEY (\`organizationId\`,\`missionId\`) REFERENCES \`missions\` (\`organizationId\`,\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_prev_analysis_groups_report\` FOREIGN KEY (\`organizationId\`,\`reportId\`) REFERENCES \`reports\` (\`organizationId\`,\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`CK_prev_analysis_groups_validation\` CHECK (
          (\`status\`='VALIDATED' AND \`validatedBy\` IS NOT NULL AND \`validatedAt\` IS NOT NULL) OR
          (\`status\`='PROPOSED' AND \`validatedBy\` IS NULL AND \`validatedAt\` IS NULL AND \`effectivePhase\`=\`proposedPhase\`)
        ),
        CONSTRAINT \`CK_prev_analysis_groups_confidence\` CHECK (\`confidence\` >= 0 AND \`confidence\` <= 100),
        CONSTRAINT \`CK_prev_analysis_groups_justification\` CHECK (CHAR_LENGTH(TRIM(\`justification\`)) > 0),
        CONSTRAINT \`CK_prev_analysis_groups_source_hash\` CHECK (CHAR_LENGTH(\`sourceHash\`)=64 AND \`sourceHash\` REGEXP '^[0-9a-fA-F]{64}$')
      ) ENGINE=InnoDB
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `prevention_analysis_groups`');
  }
}
