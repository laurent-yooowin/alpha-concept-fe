import { MigrationInterface, QueryRunner } from 'typeorm';

const standardEnum = "enum('GROS_OEUVRE','STRUCTURE_CLOS_COUVERT','SECOND_OEUVRE','INSTALLATIONS_FINITIONS','INSTALLATION_ELECTRIQUE','FINITIONS_INTERIEURES','FINITIONS_EXTERIEURES')";

export class PreventionGlobalCustomPhases1830000041000 implements MigrationInterface {
  name = 'PreventionGlobalCustomPhases1830000041000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE prevention_phase_catalog (
      code varchar(43) NOT NULL,
      label varchar(80) NOT NULL,
      labelKey varchar(160) NOT NULL,
      createdBy varchar(36) NOT NULL,
      createdFromOrganizationId varchar(36) NOT NULL,
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (code),
      UNIQUE INDEX UQ_prevention_phase_catalog_label_key (labelKey),
      INDEX IDX_prevention_phase_catalog_creator_time (createdBy,createdAt),
      CONSTRAINT CK_prevention_phase_catalog_code CHECK (code REGEXP '^CUSTOM_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
      CONSTRAINT CK_prevention_phase_catalog_label CHECK (CHAR_LENGTH(TRIM(label)) BETWEEN 3 AND 80)
    ) ENGINE=InnoDB`);
    await q.query('ALTER TABLE prevention_analysis_groups MODIFY COLUMN effectivePhase varchar(43) NOT NULL');
    await q.query('ALTER TABLE prevention_group_processing_jobs MODIFY COLUMN effectivePhase varchar(43) NULL');
  }

  async down(q: QueryRunner): Promise<void> {
    const [catalog] = await q.query('SELECT COUNT(*) AS count FROM prevention_phase_catalog');
    const [analysis] = await q.query("SELECT COUNT(*) AS count FROM prevention_analysis_groups WHERE effectivePhase LIKE 'CUSTOM_%'");
    const [jobs] = await q.query("SELECT COUNT(*) AS count FROM prevention_group_processing_jobs WHERE effectivePhase LIKE 'CUSTOM_%'");
    if (Number(catalog?.count) || Number(analysis?.count) || Number(jobs?.count)) {
      throw new Error('Cannot roll back global custom phases without explicitly preserving custom catalog data');
    }
    await q.query(`ALTER TABLE prevention_group_processing_jobs MODIFY COLUMN effectivePhase ${standardEnum} NULL`);
    await q.query(`ALTER TABLE prevention_analysis_groups MODIFY COLUMN effectivePhase ${standardEnum} NOT NULL`);
    await q.query('DROP TABLE prevention_phase_catalog');
  }
}
