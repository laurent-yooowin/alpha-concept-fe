import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import {
  calculatePreventionBudget,
} from './prevention-budget.calculator';
import { loadPreventionBudgetContingencyRate } from './prevention-budget.config';
import {
  PREVENTION_BUDGET_BUILD_JOB,
  PREVENTION_BUDGET_JOB_NAMES,
  PREVENTION_BUDGET_RECALCULATE_JOB,
  PREVENTION_BUDGET_RECONCILE_JOB,
  PREVENTION_BUDGET_REFRESH_ITEM_JOB,
  PreventionBudgetJobName,
  PreventionBudgetJobPayload,
  PreventionBudgetLineInput,
  PreventionBudgetPriority,
  PreventionBudgetStatus,
} from './prevention-budget.types';
import { PREVENTION_QUEUE_NAME } from '../outbox/prevention-outbox.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCKED_STATUSES: readonly PreventionBudgetStatus[] = ['VALIDE', 'ENGAGE', 'REALISE'];

export function validatePreventionBudgetPayload(
  jobName: string,
  value: unknown,
): PreventionBudgetJobPayload {
  if (!PREVENTION_BUDGET_JOB_NAMES.includes(jobName as PreventionBudgetJobName) ||
      !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnrecoverableError('Invalid prevention budget job payload');
  }
  const payload = value as Record<string, unknown>;
  const expected = jobName === PREVENTION_BUDGET_REFRESH_ITEM_JOB
    ? 'itemId|organizationId|scenarioId|scenarioVersion|sourceVersion'
    : 'organizationId|scenarioId|scenarioVersion|sourceVersion';
  if (Object.keys(payload).sort().join('|') !== expected ||
      !UUID_PATTERN.test(String(payload.organizationId)) ||
      !UUID_PATTERN.test(String(payload.scenarioId)) ||
      (jobName === PREVENTION_BUDGET_REFRESH_ITEM_JOB && !UUID_PATTERN.test(String(payload.itemId)))) {
    throw new UnrecoverableError('Invalid prevention budget job identifiers');
  }
  const scenarioVersion = Number(payload.scenarioVersion);
  if (!Number.isSafeInteger(scenarioVersion) || scenarioVersion < 1 ||
      typeof payload.sourceVersion !== 'string' || !/^[\w.:-]{1,64}$/.test(payload.sourceVersion)) {
    throw new UnrecoverableError('Invalid prevention budget job version');
  }
  return payload as unknown as PreventionBudgetJobPayload;
}

