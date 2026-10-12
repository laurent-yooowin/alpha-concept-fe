import 'reflect-metadata';
import { createHash, randomUUID } from 'crypto';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import dataSource from '../config/typeorm.config';

config();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Scenario = { id: string; organizationId: string; scenarioKey: string; version: number; sourceVersion: string;
  status: string; retainedBudgetHt: string; contingencyRatePercent: string; contingencyAmountHt: string; totalBudgetHt: string };

function moneyCents(value: unknown): bigint {
  const text = String(value);
  if (!/^\d{1,16}\.\d{2}$/.test(text)) throw new Error('Invalid stored budget amount');
  const [whole, fraction] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

/** Publishes corrected current versions, retaining all earlier scenarios and their human-locked items. */
export async function removePreventionBudgetContingency(db: DataSource, organizationId: string, apply = false) {
  if (!UUID.test(organizationId)) throw new Error('A valid organization UUID is required');
  const candidates: Scenario[] = await db.query(`SELECT s.* FROM prevention_budget_scenarios s
    WHERE s.organizationId=? AND s.status IN ('CALCULATED','VALIDATED')
      AND s.version=(SELECT MAX(v.version) FROM prevention_budget_scenarios v
        WHERE v.organizationId=s.organizationId AND v.scenarioKey=s.scenarioKey)
      AND (s.contingencyRatePercent<>0 OR s.contingencyAmountHt<>0 OR s.totalBudgetHt<>s.retainedBudgetHt)
    ORDER BY s.scenarioKey LIMIT 1001`, [organizationId]);
  if (candidates.length > 1000) throw new Error('More than 1000 scenarios require correction; use a bounded maintenance window');
  if (!apply) {
    const [active] = await db.query(`SELECT COUNT(*) total FROM prevention_budget_global_runs
      WHERE organizationId=? AND status IN ('PENDING','PROCESSING','SUSPENDED')`, [organizationId]);
    return { candidates: candidates.length, activeGlobalRuns: Number(active?.total ?? 0),
      targets: candidates.map((row) => ({ scenarioKey: row.scenarioKey, version: Number(row.version),
        retainedBudgetHt: row.retainedBudgetHt, totalBudgetHt: row.totalBudgetHt })),
      published: 0, skipped: 0, dryRun: true };
  }
  let published = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const corrected = await db.transaction(async (manager) => {
      const [activeRun] = await manager.query(`SELECT id FROM prevention_budget_global_runs
        WHERE organizationId=? AND status IN ('PENDING','PROCESSING','SUSPENDED') LIMIT 1`, [organizationId]);
      if (activeRun) throw new Error('An active global budget run exists; retry after completion');
      const [latest]: Scenario[] = await manager.query(`SELECT * FROM prevention_budget_scenarios
        WHERE organizationId=? AND scenarioKey=? ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [organizationId, candidate.scenarioKey]);
      if (!latest || latest.id !== candidate.id) return false;
      if (!['CALCULATED', 'VALIDATED'].includes(latest.status)) return false;
      const id = randomUUID();
      const version = Number(latest.version) + 1;
      const sourceVersion = createHash('sha256').update(`remove-contingency-v1|${latest.id}|${version}`).digest('hex');
      await manager.query(`INSERT INTO prevention_budget_scenarios
        (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,categoryId,severity,clientKeys,
         adminPrompt,adminPromptActorId,status,executionStatus,contingencyRatePercent,retainedBudgetHt,estimatedBudgetHt,
         validatedBudgetHt,contingencyAmountHt,totalBudgetHt)
        SELECT ?,organizationId,scenarioKey,?, ?,periodStart,periodEnd,periodMode,missionId,categoryId,severity,clientKeys,
         adminPrompt,adminPromptActorId,status,'COMPLETED',0,retainedBudgetHt,estimatedBudgetHt,
         validatedBudgetHt,0,retainedBudgetHt
        FROM prevention_budget_scenarios WHERE organizationId=? AND id=?`,
      [id, version, sourceVersion, organizationId, latest.id]);
      const items: Array<{ id: string; totalHt: string }> = await manager.query(`SELECT id,totalHt FROM prevention_budget_items
        WHERE organizationId=? AND scenarioId=? ORDER BY id`, [organizationId, latest.id]);
      const itemTotal = items.reduce((sum, item) => sum + moneyCents(item.totalHt), 0n);
      if (itemTotal !== moneyCents(latest.retainedBudgetHt)) {
        throw new Error(`Stored retained total does not match items for scenario ${latest.id}`);
      }
      for (const item of items) {
        const itemId = randomUUID();
        await manager.query(`INSERT INTO prevention_budget_items
          (id,organizationId,scenarioId,itemKey,catalogId,categoryId,categoryKey,clientKey,clientLabel,title,priority,quantity,unit,
           unitCostHt,totalHt,status,justification,aiEstimateDetails,adminPrompt,adminPromptActorId,priceSource,lockedManual)
          SELECT ?,organizationId,?,itemKey,catalogId,categoryId,categoryKey,clientKey,clientLabel,title,priority,quantity,unit,
           unitCostHt,totalHt,status,justification,aiEstimateDetails,adminPrompt,adminPromptActorId,priceSource,lockedManual
          FROM prevention_budget_items WHERE organizationId=? AND scenarioId=? AND id=?`,
        [itemId, id, organizationId, latest.id, item.id]);
        const sources: Array<{ id: string }> = await manager.query(`SELECT id FROM prevention_budget_item_sources
          WHERE organizationId=? AND itemId=? ORDER BY id`, [organizationId, item.id]);
        for (const source of sources) await manager.query(`INSERT INTO prevention_budget_item_sources
          (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId)
          SELECT ?,organizationId,?,sourceKind,sourceKey,findingId,reportId
          FROM prevention_budget_item_sources WHERE organizationId=? AND itemId=? AND id=?`,
        [randomUUID(), itemId, organizationId, item.id, source.id]);
      }
      await manager.query(`INSERT INTO prevention_budget_audit
        (id,organizationId,scenarioId,scenarioVersion,action,actorType,actorId,beforeState,afterState)
        VALUES (?,?,?,?,'RECONCILE','WORKER',NULL,?,?)`,
      [randomUUID(), organizationId, id, version,
        JSON.stringify({ scenarioId: latest.id, version: latest.version, totalBudgetHt: latest.totalBudgetHt }),
        JSON.stringify({ reason: 'REMOVE_CONTINGENCY', sourceScenarioId: latest.id, totalBudgetHt: latest.retainedBudgetHt })]);
      return true;
    });
    if (corrected) published += 1; else skipped += 1;
  }
  return { candidates: candidates.length, published, skipped, dryRun: false };
}

async function main() {
  const organizationId = process.env.PREVENTION_BUDGET_NO_CONTINGENCY_ORG_ID?.trim() ?? '';
  const apply = process.env.PREVENTION_BUDGET_NO_CONTINGENCY_APPLY === 'true';
  const db = new DataSource({ ...dataSource.options, logging: false });
  try {
    await db.initialize();
    console.log(JSON.stringify({ organizationId, ...await removePreventionBudgetContingency(db, organizationId, apply) }));
  } finally { if (db.isInitialized) await db.destroy(); }
}

if (require.main === module) void main().catch((error) => {
  console.error(JSON.stringify({ event: 'PREVENTION_BUDGET_REMOVE_CONTINGENCY_FAILED', message: error?.message ?? 'Unknown error' }));
  process.exitCode = 1;
});
