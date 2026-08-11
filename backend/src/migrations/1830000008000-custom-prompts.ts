import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomPrompts1830000008000 implements MigrationInterface {
  name = 'CustomPrompts1830000008000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      "CREATE TABLE custom_prompts (" +
      "id varchar(36) NOT NULL, " +
      "organizationId varchar(36) NOT NULL, " +
      "name varchar(150) NOT NULL, " +
      "missionType enum ('CSPS', 'AEU', 'Divers') NOT NULL, " +
      "content longtext NOT NULL, " +
      "displayOrder int NOT NULL DEFAULT 0, " +
      "isActive tinyint NOT NULL DEFAULT 1, " +
      "createdById varchar(36) NULL, " +
      "createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), " +
      "updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), " +
      "INDEX IDX_custom_prompts_organization (organizationId), " +
      "INDEX IDX_custom_prompts_scope (organizationId, missionType, isActive), " +
      "PRIMARY KEY (id), " +
      "CONSTRAINT FK_custom_prompts_organization FOREIGN KEY (organizationId) REFERENCES organizations(id) ON DELETE CASCADE, " +
      "CONSTRAINT FK_custom_prompts_created_by FOREIGN KEY (createdById) REFERENCES users(id) ON DELETE SET NULL" +
      ") ENGINE=InnoDB",
    );
    await q.query('ALTER TABLE visits ADD customPromptIds json NULL');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE visits DROP COLUMN customPromptIds');
    await q.query('DROP TABLE custom_prompts');
  }
}