function canonical(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function priorityForRisk(risk: string): PreventionBudgetPriority {
  return risk === 'eleve' ? 'HIGH' : risk === 'moyen' ? 'MEDIUM' : 'LOW';
}

export function preventionBudgetJobId(name: PreventionBudgetJobName, payload: PreventionBudgetJobPayload): string {
  const suffix = payload.itemId ? `|${payload.itemId}` : '';
  const digest = createHash('sha256').update(`${name}|${payload.organizationId}|${payload.scenarioId}|${payload.sourceVersion}${suffix}`).digest('hex');
  return `prevention-budget-${digest}`;
}

@Injectable()
export class PreventionBudgetService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PreventionBudgetService.name);
  private queue: Queue | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('PREVENTION_CONSUMER_ENABLED', 'true') === 'false') return;
    this.queue = new Queue(PREVENTION_QUEUE_NAME, { connection: createPreventionRedisOptions(this.config) });
  }

  async onApplicationShutdown(): Promise<void> {
    const queue = this.queue;
    this.queue = null;
    if (queue) await queue.close();
  }

  async process(job: Job): Promise<string> {
    const payload = validatePreventionBudgetPayload(job.name, job.data);
    if (job.name === PREVENTION_BUDGET_REFRESH_ITEM_JOB) {
      const [item]: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM prevention_budget_items WHERE id=? AND organizationId=? AND scenarioId=?`,
        [payload.itemId, payload.organizationId, payload.scenarioId],
      );
      if (!item) throw new UnrecoverableError('Prevention budget item does not belong to organization/scenario');
    }
    const action = job.name === PREVENTION_BUDGET_BUILD_JOB ? 'BUILD'
      : job.name === PREVENTION_BUDGET_RECALCULATE_JOB ? 'RECALCULATE'
        : job.name === PREVENTION_BUDGET_REFRESH_ITEM_JOB ? 'REFRESH_ITEM' : 'RECONCILE';
    const result = await this.rebuildScenario(payload, action);
    return `${result.id}:${result.version}`;
  }

  enqueueBuild(payload: PreventionBudgetJobPayload): Promise<void> {
    return this.enqueue(PREVENTION_BUDGET_BUILD_JOB, payload);
  }

  enqueueRecalculate(payload: PreventionBudgetJobPayload): Promise<void> {
    return this.enqueue(PREVENTION_BUDGET_RECALCULATE_JOB, payload);
  }

  enqueueRefreshItem(payload: PreventionBudgetJobPayload & { itemId: string }): Promise<void> {
    return this.enqueue(PREVENTION_BUDGET_REFRESH_ITEM_JOB, payload);
  }

  enqueueReconcile(payload: PreventionBudgetJobPayload): Promise<void> {
    return this.enqueue(PREVENTION_BUDGET_RECONCILE_JOB, payload);
  }

  async enqueueReconcileForReport(organizationId: string, reportId: string, triggerVersion: string): Promise<number> {
    const scenarios: Array<{ id: string; version: number; sourceVersion: string }> = await this.dataSource.query(
      `SELECT DISTINCT s.id,s.version,s.sourceVersion
       FROM prevention_budget_scenarios s
       JOIN prevention_findings f ON f.organizationId=s.organizationId
         AND f.businessDate BETWEEN s.periodStart AND s.periodEnd
       WHERE s.organizationId=? AND f.reportId=? AND f.findingType='RECOMMENDATION'
         AND s.status<>'ARCHIVED'
         AND NOT EXISTS (SELECT 1 FROM prevention_budget_scenarios newer
           WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey
             AND newer.version>s.version)
       UNION
       SELECT DISTINCT s.id,s.version,s.sourceVersion
       FROM prevention_budget_scenarios s
       JOIN prevention_budget_items i ON i.organizationId=s.organizationId AND i.scenarioId=s.id
       JOIN prevention_budget_item_sources src ON src.organizationId=i.organizationId AND src.itemId=i.id
       WHERE s.organizationId=? AND src.reportId=? AND s.status<>'ARCHIVED'
         AND NOT EXISTS (SELECT 1 FROM prevention_budget_scenarios newer
           WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey
             AND newer.version>s.version)`, [organizationId, reportId, organizationId, reportId],
    );
    for (const scenario of scenarios) {
      const sourceVersion = createHash('sha256')
        .update(`${scenario.sourceVersion}|report|${reportId}|${triggerVersion}`)
        .digest('hex');
      await this.enqueue(PREVENTION_BUDGET_RECONCILE_JOB, {
        organizationId, scenarioId: scenario.id, scenarioVersion: scenario.version,
        sourceVersion,
      });
    }
    return scenarios.length;
  }

  async enqueueRefreshForCatalog(organizationId: string, catalogId: string): Promise<number> {
    const items: Array<{ scenarioId: string; scenarioVersion: number; sourceVersion: string; itemId: string; catalogVersion: number }> = await this.dataSource.query(
      `SELECT i.id itemId,i.scenarioId,s.version scenarioVersion,s.sourceVersion,c.version catalogVersion
       FROM prevention_budget_items i JOIN prevention_budget_scenarios s
         ON s.organizationId=i.organizationId AND s.id=i.scenarioId
       JOIN prevention_cost_catalog c ON c.organizationId=i.organizationId AND c.id=i.catalogId
       WHERE i.organizationId=? AND i.catalogId=? AND s.status<>'ARCHIVED'`, [organizationId, catalogId],
    );
    for (const item of items) {
      const sourceVersion = createHash('sha256')
        .update(`${item.sourceVersion}|catalog|${catalogId}|${item.catalogVersion}`)
        .digest('hex');
      await this.enqueue(PREVENTION_BUDGET_REFRESH_ITEM_JOB, {
        organizationId, scenarioId: item.scenarioId, scenarioVersion: item.scenarioVersion,
        sourceVersion, itemId: item.itemId,
      });
    }
    return items.length;
  }

  private async enqueue(name: PreventionBudgetJobName, payload: PreventionBudgetJobPayload): Promise<void> {
    if (!this.queue) throw new Error('Prevention budget queue is unavailable');
    const jobId = preventionBudgetJobId(name, payload);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
      else return;
    }
    await this.queue.add(name, payload, {
      jobId, attempts: 4, backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 1000, removeOnFail: 1000,
    });
  }

  private async rebuildScenario(
    payload: PreventionBudgetJobPayload,
    action: 'BUILD' | 'RECALCULATE' | 'REFRESH_ITEM' | 'RECONCILE',
  ): Promise<{ id: string; version: number }> {
    const defaultRate = loadPreventionBudgetContingencyRate(this.config);
    return this.dataSource.transaction(async (manager) => {
      const [base]: Array<any> = await manager.query(
        `SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? FOR UPDATE`,
        [payload.scenarioId, payload.organizationId],
      );
      if (!base) throw new UnrecoverableError('Prevention budget scenario not found in organization');
      const [already]: Array<any> = await manager.query(
        `SELECT id,version FROM prevention_budget_scenarios
         WHERE organizationId=? AND scenarioKey=? AND sourceVersion=? AND status<>'DRAFT' LIMIT 1`,
        [payload.organizationId, base.scenarioKey, payload.sourceVersion],
      );
      if (already) return already;
      const [latest]: Array<any> = await manager.query(
        `SELECT * FROM prevention_budget_scenarios
         WHERE organizationId=? AND scenarioKey=? ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [payload.organizationId, base.scenarioKey],
      );
      const nextVersion = Number(latest?.version ?? 0) + 1;
      const rate = base.contingencyRatePercent ?? defaultRate;
      const findings: Array<any> = await manager.query(
        `SELECT f.id,f.reportId,f.patternKey,f.normalizedKey,f.content,f.categoryId,
                f.riskLevel,f.businessDate,COALESCE(c.code,'UNCATEGORIZED') categoryKey
         FROM prevention_findings f LEFT JOIN prevention_categories c ON c.id=f.categoryId
           AND c.organizationId=f.organizationId
         WHERE f.organizationId=? AND f.findingType='RECOMMENDATION'
           AND f.businessDate BETWEEN ? AND ?
         ORDER BY f.patternKey,f.id`,
        [payload.organizationId, base.periodStart, base.periodEnd],
      );
      const catalog: Array<any> = await manager.query(
        `SELECT id,version,matchingKey,categoryKey,label,unit,unitCostHt,priceSource
         FROM prevention_cost_catalog
         WHERE organizationId=? AND isActive=1 AND validFrom<=? AND (validTo IS NULL OR validTo>=?)
         ORDER BY version DESC`, [payload.organizationId, base.periodEnd, base.periodStart],
      );
      const previous: Array<any> = latest ? await manager.query(
        `SELECT * FROM prevention_budget_items WHERE organizationId=? AND scenarioId=?`,
        [payload.organizationId, latest.id],
      ) : [];
      const previousByKey = new Map(previous.map((row) => [row.itemKey, row]));
      const groups = new Map<string, any[]>();
      for (const finding of findings) {
        const key = finding.patternKey || finding.normalizedKey;
        const group = groups.get(key) ?? [];
        group.push(finding);
        groups.set(key, group);
      }
      const inputs: PreventionBudgetLineInput[] = [...groups.entries()].map(([itemKey, group]) => {
        const first = group[0];
        const matching = catalog.find((entry) => entry.matchingKey === itemKey) ??
          catalog.find((entry) => entry.categoryKey === first.categoryKey && canonical(entry.label) === canonical(first.content));
        const old = previousByKey.get(itemKey);
        return {
          itemKey,
          title: String(first.content).slice(0, 500),
          categoryId: first.categoryId ?? null,
          categoryKey: first.categoryKey,
          priority: priorityForRisk(first.riskLevel),
          quantity: String(group.length),
          unit: 'ACTION',
          catalogMatch: matching ? { id: matching.id, unitCostHt: String(matching.unitCostHt), priceSource: matching.priceSource } : null,
          manual: old && LOCKED_STATUSES.includes(old.status) ? {
            quantity: String(old.quantity), unit: old.unit, unitCostHt: old.unitCostHt === null ? null : String(old.unitCostHt),
            priceSource: old.priceSource === null ? null : String(old.priceSource), status: old.status, priority: old.priority,
          } : undefined,
        };
      });
      const calculation = calculatePreventionBudget(inputs, String(rate));
      const scenarioId = randomUUID();
      await manager.query(
        `INSERT INTO prevention_budget_scenarios
          (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,status,contingencyRatePercent,
           retainedBudgetHt,estimatedBudgetHt,validatedBudgetHt,contingencyAmountHt,totalBudgetHt)
         VALUES (?,?,?,?,?,?,?,'CALCULATED',?,?,?,?,?,?)`,
        [scenarioId, payload.organizationId, base.scenarioKey, nextVersion, payload.sourceVersion,
          base.periodStart, base.periodEnd, calculation.totals.contingencyRatePercent,
          calculation.totals.retainedBudgetHt, calculation.totals.estimatedBudgetHt,
          calculation.totals.validatedBudgetHt, calculation.totals.contingencyAmountHt,
          calculation.totals.totalBudgetHt],
      );
      for (const line of calculation.lines) {
        const input = inputs.find((candidate) => candidate.itemKey === line.itemKey)!;
        const catalogMatch = input.catalogMatch;
        const old = previousByKey.get(line.itemKey);
        const itemId = randomUUID();
        await manager.query(
          `INSERT INTO prevention_budget_items
            (id,organizationId,scenarioId,itemKey,catalogId,categoryId,categoryKey,title,priority,quantity,unit,unitCostHt,totalHt,status,justification,priceSource,lockedManual)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [itemId, payload.organizationId, scenarioId, line.itemKey,
            line.lockedManual ? old?.catalogId ?? null : catalogMatch?.id ?? null,
            line.categoryId, line.categoryKey, line.title, line.priority, line.quantity, line.unit,
            line.unitCostHt, line.totalHt, line.status,
            line.lockedManual && old?.justification
              ? old.justification
              : `Consolidé depuis ${groups.get(line.itemKey)?.length ?? 0} recommandation(s)`,
            line.priceSource, line.lockedManual ? 1 : 0],
        );
        for (const finding of groups.get(line.itemKey) ?? []) {
          await manager.query(
            `INSERT INTO prevention_budget_item_sources
              (id,organizationId,itemId,sourceKind,findingId,reportId) VALUES (?,?,?,'RECOMMENDATION',?,?)`,
            [randomUUID(), payload.organizationId, itemId, finding.id, finding.reportId],
          );
        }
      }
      await manager.query(
        `INSERT INTO prevention_budget_audit
          (id,organizationId,scenarioId,scenarioVersion,action,afterState)
         VALUES (?,?,?,?,?,?)`,
        [randomUUID(), payload.organizationId, scenarioId, nextVersion, action,
          JSON.stringify({ lineCount: calculation.lines.length, totals: calculation.totals })],
      );
      return { id: scenarioId, version: nextVersion };
    });
  }
}

