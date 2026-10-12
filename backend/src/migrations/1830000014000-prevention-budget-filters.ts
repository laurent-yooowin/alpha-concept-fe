import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the persisted, tenant-scoped filters used to build a budget scenario. */
export class PreventionBudgetFilters1830000014000 implements MigrationInterface {
  name = 'PreventionBudgetFilters1830000014000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `prevention_budget_scenarios` ADD `missionId` varchar(36) NULL, ADD `categoryId` varchar(36) NULL');
    await q.query('ALTER TABLE `prevention_budget_scenarios` ADD INDEX `IDX_prev_budget_scenario_org_mission` (`organizationId`,`missionId`), ADD INDEX `IDX_prev_budget_scenario_org_category` (`organizationId`,`categoryId`)');
    await q.query('ALTER TABLE `prevention_budget_scenarios` ADD CONSTRAINT `FK_prev_budget_scenario_mission` FOREIGN KEY (`organizationId`,`missionId`) REFERENCES `missions` (`organizationId`,`id`) ON DELETE RESTRICT');
    await q.query('ALTER TABLE `prevention_budget_scenarios` ADD CONSTRAINT `FK_prev_budget_scenario_category` FOREIGN KEY (`organizationId`,`categoryId`) REFERENCES `prevention_categories` (`organizationId`,`id`) ON DELETE RESTRICT');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `prevention_budget_scenarios` DROP FOREIGN KEY `FK_prev_budget_scenario_category`, DROP FOREIGN KEY `FK_prev_budget_scenario_mission`, DROP INDEX `IDX_prev_budget_scenario_org_category`, DROP INDEX `IDX_prev_budget_scenario_org_mission`, DROP COLUMN `categoryId`, DROP COLUMN `missionId`');
  }
}
