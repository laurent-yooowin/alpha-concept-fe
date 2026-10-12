import { MigrationInterface, QueryRunner } from 'typeorm';

export class VisitAnalysisRequests1830000019000 implements MigrationInterface {
  name = 'VisitAnalysisRequests1830000019000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE visit_analysis_requests (
        id varchar(36) NOT NULL,
        organizationId varchar(36) NOT NULL,
        visitId varchar(36) NOT NULL,
        requestId varchar(128) NOT NULL,
        operation enum('CREATE','REANALYZE','CLARIFY','REANALYZE_ALL') NOT NULL,
        groupId varchar(100) NULL,
        inputHash char(64) NOT NULL,
        status enum('PENDING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
        result json NULL,
        errorMessage varchar(1000) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX UQ_visit_analysis_requests_org_visit_request (organizationId,visitId,requestId),
        INDEX IDX_visit_analysis_requests_status (organizationId,visitId,status),
        CONSTRAINT FK_visit_analysis_requests_org FOREIGN KEY (organizationId) REFERENCES organizations (id) ON DELETE CASCADE,
        CONSTRAINT FK_visit_analysis_requests_visit FOREIGN KEY (organizationId,visitId) REFERENCES visits (organizationId,id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE visit_analysis_requests');
  }
}
