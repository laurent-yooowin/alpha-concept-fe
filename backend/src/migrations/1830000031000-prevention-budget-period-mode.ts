import { MigrationInterface, QueryRunner } from 'typeorm';

/** Distinguishes the unbounded ALL scope from historical date-bounded rows. */
export class PreventionBudgetPeriodMode1830000031000 implements MigrationInterface {
  name = 'PreventionBudgetPeriodMode1830000031000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE prevention_budget_scenarios
      ADD COLUMN periodMode enum('BOUNDED','ALL') NOT NULL DEFAULT 'BOUNDED' AFTER periodEnd`);
    await q.query(`ALTER TABLE prevention_budget_scenarios
      MODIFY COLUMN periodStart date NULL,
      MODIFY COLUMN periodEnd date NULL`);
    await q.query(`CREATE INDEX IDX_prev_budget_scenario_org_mode
      ON prevention_budget_scenarios (organizationId,periodMode)`);
    await q.query('DROP TRIGGER `TRG_prev_budget_scenario_bu`');
    await q.query(`CREATE TRIGGER \`TRG_prev_budget_scenario_bu\` BEFORE UPDATE ON \`prevention_budget_scenarios\`
      FOR EACH ROW BEGIN
        IF NOT (NEW.organizationId <=> OLD.organizationId) OR NOT (NEW.scenarioKey <=> OLD.scenarioKey) OR
           NOT (NEW.version <=> OLD.version) OR NOT (NEW.sourceVersion <=> OLD.sourceVersion) OR
           NOT (NEW.periodStart <=> OLD.periodStart) OR NOT (NEW.periodEnd <=> OLD.periodEnd) OR
           NOT (NEW.periodMode <=> OLD.periodMode) OR NOT (NEW.contingencyRatePercent <=> OLD.contingencyRatePercent) OR
           NOT (NEW.retainedBudgetHt <=> OLD.retainedBudgetHt) OR NOT (NEW.estimatedBudgetHt <=> OLD.estimatedBudgetHt) OR
           NOT (NEW.validatedBudgetHt <=> OLD.validatedBudgetHt) OR NOT (NEW.contingencyAmountHt <=> OLD.contingencyAmountHt) OR
           NOT (NEW.totalBudgetHt <=> OLD.totalBudgetHt) OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget scenario versions are immutable';
        END IF;
      END`);
  }

  async down(q: QueryRunner): Promise<void> {
    // ALL rows cannot be represented by the pre-migration non-null dates.
    const [row] = await q.query(`SELECT COUNT(*) count FROM prevention_budget_scenarios WHERE periodMode='ALL'`);
    if (Number(row?.count ?? 0) > 0) throw new Error('Cannot remove periodMode while ALL budget scenarios exist');
    await q.query('DROP INDEX IDX_prev_budget_scenario_org_mode ON prevention_budget_scenarios');
    await q.query('DROP TRIGGER `TRG_prev_budget_scenario_bu`');
    await q.query(`ALTER TABLE prevention_budget_scenarios
      MODIFY COLUMN periodStart date NOT NULL,
      MODIFY COLUMN periodEnd date NOT NULL,
      DROP COLUMN periodMode`);
    await q.query(`CREATE TRIGGER \`TRG_prev_budget_scenario_bu\` BEFORE UPDATE ON \`prevention_budget_scenarios\`
      FOR EACH ROW BEGIN
        IF NOT (NEW.organizationId <=> OLD.organizationId) OR NOT (NEW.scenarioKey <=> OLD.scenarioKey) OR
           NOT (NEW.version <=> OLD.version) OR NOT (NEW.sourceVersion <=> OLD.sourceVersion) OR
           NOT (NEW.periodStart <=> OLD.periodStart) OR NOT (NEW.periodEnd <=> OLD.periodEnd) OR
           NOT (NEW.contingencyRatePercent <=> OLD.contingencyRatePercent) OR
           NOT (NEW.retainedBudgetHt <=> OLD.retainedBudgetHt) OR NOT (NEW.estimatedBudgetHt <=> OLD.estimatedBudgetHt) OR
           NOT (NEW.validatedBudgetHt <=> OLD.validatedBudgetHt) OR NOT (NEW.contingencyAmountHt <=> OLD.contingencyAmountHt) OR
           NOT (NEW.totalBudgetHt <=> OLD.totalBudgetHt) OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Prevention budget scenario versions are immutable';
        END IF;
      END`);
  }
}
