import { MigrationInterface, QueryRunner } from 'typeorm';

export class PreventionGroupProcessing1830000018000 implements MigrationInterface {
  name = 'PreventionGroupProcessing1830000018000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE prevention_group_processing_jobs (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        visitId varchar(36) NOT NULL,
        missionId varchar(36) NOT NULL,
        sourceGroupId varchar(100) NOT NULL,
        sourceKind enum('PHOTO','DIRECTIVE','MIXED') NOT NULL,
        processingStatus enum('PENDING','PROCESSING','RETRY','READY','FAILED') NOT NULL DEFAULT 'PENDING',
        phaseStatus enum('PROPOSED','VALIDATED') NOT NULL DEFAULT 'PROPOSED',
        proposedPhase enum('GROS_OEUVRE','STRUCTURE_CLOS_COUVERT','SECOND_OEUVRE','INSTALLATIONS_FINITIONS','INSTALLATION_ELECTRIQUE','FINITIONS_INTERIEURES','FINITIONS_EXTERIEURES') NULL,
        effectivePhase enum('GROS_OEUVRE','STRUCTURE_CLOS_COUVERT','SECOND_OEUVRE','INSTALLATIONS_FINITIONS','INSTALLATION_ELECTRIQUE','FINITIONS_INTERIEURES','FINITIONS_EXTERIEURES') NULL,
        confidence decimal(5,2) NULL,
        justification varchar(1000) NULL,
        riskAssessments json NULL,
        sourcePayload json NOT NULL,
        sourceHash char(64) NOT NULL,
        attempts int unsigned NOT NULL DEFAULT 0,
        availableAt datetime(6) NOT NULL,
        lockedAt datetime(6) NULL,
        lockedBy varchar(100) NULL,
        lastError varchar(1000) NULL,
        validatedBy varchar(36) NULL,
        validatedAt datetime(6) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX UQ_prevention_group_processing_org_visit_source (organizationId,visitId,sourceGroupId),
        INDEX IDX_prevention_group_processing_due (processingStatus,availableAt,organizationId),
        INDEX IDX_prevention_group_processing_visit (organizationId,visitId),
        CONSTRAINT FK_prevention_group_processing_org FOREIGN KEY (organizationId) REFERENCES organizations (id) ON DELETE CASCADE,
        CONSTRAINT FK_prevention_group_processing_visit FOREIGN KEY (organizationId,visitId) REFERENCES visits (organizationId,id) ON DELETE CASCADE,
        CONSTRAINT FK_prevention_group_processing_mission FOREIGN KEY (organizationId,missionId) REFERENCES missions (organizationId,id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE prevention_group_processing_jobs');
  }
}
