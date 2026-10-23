import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
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
  PREVENTION_BUDGET_RECALCULATE_ITEM_JOB,
  PREVENTION_BUDGET_GLOBAL_JOB,
  PREVENTION_BUDGET_RECONCILE_JOB,
  PREVENTION_BUDGET_REFRESH_ITEM_JOB,
  PreventionBudgetJobName,
  PreventionBudgetJobPayload,
  PreventionBudgetLineInput,
  PreventionBudgetStatus,
} from './prevention-budget.types';
import { PREVENTION_QUEUE_NAME } from '../outbox/prevention-outbox.types';
import { PREVENTION_BULK_QUEUE_NAME } from '../queue/prevention-queue.constants';
import { PreventionActivationService } from '../prevention-activation.service';
import { PreventionBulkAdmissionService } from '../scheduler/prevention-bulk-admission.service';
import type { PreventionBulkLease } from '../scheduler/prevention-bulk-admission.types';
import { isWithinPreventionBulkWindow, nextPreventionBulkWindowStart } from '../scheduler/prevention-bulk.config';
import { PreventionBudgetEstimationAiService, PreventionBudgetAiEstimate, PreventionBudgetEstimateInput } from './prevention-budget-estimation-ai.service';
import { budgetReportEstimateInputHash, parseBudgetReportEstimate } from './prevention-budget-report-estimate';
import { budgetActionGroup, isPriceableActionGroup } from './prevention-budget-grouping';
import { budgetClientActionKey, budgetClientIdentity, storedBudgetClientKeys } from './prevention-budget-client';
import { maximumReportBudgetEstimate } from './prevention-budget-report-maximum';
import { materializedActionScopeKey } from './prevention-budget-materialized';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCKED_STATUSES: readonly PreventionBudgetStatus[] = ['VALIDE', 'ENGAGE', 'REALISE'];
const BUDGET_CALCULATION_VERSION = 'budget-client-action-v1';
const GLOBAL_ESTIMATE_PAGE_SIZE = 40;

interface PreparedReportEstimate {
  input: PreventionBudgetEstimateInput;
  inputHash: string;
  previousId: string | null;
  estimate: PreventionBudgetAiEstimate;
  fresh: boolean;
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Canonical key for a budget scope. Keep this in the budget layer so worker
 * initiated runs (including Hyper Admin recovery) address the same durable
 * scenario as the regular budget API.
 */
export function preventionBudgetScopeKey(
  organizationId: string,
  periodMode: 'ALL' | 'BOUNDED',
  period: { start: string | null; end: string | null },
  categoryId: string | null,
  severity: string | null,
  clientKeys: string[],
  missionId: string | null = null,
  categoryIds: string[] = [],
  severities: string[] = [],
  missionIds: string[] = [],
): string {
  const uniqueCategories = [...new Set([...categoryIds, ...(categoryId ? [categoryId] : [])])].sort();
  const uniqueSeverities = [...new Set([...severities, ...(severity ? [severity] : [])])].sort();
  const normalizedCategories = uniqueCategories.join(',') || (categoryId ?? '');
  const normalizedSeverities = uniqueSeverities.join(',') || (severity ?? '');
  const normalizedMissions = [...new Set([...missionIds, ...(missionId ? [missionId] : [])])].sort();
  const actualMulti = uniqueCategories.length > 1 || uniqueSeverities.length > 1 || normalizedMissions.length > 1;
  const signature = periodMode === 'ALL'
    ? `|${organizationId}|ALL|${normalizedCategories}|${normalizedSeverities}`
    : `|${organizationId}|${period.start}|${period.end}|${normalizedCategories}|${normalizedSeverities}`;
  if (actualMulti) return createHash('sha256').update(`budget-scope-v4${signature}|${normalizedMissions.join(',')}|${clientKeys.join(',')}`).digest('hex');
  if (normalizedMissions.length === 1) return createHash('sha256').update(`budget-scope-v3${signature}|${clientKeys.join(',')}|${normalizedMissions[0]}`).digest('hex');
  return clientKeys.length
    ? createHash('sha256').update(`budget-scope-v2${signature}|${clientKeys.join(',')}`).digest('hex')
    : createHash('sha256').update(`${periodMode === 'ALL' ? 'budget-scope-all-v1' : 'budget-scope-v1'}${signature}`).digest('hex');
}

export function preventionBudgetAnnualScenarioKey(runId: string, globalScopeKey: string, year: number): string {
  return createHash('sha256').update(`prevention-budget-global-year-key-v1|${runId}|${globalScopeKey}|${year}`).digest('hex');
}

export function canReusePublishedGlobalRun(run: { status?: string; sourceVersion?: string } | null | undefined, sourceVersion: string): boolean {
  return run?.status === 'PUBLISHED' && run.sourceVersion === sourceVersion;
}

class PreventionBudgetWindowClosedError extends Error {
  readonly code = 'PREVENTION_BUDGET_WINDOW_CLOSED';
}

function budgetSeverityFilter(value: string | string[] | null | undefined): { sql: string; args: unknown[] } {
  const values = [...new Set(Array.isArray(value) ? value : value ? [value] : [])];
  if (!values.length) return { sql: '', args: [] };
  const simple = values.filter((item) => item === 'faible' || item === 'moyen');
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (simple.length) { clauses.push('f.riskLevel IN (?)'); args.push(simple); }
  if (values.some((item) => !['faible', 'moyen', 'eleve', 'critique'].includes(item))) throw new UnrecoverableError('Invalid budget severity scope');
  const score = `(SELECT MAX(ps.score) FROM prevention_priority_scores ps
    WHERE ps.organizationId=f.organizationId AND ps.patternKey=f.patternKey
      AND ps.missionType=f.missionType AND ps.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED')
      AND ps.findingType=f.findingType)`;
  if (values.includes('critique')) { clauses.push(`(f.riskLevel='eleve' AND COALESCE(${score},0)>=?)`); args.push(80); }
  if (values.includes('eleve')) { clauses.push(`(f.riskLevel='eleve' AND COALESCE(${score},0)<?)`); args.push(80); }
  return { sql: clauses.length ? `AND (${clauses.join(' OR ')})` : '', args };
}

function storedStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  let parsed: unknown;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new UnrecoverableError('Invalid stored Prevention budget scope'); }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new UnrecoverableError('Invalid stored Prevention budget scope');
  }
  return [...new Set(parsed.map((item: string) => item.trim()))];
}

export function budgetPeriodPredicate(periodMode: unknown, periodStart: unknown, periodEnd: unknown, alias = 'f'): { sql: string; args: unknown[] } {
  if (periodMode === 'ALL') return { sql: '', args: [] };
  if (!periodStart || !periodEnd) throw new UnrecoverableError('Bounded prevention budget scenario has no period');
  return { sql: `AND ${alias}.businessDate BETWEEN ? AND ?`, args: [periodStart, periodEnd] };
}

/**
 * A global run is a coherent snapshot, not a best-effort walk over changing
 * findings.  The fingerprint includes the complete tenant-scoped source
 * material, not only append-only timestamps: findings and catalogue entries
 * may be edited in place while a multi-night run is paused.
 */
export async function loadPreventionBudgetSourceVersion(
  db: { query: (sql: string, args?: unknown[]) => Promise<any[]> },
  organizationId: string,
  includeDerivedFields = true,
): Promise<string> {
  const [summary] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM reports r JOIN visits v ON v.id=r.visitId AND v.organizationId=r.organizationId WHERE r.organizationId=?) reportCount,
       (SELECT COALESCE(MAX(r.updatedAt),'') FROM reports r JOIN visits v ON v.id=r.visitId AND v.organizationId=r.organizationId WHERE r.organizationId=?) reportUpdatedAt,
       (SELECT COUNT(*) FROM prevention_findings f WHERE f.organizationId=?) findingCount,
       (SELECT COALESCE(MAX(c.version),0) FROM prevention_cost_catalog c WHERE c.organizationId=?) catalogVersion`,
    [organizationId, organizationId, organizationId, organizationId],
  );
  const findings = await db.query(
    `SELECT id,snapshotId,reportId,visitId,missionId,sourceGroupId,sourceKind,findingType,categoryId,normalizedKey,patternKey,
            content,danger,risk,riskLevel,confidence,actionType,actionTypeConfidence,actionTypeVersion,
            actionMetric,regulatoryReferences,businessDate,missionType,createdAt
       FROM prevention_findings WHERE organizationId=? ORDER BY id`, [organizationId],
  );
  const catalog = await db.query(
    `SELECT id,version,matchingKey,categoryId,categoryKey,label,unit,unitCostHt,priceSource,
            validFrom,validTo,isActive,createdAt
       FROM prevention_cost_catalog WHERE organizationId=? ORDER BY id`, [organizationId],
  );
  const stable = (rows: any[], fields: string[]) => rows.map((row) => fields.map((field) => row?.[field] ?? null));
  const findingFields = ['id', 'snapshotId', 'reportId', 'visitId', 'missionId', 'sourceGroupId', 'sourceKind', 'findingType', 'categoryId', 'normalizedKey', 'patternKey',
    'content', 'danger', 'risk', 'riskLevel', 'confidence',
    ...(includeDerivedFields ? ['actionType', 'actionTypeConfidence', 'actionTypeVersion', 'actionMetric'] : []),
    'regulatoryReferences', 'businessDate', 'missionType'];
  const catalogFields = ['id', 'version', 'matchingKey', 'categoryId', 'categoryKey', 'label', 'unit', 'unitCostHt', 'priceSource',
    'validFrom', 'validTo', 'isActive', 'createdAt'];
  return createHash('sha256').update(`prevention-budget-source-v3|${organizationId}|${JSON.stringify({
    summary: summary ?? {}, findings: stable(findings, findingFields), catalog: stable(catalog, catalogFields),
  })}`).digest('hex');
}

/** Fingerprint of the SPS inputs, independent of asynchronously materialized
 * Prevention findings. Group processing and report reindexing may legitimately
 * replace findings, risks and their creation timestamps during a recovery. */
export async function loadPreventionBudgetRawSourceVersion(
  db: { query: (sql: string, args?: unknown[]) => Promise<any[]> },
  organizationId: string,
): Promise<string> {
  const reports = await db.query(
    `SELECT r.id,r.visitId,r.missionId,r.status,r.updatedAt,
            v.visitDate,v.updatedAt AS visitUpdatedAt,
            SHA2(COALESCE(CAST(v.photos AS CHAR),''),256) AS photosHash,
            m.type AS missionType,m.client AS missionClient,m.updatedAt AS missionUpdatedAt
       FROM reports r
       JOIN visits v ON v.id=r.visitId AND v.organizationId=r.organizationId
       JOIN missions m ON m.id=r.missionId AND m.organizationId=r.organizationId
       WHERE r.organizationId=? ORDER BY r.id`, [organizationId],
  );
  const catalog = await db.query(
    `SELECT id,version,matchingKey,categoryId,categoryKey,label,unit,unitCostHt,priceSource,
            validFrom,validTo,isActive,createdAt
       FROM prevention_cost_catalog WHERE organizationId=? ORDER BY id`, [organizationId],
  );
  return createHash('sha256').update(`prevention-raw-source-v1|${organizationId}|${JSON.stringify({ reports, catalog })}`).digest('hex');
}

export function appendMissingLockedBudgetLines(
  inputs: PreventionBudgetLineInput[],
  previous: Array<any>,
): PreventionBudgetLineInput[] {
  const existingKeys = new Set(inputs.map((input) => input.itemKey));
  for (const old of previous) {
    if (existingKeys.has(old.itemKey) || (!old.lockedManual && !LOCKED_STATUSES.includes(old.status))) continue;
    inputs.push({
      itemKey: old.itemKey,
      title: old.title,
      categoryId: old.categoryId ?? null,
      categoryKey: old.categoryKey,
      clientKey: old.clientKey ?? null,
      clientLabel: old.clientLabel ?? 'Historique multi-clients (montant verrouillé)',
      priority: old.priority,
      quantity: String(old.quantity),
      unit: old.unit,
      catalogMatch: null,
      manual: {
        quantity: String(old.quantity), unit: old.unit,
        unitCostHt: old.unitCostHt === null ? null : String(old.unitCostHt),
        priceSource: old.priceSource === null ? null : String(old.priceSource),
        status: old.status, priority: old.priority, lockedManual: true,
        aiEstimateDetails: parseAiEstimateDetails(old.aiEstimateDetails),
      },
    });
    existingKeys.add(old.itemKey);
  }
  return inputs;
}

/** Select one client/action line for global publication. Annual totals are
 * compared by MAX; a locked line always wins, including a prior locked ALL
 * line carried forward from the previous publication. */
export function selectGlobalBudgetRows(rows: Array<any>, previousItems: Array<any>): Array<any> {
  const chosen = new Map<string, any>();
  const isLocked = (row: any) => Boolean(row.lockedManual) || LOCKED_STATUSES.includes(row.status);
  const cents = (value: unknown) => {
    const [whole, fraction = ''] = String(value ?? '0').split('.');
    return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  };
  for (const row of rows) {
    const old = chosen.get(row.itemKey);
    if (!old || (isLocked(row) && !isLocked(old)) ||
      (isLocked(row) === isLocked(old) && cents(row.totalHt) > cents(old.totalHt)) ||
      (isLocked(row) && isLocked(old) && Number(row.year) > Number(old.year))) chosen.set(row.itemKey, row);
  }
  for (const row of previousItems) if (isLocked(row)) chosen.set(row.itemKey, row);
  return [...chosen.values()];
}

export function mergeGlobalBudgetSources(sourceRows: Array<any>, previousSourceRows: Array<any>): Map<string, any[]> {
  const sourceByKey = new Map<string, any[]>();
  for (const source of [...sourceRows, ...previousSourceRows]) {
    sourceByKey.set(source.itemKey, [...(sourceByKey.get(source.itemKey) ?? []), source]);
  }
  return sourceByKey;
}

export interface PreventionBudgetScenarioReference {
  organizationId: string;
  scenarioId: string;
  scenarioVersion: number;
  sourceVersion: string;
}

interface PreventionBudgetReconciliationIntentRow extends PreventionBudgetScenarioReference {
  id: string;
}

interface PreventionBudgetGlobalEstimateCheckpoint {
  organizationId: string;
  runId: string;
  scenarioId?: string;
  year: number;
  checkpointId: string;
  sourceVersion: string;
  assertSourceStable: () => Promise<void>;
  enforceWindow?: boolean;
  storage: 'GLOBAL' | 'BOUNDED';
}

type PreventionBudgetEnqueueRequest = Omit<PreventionBudgetJobPayload, 'scenarioVersion' | 'sourceVersion' | 'executionMode'> & {
  scenarioVersion?: number;
  sourceVersion?: string;
  runId?: string;
  year?: number;
  executionMode?: 'IMMEDIATE' | 'SCHEDULED';
  delayMs?: number;
};

export interface PreventionBudgetEnqueuedJob {
  id: string;
  status: 'QUEUED' | 'DEDUPLICATED';
  name: PreventionBudgetJobName;
  scenarioId: string;
  scenarioVersion: number;
}

export function validatePreventionBudgetPayload(
  jobName: string,
  value: unknown,
): PreventionBudgetJobPayload {
  if (!PREVENTION_BUDGET_JOB_NAMES.includes(jobName as PreventionBudgetJobName) ||
      !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnrecoverableError('Invalid prevention budget job payload');
  }
  const payload = value as Record<string, unknown>;
  const hasEstimateOrder = Object.prototype.hasOwnProperty.call(payload, 'estimateRequestOrder');
  const allowsEstimateOrder = jobName === PREVENTION_BUDGET_RECALCULATE_JOB || jobName === PREVENTION_BUDGET_RECALCULATE_ITEM_JOB;
  const isBulkBounded = jobName !== PREVENTION_BUDGET_GLOBAL_JOB && typeof (value as any)?.runId === 'string' && typeof (value as any)?.executionMode === 'string';
  const expected = jobName === PREVENTION_BUDGET_GLOBAL_JOB
    ? 'organizationId|runId|scenarioId|scenarioVersion|sourceVersion|year'
    : isBulkBounded
    ? 'executionMode|organizationId|runId|scenarioId|scenarioVersion|sourceVersion'
    : (jobName === PREVENTION_BUDGET_REFRESH_ITEM_JOB || jobName === PREVENTION_BUDGET_RECALCULATE_ITEM_JOB)
    ? 'itemId|organizationId|scenarioId|scenarioVersion|sourceVersion'
    : 'organizationId|scenarioId|scenarioVersion|sourceVersion';
  const invalidRunId = (jobName === PREVENTION_BUDGET_GLOBAL_JOB || isBulkBounded) &&
    !UUID_PATTERN.test(String(payload.runId));
  const invalidBulkMode = isBulkBounded && !['IMMEDIATE', 'SCHEDULED'].includes(String(payload.executionMode));
  const invalidItemId = (jobName === PREVENTION_BUDGET_REFRESH_ITEM_JOB ||
    jobName === PREVENTION_BUDGET_RECALCULATE_ITEM_JOB) && !UUID_PATTERN.test(String(payload.itemId));
  if (Object.keys(payload).filter((key) => key !== 'estimateRequestOrder').sort().join('|') !== expected ||
      (hasEstimateOrder && (!allowsEstimateOrder || !Number.isSafeInteger(payload.estimateRequestOrder) || Number(payload.estimateRequestOrder) < 1)) ||
      !UUID_PATTERN.test(String(payload.organizationId)) ||
      !UUID_PATTERN.test(String(payload.scenarioId)) ||
      invalidRunId || invalidBulkMode || invalidItemId) {
    throw new UnrecoverableError('Invalid prevention budget job identifiers');
  }
  const scenarioVersion = Number(payload.scenarioVersion);
  if (!Number.isSafeInteger(scenarioVersion) || scenarioVersion < 1 ||
      typeof payload.sourceVersion !== 'string' || !/^[\w.:-]{1,64}$/.test(payload.sourceVersion)) {
    throw new UnrecoverableError('Invalid prevention budget job version');
  }
  if (jobName === PREVENTION_BUDGET_GLOBAL_JOB &&
      (!Number.isSafeInteger(Number(payload.year)) || Number(payload.year) < 1900 || Number(payload.year) > 9999)) {
    throw new UnrecoverableError('Invalid prevention budget global year');
  }
  return payload as unknown as PreventionBudgetJobPayload;
}

export function preventionBudgetJobId(name: PreventionBudgetJobName, payload: PreventionBudgetJobPayload): string {
  const suffix = payload.itemId ? `|${payload.itemId}` : '';
  const globalSuffix = payload.runId ? `|${payload.runId}|${payload.year ?? ''}` : '';
  const digest = createHash('sha256').update(`${name}|${payload.organizationId}|${payload.scenarioId}|${payload.sourceVersion}${suffix}${globalSuffix}`).digest('hex');
  return `prevention-budget-${digest}`;
}

export function assertPreventionBudgetScenarioVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new UnrecoverableError('Prevention budget scenario version is stale');
}

export function preventionBudgetSourceKey(sourceKind: 'RECOMMENDATION' | 'FINDING' | 'REPORT', findingId: string | null, reportId: string): string {
  return createHash('sha256').update(`${sourceKind}|${findingId ?? ''}|${reportId}`).digest('hex');
}

export function preventionBudgetStableRecommendationKey(finding: {
  reportId: string; sourceGroupId: string | null; normalizedKey: string;
}): string {
  return createHash('sha256').update(`RECOMMENDATION|${finding.reportId}|${finding.sourceGroupId ?? ''}|${finding.normalizedKey}`).digest('hex');
}

@Injectable()
export class PreventionBudgetService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PreventionBudgetService.name);
  private queue: Queue | null = null;
  private bulkQueue: Queue | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Optional() private readonly estimateAi?: PreventionBudgetEstimationAiService,
    @Optional() private readonly activation?: PreventionActivationService,
    @Optional() private readonly bulkAdmission?: PreventionBulkAdmissionService,
  ) {}

  onApplicationBootstrap(): void {
    // The HTTP application must remain able to enqueue budget work even when
    // the worker consumer is deployed separately or disabled in this process.
    this.queue = new Queue(PREVENTION_QUEUE_NAME, { connection: createPreventionRedisOptions(this.config) });
    this.bulkQueue = new Queue(PREVENTION_BULK_QUEUE_NAME, { connection: createPreventionRedisOptions(this.config) });
  }

  async onApplicationShutdown(): Promise<void> {
    const queue = this.queue;
    const bulkQueue = this.bulkQueue;
    this.queue = null;
    this.bulkQueue = null;
    if (queue) await queue.close();
    if (bulkQueue) await bulkQueue.close();
  }

  private async markBoundedBudgetProcessing(payload: PreventionBudgetJobPayload): Promise<void> {
    if (!payload.runId) return;
    await this.dataSource.query(
      `UPDATE prevention_budget_scenarios SET executionStatus='PROCESSING',availableAt=NULL
       WHERE id=? AND organizationId=? AND status='DRAFT'`, [payload.scenarioId, payload.organizationId],
    );
  }

  private async suspendBoundedBudget(payload: PreventionBudgetJobPayload, availableAt: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE prevention_budget_scenarios SET executionStatus='SUSPENDED',availableAt=?,lastError=?
       WHERE id=? AND organizationId=? AND status='DRAFT'`,
      [new Date(availableAt), 'Prevention budget bulk window closed at Europe/Paris 06:00', payload.scenarioId, payload.organizationId],
    );
  }

  private async suspendGlobalCheckpoint(payload: PreventionBudgetJobPayload, availableAt: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE prevention_budget_global_years SET status='SUSPENDED',availableAt=?,lastError=?
       WHERE runId=? AND organizationId=? AND year=? AND status IN ('PENDING','PROCESSING','SUSPENDED')`,
      [new Date(availableAt), 'Prevention budget bulk window closed at Europe/Paris 06:00', payload.runId, payload.organizationId, payload.year],
    );
    await this.dataSource.query(
      `UPDATE prevention_budget_global_runs SET status='SUSPENDED',lastError=?
       WHERE id=? AND organizationId=? AND status<>'PUBLISHED'`,
      ['Prevention budget bulk window closed at Europe/Paris 06:00', payload.runId, payload.organizationId],
    );
  }

  private async enqueueBudgetContinuation(name: PreventionBudgetJobName, payload: PreventionBudgetJobPayload, availableAt: Date): Promise<void> {
    if (!this.bulkQueue) return;
    const baseId = preventionBudgetJobId(name, payload);
    const delayMs = Math.max(1_000, availableAt.getTime() - Date.now());
    await this.bulkQueue.add(name, payload, {
      jobId: `${baseId}-resume-${availableAt.getTime()}`,
      delay: delayMs,
      attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async process(job: Job): Promise<string> {
    const payload = validatePreventionBudgetPayload(job.name, job.data);
    if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
    try {
      if (job.name === PREVENTION_BUDGET_REFRESH_ITEM_JOB || job.name === PREVENTION_BUDGET_RECALCULATE_ITEM_JOB) {
        const [item]: Array<{ id: string }> = await this.dataSource.query(
          `SELECT id FROM prevention_budget_items WHERE id=? AND organizationId=? AND scenarioId=?`,
          [payload.itemId, payload.organizationId, payload.scenarioId],
        );
        if (!item) throw new UnrecoverableError('Prevention budget item does not belong to organization/scenario');
      }
      if (job.name === PREVENTION_BUDGET_RECALCULATE_ITEM_JOB) {
        const result = await this.recalculateScenarioItem(payload, job.timestamp);
        await this.propagateReportPrices(payload.organizationId, result.id, job.id ?? String(job.timestamp));
        return `${result.id}:${result.version}`;
      }
      if (job.name === PREVENTION_BUDGET_GLOBAL_JOB) {
        const result = await this.processGlobalYear(payload);
        if ((result as any).suspended) return 'SUSPENDED_WINDOW';
        return `${result.id}:${result.version}`;
      }
      const action = job.name === PREVENTION_BUDGET_BUILD_JOB ? 'BUILD'
        : job.name === PREVENTION_BUDGET_RECALCULATE_JOB ? 'RECALCULATE'
          : job.name === PREVENTION_BUDGET_REFRESH_ITEM_JOB ? 'REFRESH_ITEM' : 'RECONCILE';
      if (payload.runId) {
        if (!this.bulkAdmission) throw new Error('Prevention bulk admission is unavailable for bounded budget processing');
        const admission = await this.bulkAdmission.admit({ organizationId: payload.organizationId, runId: payload.runId, workKind: 'BUDGET', executionMode: payload.executionMode });
        if (!admission.admitted || !admission.lease) {
          if (admission.reason === 'OUTSIDE_WINDOW' && payload.executionMode === 'SCHEDULED') {
            const availableAt = admission.availableAt ?? nextPreventionBulkWindowStart(new Date(), this.bulkAdmission.settings).toISOString();
            await this.suspendBoundedBudget(payload, availableAt);
            await this.enqueueBudgetContinuation(job.name as PreventionBudgetJobName, payload, new Date(availableAt));
            return 'SUSPENDED_WINDOW';
          }
          throw new Error(`Bounded budget waiting for bulk admission: ${admission.reason}`);
        }
        try {
          const result = await this.bulkAdmission.withLease(admission.lease, async () => {
            await this.markBoundedBudgetProcessing(payload);
            const calculated = await this.rebuildScenario(payload, action, () => this.bulkAdmission!.assertLease(admission.lease!), {
              organizationId: payload.organizationId,
              runId: payload.runId!,
              scenarioId: payload.scenarioId,
              year: 0,
              checkpointId: payload.scenarioId,
              sourceVersion: payload.sourceVersion,
              assertSourceStable: () => this.bulkAdmission!.assertLease(admission.lease!),
              enforceWindow: payload.executionMode === 'SCHEDULED',
              storage: 'BOUNDED',
            }, job.timestamp);
            await this.bulkAdmission!.assertLease(admission.lease!);
            await this.dataSource.query(
              `UPDATE prevention_budget_scenarios SET executionStatus='COMPLETED',availableAt=NULL,lastError=NULL
               WHERE id=? AND organizationId=?`, [calculated.id, payload.organizationId],
            );
            return calculated;
          });
          if (action === 'RECALCULATE') {
            await this.propagateReportPrices(payload.organizationId, result.id, job.id ?? String(job.timestamp));
          }
          return `${result.id}:${result.version}`;
        } catch (error) {
          if (error instanceof PreventionBudgetWindowClosedError && payload.executionMode === 'SCHEDULED') {
            const availableAt = nextPreventionBulkWindowStart(new Date(), this.bulkAdmission.settings).toISOString();
            await this.suspendBoundedBudget(payload, availableAt);
            await this.enqueueBudgetContinuation(job.name as PreventionBudgetJobName, payload, new Date(availableAt));
            return 'SUSPENDED_WINDOW';
          }
          throw error;
        } finally {
          await this.bulkAdmission.release(admission.lease).catch(() => undefined);
        }
      }
      const result = await this.rebuildScenario(payload, action, undefined, undefined, job.timestamp);
      if (action === 'RECALCULATE') {
        await this.propagateReportPrices(payload.organizationId, result.id, job.id ?? String(job.timestamp));
      }
      return `${result.id}:${result.version}`;
    } catch (error) {
      if (job.name === PREVENTION_BUDGET_RECALCULATE_ITEM_JOB && this.isTerminalAttempt(job, error)) {
        await this.markTargetedScenarioFailed(payload);
      }
      throw error;
    }
  }

  private isTerminalAttempt(job: Job, error: unknown): boolean {
    if (error instanceof UnrecoverableError) return true;
    const attempts = Number(job.opts?.attempts ?? 1);
    return Number(job.attemptsMade ?? 0) + 1 >= attempts;
  }

  private async markTargetedScenarioFailed(payload: PreventionBudgetJobPayload): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE prevention_budget_scenarios
         SET failedAt=COALESCE(failedAt,UTC_TIMESTAMP(6))
         WHERE id=? AND organizationId=? AND status='DRAFT' AND failedAt IS NULL`,
        [payload.scenarioId, payload.organizationId],
      );
    } catch (markError) {
      this.logger.warn({
        event: 'PREVENTION_BUDGET_TARGETED_FAILURE_MARK_FAILED',
        errorType: markError instanceof Error ? markError.name : typeof markError,
      });
    }
  }

  private async processGlobalYear(payload: PreventionBudgetJobPayload): Promise<{ id: string; version: number }> {
    if (!payload.runId || payload.year === undefined) throw new UnrecoverableError('Global budget job is missing its checkpoint');
    const [checkpoint]: Array<any> = await this.dataSource.query(
      `SELECT y.*,r.status runStatus,r.scenarioKey runScenarioKey,r.executionMode
       FROM prevention_budget_global_years y JOIN prevention_budget_global_runs r ON r.id=y.runId AND r.organizationId=y.organizationId
       WHERE y.runId=? AND y.organizationId=? AND y.year=? LIMIT 1`,
       [payload.runId, payload.organizationId, payload.year],
    );
    if (!checkpoint) throw new UnrecoverableError('Global budget checkpoint is not tenant-scoped');
    if (checkpoint.runStatus === 'FAILED') throw new UnrecoverableError('Global budget run is failed');
    const [runSource] = await this.dataSource.query(
      'SELECT sourceVersion FROM prevention_budget_global_runs WHERE id=? AND organizationId=? LIMIT 1',
      [payload.runId, payload.organizationId],
    );
    const currentSourceVersion = await loadPreventionBudgetSourceVersion(this.dataSource, payload.organizationId);
    if (!runSource || runSource.sourceVersion !== currentSourceVersion) {
      await this.dataSource.query(
        `UPDATE prevention_budget_global_runs SET status='FAILED',lastError=? WHERE id=? AND organizationId=? AND status<>'PUBLISHED'`,
        ['Les sources prévention ont changé pendant le calcul global; veuillez relancer une prévisualisation.', payload.runId, payload.organizationId],
      );
      await this.dataSource.query(
        `UPDATE prevention_budget_global_years SET status='FAILED',lastError=? WHERE runId=? AND organizationId=? AND status<>'CALCULATED'`,
        ['Source snapshot changed', payload.runId, payload.organizationId],
      );
      throw new UnrecoverableError('Global budget source snapshot changed');
    }
    if (checkpoint.status === 'CALCULATED' && checkpoint.scenarioId) {
      const [scenario] = await this.dataSource.query(
        'SELECT id,version FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1',
        [checkpoint.scenarioId, payload.organizationId],
      );
      if (!scenario) throw new UnrecoverableError('Global budget checkpoint scenario is missing');
      if (!this.bulkAdmission) throw new Error('Prevention bulk admission is unavailable for global budget processing');
      const admission = await this.bulkAdmission.admit({ organizationId: payload.organizationId, runId: payload.runId, workKind: 'BUDGET', executionMode: checkpoint.executionMode === 'IMMEDIATE' ? 'IMMEDIATE' : 'SCHEDULED' });
      if (!admission.admitted || !admission.lease) {
        if (admission.reason === 'OUTSIDE_WINDOW') {
          const availableAt = admission.availableAt ?? nextPreventionBulkWindowStart(new Date(), this.bulkAdmission.settings).toISOString();
          await this.suspendGlobalCheckpoint(payload, availableAt);
          await this.enqueueBudgetContinuation(PREVENTION_BUDGET_GLOBAL_JOB, payload, new Date(availableAt));
          return { id: payload.scenarioId, version: payload.scenarioVersion, suspended: true } as any;
        }
        throw new Error(`Global budget waiting for bulk admission: ${admission.reason}`);
      }
      try {
        return await this.bulkAdmission.withLease(admission.lease, async () => {
          await this.bulkAdmission!.assertLease(admission.lease!);
          const final = await this.finalizeGlobalRun(payload.organizationId, payload.runId!, admission.lease);
          return final ?? { id: scenario.id, version: Number(scenario.version) };
        });
      } finally {
        await this.bulkAdmission.release(admission.lease).catch(() => undefined);
      }
    }
    if (!this.bulkAdmission) throw new Error('Prevention bulk admission is unavailable for global budget processing');
    const admission = await this.bulkAdmission.admit({ organizationId: payload.organizationId, runId: payload.runId, workKind: 'BUDGET', executionMode: checkpoint.executionMode === 'IMMEDIATE' ? 'IMMEDIATE' : 'SCHEDULED' });
    if (!admission.admitted || !admission.lease) {
      if (admission.reason === 'OUTSIDE_WINDOW') {
        const availableAt = admission.availableAt ?? nextPreventionBulkWindowStart(new Date(), this.bulkAdmission.settings).toISOString();
        await this.suspendGlobalCheckpoint(payload, availableAt);
        await this.enqueueBudgetContinuation(PREVENTION_BUDGET_GLOBAL_JOB, payload, new Date(availableAt));
        return { id: payload.scenarioId, version: payload.scenarioVersion, suspended: true } as any;
      }
      throw new Error(`Global budget waiting for bulk admission: ${admission.reason}`);
    }
    try {
      return await this.bulkAdmission.withLease(admission.lease, async () => {
        const workerId = randomUUID();
        const claimed = await this.dataSource.transaction(async (manager) => {
          const [locked] = await manager.query(
            `SELECT * FROM prevention_budget_global_years WHERE id=? AND runId=? AND organizationId=? AND year=? FOR UPDATE`,
            [checkpoint.id, payload.runId, payload.organizationId, payload.year],
          );
          if (!locked || locked.status === 'CALCULATED') return locked;
          await manager.query(
            `UPDATE prevention_budget_global_years SET status='PROCESSING',availableAt=NULL,attempts=attempts+1,lockedAt=UTC_TIMESTAMP(6),lockedBy=?,lastError=NULL
             WHERE id=? AND organizationId=? AND status IN ('PENDING','PROCESSING','SUSPENDED')`,
            [workerId, checkpoint.id, payload.organizationId],
          );
          await manager.query(`UPDATE prevention_budget_global_runs SET status='PROCESSING',currentYear=? WHERE id=? AND organizationId=? AND status<>'PUBLISHED'`, [payload.year, payload.runId, payload.organizationId]);
          return locked;
        });
        if (!claimed) throw new UnrecoverableError('Global budget checkpoint disappeared');
        if (claimed.status === 'CALCULATED') {
          const [scenario] = await this.dataSource.query('SELECT id,version FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1', [claimed?.scenarioId, payload.organizationId]);
          if (!scenario) throw new UnrecoverableError('Global budget checkpoint scenario is missing');
          await this.bulkAdmission!.assertLease(admission.lease);
          const final = await this.finalizeGlobalRun(payload.organizationId, payload.runId, admission.lease);
          return final ?? { id: scenario.id, version: Number(scenario.version) };
        }
        try {
          const assertGlobalSourceStable = async (): Promise<void> => {
            await this.bulkAdmission!.assertLease(admission.lease!);
            const [runVersion] = await this.dataSource.query('SELECT sourceVersion FROM prevention_budget_global_runs WHERE id=? AND organizationId=? LIMIT 1', [payload.runId, payload.organizationId]);
            const currentVersion = await loadPreventionBudgetSourceVersion(this.dataSource, payload.organizationId);
            if (!runVersion || runVersion.sourceVersion !== currentVersion) throw new UnrecoverableError('Global budget source snapshot changed before annual commit');
          };
          const calculated = await this.rebuildScenario(payload, 'BUILD', assertGlobalSourceStable, {
            organizationId: payload.organizationId,
            runId: payload.runId,
            year: Number(payload.year),
            checkpointId: checkpoint.id,
            sourceVersion: String(runSource.sourceVersion),
            assertSourceStable: assertGlobalSourceStable,
            enforceWindow: checkpoint.executionMode !== 'IMMEDIATE',
            storage: 'GLOBAL',
          });
          await this.dataSource.transaction(async (manager) => {
            await manager.query(
              `UPDATE prevention_budget_global_years SET status='CALCULATED',availableAt=NULL,scenarioId=?,completedAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL,lastError=NULL
               WHERE id=? AND runId=? AND organizationId=? AND status='PROCESSING'`,
              [calculated.id, checkpoint.id, payload.runId, payload.organizationId],
            );
          });
          await this.bulkAdmission!.assertLease(admission.lease);
          const final = await this.finalizeGlobalRun(payload.organizationId, payload.runId, admission.lease);
          if (final) return final;
          const [next] = await this.dataSource.query(
            `SELECT y.id,y.year,s.id scenarioId,s.version FROM prevention_budget_global_years y
             JOIN prevention_budget_scenarios s ON s.id=y.scenarioId AND s.organizationId=y.organizationId
             WHERE y.runId=? AND y.organizationId=? AND y.status='PENDING' ORDER BY y.year ASC LIMIT 1`,
            [payload.runId, payload.organizationId],
          );
          if (next) await this.enqueueGlobalYear({ organizationId: payload.organizationId, scenarioId: next.scenarioId, scenarioVersion: Number(next.version), runId: payload.runId, year: Number(next.year) });
          return calculated;
        } catch (error) {
          if (error instanceof PreventionBudgetWindowClosedError) {
            const availableAt = nextPreventionBulkWindowStart(new Date(), this.bulkAdmission!.settings).toISOString();
            await this.dataSource.query(
              `UPDATE prevention_budget_global_years SET status='SUSPENDED',availableAt=?,lockedAt=NULL,lockedBy=NULL,lastError=?
               WHERE id=? AND runId=? AND organizationId=?`,
              [new Date(availableAt), error.message.slice(0, 1000), checkpoint.id, payload.runId, payload.organizationId],
            );
            await this.dataSource.query(
              `UPDATE prevention_budget_global_runs SET status='SUSPENDED',lastError=? WHERE id=? AND organizationId=? AND status<>'PUBLISHED'`,
              [error.message.slice(0, 1000), payload.runId, payload.organizationId],
            );
            await this.enqueueBudgetContinuation(PREVENTION_BUDGET_GLOBAL_JOB, payload, new Date(availableAt));
            return { id: payload.scenarioId, version: payload.scenarioVersion, suspended: true } as any;
          }
          await this.dataSource.query(
            `UPDATE prevention_budget_global_years SET status='PENDING',availableAt=NULL,lockedAt=NULL,lockedBy=NULL,lastError=? WHERE id=? AND runId=? AND organizationId=?`,
            [String(error instanceof Error ? error.message : error).slice(0, 1000), checkpoint.id, payload.runId, payload.organizationId],
          );
          await this.dataSource.query(`UPDATE prevention_budget_global_runs SET status='PENDING',lastError=? WHERE id=? AND organizationId=?`, [String(error instanceof Error ? error.message : error).slice(0, 1000), payload.runId, payload.organizationId]);
          throw error;
        }
      });
    } finally {
      await this.bulkAdmission.release(admission.lease).catch(() => undefined);
    }
  }

  private async finalizeGlobalRun(organizationId: string, runId: string, lease?: PreventionBulkLease): Promise<{ id: string; version: number } | null> {
    return this.dataSource.transaction(async (manager) => {
      const [run] = await manager.query('SELECT * FROM prevention_budget_global_runs WHERE id=? AND organizationId=? FOR UPDATE', [runId, organizationId]);
      if (!run) throw new UnrecoverableError('Global budget run not found');
      if (run.status === 'PUBLISHED' && run.finalScenarioId) {
        const [final] = await manager.query('SELECT id,version FROM prevention_budget_scenarios WHERE id=? AND organizationId=?', [run.finalScenarioId, organizationId]);
        return final ? { id: final.id, version: Number(final.version) } : null;
      }
      const [remaining] = await manager.query(`SELECT id FROM prevention_budget_global_years WHERE runId=? AND organizationId=? AND status<>'CALCULATED' LIMIT 1`, [runId, organizationId]);
      if (remaining) return null;
      const rows: Array<any> = await manager.query(
        `SELECT i.*,y.year FROM prevention_budget_global_years y JOIN prevention_budget_items i ON i.scenarioId=y.scenarioId AND i.organizationId=y.organizationId
         WHERE y.runId=? AND y.organizationId=? AND y.status='CALCULATED'`, [runId, organizationId],
      );
      const sourceRows: Array<any> = rows.length ? await manager.query(
        `SELECT s.*,i.itemKey,y.year FROM prevention_budget_global_years y JOIN prevention_budget_items i ON i.scenarioId=y.scenarioId AND i.organizationId=y.organizationId
         JOIN prevention_budget_item_sources s ON s.itemId=i.id AND s.organizationId=i.organizationId
         WHERE y.runId=? AND y.organizationId=? AND y.status='CALCULATED'`, [runId, organizationId],
      ) : [];
      const [previous] = await manager.query(
        `SELECT * FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? AND periodMode='ALL' AND status<>'DRAFT' ORDER BY version DESC LIMIT 1`, [organizationId, run.scenarioKey],
      );
      const previousItems: Array<any> = previous ? await manager.query('SELECT * FROM prevention_budget_items WHERE organizationId=? AND scenarioId=?', [organizationId, previous.id]) : [];
      const filters = parseGlobalFilters(run.filters);
      // A human may have validated one action from the read-only merged view
      // after the previous global publication. Preserve that decision too.
      const actionLockCandidates: Array<any> = await manager.query(
        `SELECT i.*,s.scenarioKey,s.missionId actionMissionId,s.missionIds actionMissionIds,s.categoryId actionCategoryId,s.categoryIds actionCategoryIds,s.severity actionSeverity,s.severities actionSeverities,s.periodMode actionPeriodMode,s.periodStart actionPeriodStart,s.periodEnd actionPeriodEnd,s.createdAt scenarioCreatedAt FROM prevention_budget_items i
         JOIN prevention_budget_scenarios s ON s.organizationId=i.organizationId AND s.id=i.scenarioId
         WHERE i.organizationId=? AND s.status IN ('CALCULATED','VALIDATED')
           AND (i.lockedManual=1 OR i.status IN ('VALIDE','ENGAGE','REALISE'))
           AND NOT EXISTS (SELECT 1 FROM prevention_budget_scenarios newer
             WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey
               AND newer.version>s.version AND newer.status<>'DRAFT')
         ORDER BY s.createdAt DESC,i.id ASC LIMIT 10001`, [organizationId],
      );
      if (actionLockCandidates.length > 10000) throw new UnrecoverableError('Too many human budget actions to consolidate safely');
      const annualKeys = new Set(rows.map((row) => String(row.itemKey)));
      // A global run has no user-selected dimensions. Keep tenant-scoped human
      // decisions from narrower views, including locked historical actions
      // whose analytical source has since disappeared. Filtered runs only
      // inherit actions whose keys remain in their selected annual rows.
      const unrestrictedGlobal = !filters.clientKeys.length && !filters.categoryIds.length && !filters.categoryId &&
        !filters.severities.length && !filters.severity && !filters.missionIds.length && !filters.missionId;
      const actionLocks = actionLockCandidates.filter((item) => {
        const itemMissionIds = storedStringArray(item.actionMissionIds);
        const itemCategoryIds = storedStringArray(item.actionCategoryIds);
        const itemSeverities = storedStringArray(item.actionSeverities);
        const missionMatch = (!filters.missionIds.length && !filters.missionId) ||
          filters.missionIds.some((missionId) => missionId === String(item.actionMissionId ?? '') || itemMissionIds.includes(missionId)) ||
          (filters.missionId === item.actionMissionId || itemMissionIds.includes(String(filters.missionId ?? '')));
        const actionMissionIds = filters.missionIds.length ? filters.missionIds : (filters.missionId ? [filters.missionId] : []);
        const actionScope = {
          missionIds: actionMissionIds,
          categoryIds: filters.categoryIds.length ? filters.categoryIds : (filters.categoryId ? [filters.categoryId] : []),
          severities: filters.severities.length ? filters.severities : (filters.severity ? [filters.severity] : []),
          periodMode: 'ALL', periodStart: null, periodEnd: null,
        };
        const actionScopeMatch = unrestrictedGlobal ||
          item.scenarioKey === materializedActionScopeKey(organizationId, item.itemKey, null, actionScope) ||
          (!filters.categoryIds.length && !filters.severities.length && !actionMissionIds.length && item.scenarioKey === materializedActionScopeKey(organizationId, item.itemKey, filters.missionId));
        const categoryMatch = (!filters.categoryIds.length && !filters.categoryId) ||
          filters.categoryIds.some((categoryId) => categoryId === String(item.actionCategoryId ?? '') || itemCategoryIds.includes(categoryId)) ||
          (filters.categoryId === item.actionCategoryId || itemCategoryIds.includes(String(filters.categoryId ?? '')));
        const severityMatch = (!filters.severities.length && !filters.severity) ||
          filters.severities.some((severity) => itemSeverities.includes(severity) || severity === item.actionSeverity) ||
          filters.severity === item.actionSeverity;
        const allowHistoricalAction = !filters.categoryIds.length && !filters.categoryId &&
          !filters.severities.length && !filters.severity && !filters.missionIds.length && !filters.missionId;
        return missionMatch && actionScopeMatch && (!filters.clientKeys.length || filters.clientKeys.includes(String(item.clientKey))) &&
          categoryMatch && severityMatch && (allowHistoricalAction || annualKeys.has(String(item.itemKey)));
      });
      const actionLocksByKey = new Map<string, any>();
      for (const item of actionLocks) if (!actionLocksByKey.has(item.itemKey)) actionLocksByKey.set(item.itemKey, item);
      const previousLocked = previousItems.filter((item) => Boolean(item.lockedManual) || LOCKED_STATUSES.includes(item.status));
      const selectedLocks = [...previousLocked, ...actionLocksByKey.values()].sort((a, b) =>
        String(a.scenarioCreatedAt ?? previous?.createdAt ?? '').localeCompare(String(b.scenarioCreatedAt ?? previous?.createdAt ?? '')));
      const items = selectGlobalBudgetRows(rows, selectedLocks);
      const totals = summarizeBudgetRows(items, '0.00');
      const [latest] = await manager.query('SELECT COALESCE(MAX(version),0) version FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? FOR UPDATE', [organizationId, run.scenarioKey]);
      const version = Number(latest?.version ?? 0) + 1;
      const scenarioId = randomUUID();
      const sourceVersion = createHash('sha256').update(`${run.sourceVersion}|FINAL|${version}`).digest('hex');
      if (lease && this.bulkAdmission) await this.bulkAdmission.assertLease(lease);
      const currentSourceVersion = await loadPreventionBudgetSourceVersion(this.dataSource, organizationId);
      if (currentSourceVersion !== run.sourceVersion) throw new UnrecoverableError('Global budget source snapshot changed before publication');
      await manager.query(`INSERT INTO prevention_budget_scenarios
        (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,missionIds,categoryId,categoryIds,severity,severities,clientKeys,adminPrompt,adminPromptActorId,status,contingencyRatePercent,retainedBudgetHt,estimatedBudgetHt,validatedBudgetHt,contingencyAmountHt,totalBudgetHt)
        VALUES (?,?,?,?,?,?,?, 'ALL',?,?,?,?,?,?,?,?,NULL,'CALCULATED',?,?,?,?,?,?)`, [scenarioId, organizationId, run.scenarioKey, version, sourceVersion, null, null,
        filters.missionId, JSON.stringify(filters.missionIds ?? []), filters.categoryId, JSON.stringify(filters.categoryIds ?? []), filters.severity, JSON.stringify(filters.severities ?? []), JSON.stringify(filters.clientKeys ?? []), run.adminPrompt ?? null,
        totals.contingencyRatePercent, totals.retainedBudgetHt, totals.estimatedBudgetHt, totals.validatedBudgetHt, totals.contingencyAmountHt, totals.totalBudgetHt]);
      const previousSourceRows: Array<any> = previous ? await manager.query(`SELECT s.*,i.itemKey FROM prevention_budget_item_sources s JOIN prevention_budget_items i ON i.id=s.itemId AND i.organizationId=s.organizationId WHERE s.organizationId=? AND i.scenarioId=?`, [organizationId, previous.id]) : [];
      const actionSourceRows: Array<any> = actionLocks.length ? await manager.query(
        `SELECT src.*,i.itemKey FROM prevention_budget_item_sources src
         JOIN prevention_budget_items i ON i.organizationId=src.organizationId AND i.id=src.itemId
         WHERE src.organizationId=? AND src.itemId IN (?)`, [organizationId, actionLocks.map((item) => item.id)],
      ) : [];
      const sourceByKey = mergeGlobalBudgetSources(sourceRows, [...previousSourceRows, ...actionSourceRows]);
      const isLocked = (row: any) => Boolean(row.lockedManual) || LOCKED_STATUSES.includes(row.status);
      for (const item of items) {
        const itemId = randomUUID();
        await manager.query(`INSERT INTO prevention_budget_items
          (id,organizationId,scenarioId,itemKey,catalogId,categoryId,categoryKey,clientKey,clientLabel,title,priority,quantity,unit,unitCostHt,totalHt,status,justification,aiEstimateDetails,adminPrompt,adminPromptActorId,priceSource,lockedManual)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [itemId, organizationId, scenarioId, item.itemKey, item.catalogId ?? null, item.categoryId ?? null, item.categoryKey,
          item.clientKey ?? null, item.clientLabel ?? null, item.title, item.priority, item.quantity, item.unit, item.unitCostHt, item.totalHt, item.status, item.justification,
          item.aiEstimateDetails == null ? null : typeof item.aiEstimateDetails === 'string' ? item.aiEstimateDetails : JSON.stringify(item.aiEstimateDetails), item.adminPrompt ?? null, item.adminPromptActorId ?? null, item.priceSource ?? null, isLocked(item) ? 1 : 0]);
        const seen = new Set<string>();
        for (const source of sourceByKey.get(item.itemKey) ?? []) {
          const sourceKey = `${source.sourceKind}|${source.sourceKey}`;
          if (seen.has(sourceKey)) continue;
          seen.add(sourceKey);
          await manager.query('INSERT IGNORE INTO prevention_budget_item_sources (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId) VALUES (?,?,?,?,?,?,?)', [randomUUID(), organizationId, itemId, source.sourceKind, source.sourceKey, source.findingId, source.reportId]);
        }
      }
      await manager.query(`INSERT INTO prevention_budget_audit (id,organizationId,scenarioId,scenarioVersion,action,actorType,actorId,beforeState,afterState) VALUES (?,?,?,?,?,'WORKER',NULL,?,?)`, [randomUUID(), organizationId, scenarioId, version, 'BUILD', previous ? JSON.stringify({ scenarioId: previous.id, version: previous.version }) : null, JSON.stringify({ globalRunId: runId, lineCount: items.length, aggregation: 'MAX_REPORT_ESTIMATE' })]);
      await manager.query(`UPDATE prevention_budget_global_runs SET status='PUBLISHED',finalScenarioId=?,lastError=NULL WHERE id=? AND organizationId=?`, [scenarioId, runId, organizationId]);
      return { id: scenarioId, version };
    });
  }

  async enqueueBuild(payload: PreventionBudgetEnqueueRequest): Promise<PreventionBudgetEnqueuedJob> {
    return this.enqueue(PREVENTION_BUDGET_BUILD_JOB, await this.serverPayload(payload, 'BUILD'), payload.runId ? 'BULK' : 'MAIN', payload.delayMs ?? 0);
  }

  async enqueueRecalculate(payload: PreventionBudgetEnqueueRequest): Promise<PreventionBudgetEnqueuedJob> {
    const request = await this.serverPayload(payload, 'RECALCULATE');
    const estimateRequestOrder = await this.allocateEstimateRequestOrder(request.organizationId);
    return this.enqueue(PREVENTION_BUDGET_RECALCULATE_JOB, { ...request, estimateRequestOrder }, payload.runId ? 'BULK' : 'MAIN', payload.delayMs ?? 0);
  }

  async enqueueRefreshItem(payload: PreventionBudgetEnqueueRequest & { itemId: string }): Promise<PreventionBudgetEnqueuedJob> {
    return this.enqueue(PREVENTION_BUDGET_REFRESH_ITEM_JOB, await this.serverPayload(payload, 'REFRESH_ITEM'));
  }

  async enqueueRecalculateItem(payload: PreventionBudgetEnqueueRequest & { itemId: string }): Promise<PreventionBudgetEnqueuedJob> {
    const request = await this.serverPayload(payload, 'RECALCULATE_ITEM');
    const estimateRequestOrder = await this.allocateEstimateRequestOrder(request.organizationId);
    return this.enqueue(PREVENTION_BUDGET_RECALCULATE_ITEM_JOB, { ...request, estimateRequestOrder });
  }

  private async allocateEstimateRequestOrder(organizationId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const [organization] = await manager.query('SELECT id FROM organizations WHERE id=? FOR UPDATE', [organizationId]);
      if (!organization) throw new UnrecoverableError('Prevention budget organization not found');
      const [current]: Array<{ requestOrder: string }> = await manager.query(
        'SELECT requestOrder FROM prevention_budget_estimate_sequence WHERE organizationId=? FOR UPDATE', [organizationId],
      );
      const next = Number(current?.requestOrder ?? 0) + 1;
      if (!Number.isSafeInteger(next)) throw new Error('Prevention budget estimate sequence exhausted');
      if (current) await manager.query(
        'UPDATE prevention_budget_estimate_sequence SET requestOrder=? WHERE organizationId=?', [next, organizationId],
      );
      else await manager.query(
        'INSERT INTO prevention_budget_estimate_sequence (organizationId,requestOrder) VALUES (?,?)', [organizationId, next],
      );
      return next;
    });
  }

  async enqueueReconcile(payload: PreventionBudgetEnqueueRequest): Promise<PreventionBudgetEnqueuedJob> {
    return this.enqueue(PREVENTION_BUDGET_RECONCILE_JOB, await this.serverPayload(payload, 'RECONCILE'));
  }

  async enqueueGlobalYear(payload: PreventionBudgetEnqueueRequest & { runId: string; year: number }, delayMs = 0): Promise<PreventionBudgetEnqueuedJob> {
    return this.enqueue(PREVENTION_BUDGET_GLOBAL_JOB, await this.serverPayload(payload, 'GLOBAL_YEAR'), 'BULK', delayMs);
  }

  /**
   * Internal tenant-scoped entry point used by Hyper Admin recovery. It
   * deliberately does not accept a User object and therefore cannot be used
   * to impersonate an organisation administrator. The worker still performs
   * the normal source-version and bulk-admission checks.
   */
  async ensureGlobalYearlyRun(organizationId: string, executionMode: 'IMMEDIATE' | 'SCHEDULED' = 'SCHEDULED'):
    Promise<{ runId: string; status: string }> {
    if (!UUID_PATTERN.test(organizationId)) throw new UnrecoverableError('Invalid global budget organization');
    if (this.activation && !(await this.activation.isEnabled(organizationId))) throw new UnrecoverableError('Organization prevention is disabled');
    const [volume] = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(DISTINCT r.id) FROM reports r JOIN visits v ON v.id=r.visitId AND v.organizationId=? WHERE r.organizationId=?) reportCount,
        (SELECT COUNT(*) FROM prevention_findings f WHERE f.organizationId=? AND f.findingType='RECOMMENDATION') recommendationCount,
        (SELECT COUNT(DISTINCT CONCAT(COALESCE(NULLIF(TRIM(m.client),''),'__UNASSIGNED__'),'|',COALESCE(f.actionType,f.normalizedKey,'UNKNOWN'),'|',COALESCE(f.categoryId,'UNCATEGORIZED')))
           FROM prevention_findings f LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
          WHERE f.organizationId=? AND f.findingType='RECOMMENDATION') estimationWorkloadCount`,
      [organizationId, organizationId, organizationId, organizationId],
    );
    const limit = (key: string, fallback: number): number => {
      const value = Number(this.config.get(key, fallback));
      return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    };
    const reportCount = Number(volume?.reportCount ?? 0);
    const recommendationCount = Number(volume?.recommendationCount ?? 0);
    const estimationWorkloadCount = Number(volume?.estimationWorkloadCount ?? 0);
    if (reportCount > limit('PREVENTION_BUDGET_HARD_REPORT_CEILING', 10_000) ||
        recommendationCount > limit('PREVENTION_BUDGET_HARD_RECOMMENDATION_CEILING', 100_000) ||
        estimationWorkloadCount > limit('PREVENTION_BUDGET_HARD_ESTIMATION_CEILING', 10_000)) {
      throw new UnrecoverableError('Global budget volume exceeds hard ceiling');
    }
    if (executionMode === 'IMMEDIATE' && (reportCount > limit('PREVENTION_BUDGET_IMMEDIATE_REPORT_CEILING', 250) ||
        recommendationCount > limit('PREVENTION_BUDGET_IMMEDIATE_RECOMMENDATION_CEILING', 2_500) ||
        estimationWorkloadCount > limit('PREVENTION_BUDGET_IMMEDIATE_ESTIMATION_CEILING', 250))) {
      executionMode = 'SCHEDULED';
    }
    const sourceVersion = await loadPreventionBudgetSourceVersion(this.dataSource, organizationId);
    // Reuse the canonical unfiltered ALL-period scope. This makes the
    // recovery publication visible through the normal Budget API instead of
    // creating a second Hyper Admin-only scenario family.
    const scenarioKey = preventionBudgetScopeKey(organizationId, 'ALL', { start: null, end: null }, null, null, []);
    const stableRunId = deterministicUuid(`prevention-budget-global-run-v1|${organizationId}|${scenarioKey}`);
    const [active] = await this.dataSource.query(
      `SELECT id,status,sourceVersion FROM prevention_budget_global_runs
       WHERE organizationId=? AND scenarioKey=? AND status IN ('PENDING','PROCESSING','SUSPENDED')
       ORDER BY createdAt DESC LIMIT 1`, [organizationId, scenarioKey],
    );
    if (active && active.sourceVersion !== sourceVersion) throw new UnrecoverableError('Global budget source changed during recovery');
    const [stableRun] = active ? [null] : await this.dataSource.query(
      `SELECT id,status,sourceVersion FROM prevention_budget_global_runs WHERE id=? AND organizationId=? LIMIT 1`,
      [stableRunId, organizationId],
    );
    // A published run for the same immutable source is already the canonical
    // answer. If its source changed (or it failed), allocate a new run id so
    // the previous publication is never silently reused.
    if (!active && canReusePublishedGlobalRun(stableRun, sourceVersion)) {
      return { runId: stableRun.id, status: stableRun.status };
    }
    const runId = active?.id ?? (stableRun ? randomUUID() : stableRunId);
    const yearsRows: any[] = await this.dataSource.query(
      `SELECT DISTINCT YEAR(f.businessDate) year FROM prevention_findings f
       WHERE f.organizationId=? AND f.findingType='RECOMMENDATION' AND f.businessDate IS NOT NULL ORDER BY year`, [organizationId]);
    const years: number[] = yearsRows.map((row) => Number(row.year)).filter((year) => Number.isSafeInteger(year) && year >= 1900 && year <= 9999);
    if (!years.length) years.push(Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date())));
    await this.dataSource.transaction(async (manager) => {
      const [existing] = await manager.query('SELECT id,status FROM prevention_budget_global_runs WHERE id=? AND organizationId=? FOR UPDATE', [runId, organizationId]);
      if (!existing) {
        const rate = '0.00';
        await manager.query(`INSERT INTO prevention_budget_global_runs
          (id,organizationId,scenarioKey,sourceVersion,status,mode,executionMode,filters)
          VALUES (?,?,?,?,'PENDING','GLOBAL_YEARLY',?,?)`,
          [runId, organizationId, scenarioKey, sourceVersion, executionMode,
            JSON.stringify({ clientKeys: [], categoryId: null, severity: null, contingencyRatePercent: rate })]);
      }
      for (const year of years) {
        const scenarioId = deterministicUuid(`prevention-budget-global-year-scenario-v1|${runId}|${year}`);
        const yearScenarioKey = preventionBudgetAnnualScenarioKey(runId, scenarioKey, year);
        const yearSource = createHash('sha256').update(`${sourceVersion}|YEAR|${year}`).digest('hex');
        await manager.query(`INSERT IGNORE INTO prevention_budget_scenarios
          (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,categoryId,severity,clientKeys,adminPrompt,adminPromptActorId,status,contingencyRatePercent)
          VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,NULL,NULL,'DRAFT',?)`,
          [scenarioId, organizationId, yearScenarioKey, 1, yearSource, `${year}-01-01`, `${year}-12-31`, 'BOUNDED', JSON.stringify([]), '0.00']);
        await manager.query(`INSERT IGNORE INTO prevention_budget_global_years (id,runId,organizationId,year,status,scenarioId)
          VALUES (?,?,?,?, 'PENDING',?)`, [deterministicUuid(`prevention-budget-global-year-v1|${runId}|${year}`), runId, organizationId, year, scenarioId]);
      }
    });
    const [next] = await this.dataSource.query(
      `SELECT y.year,s.id scenarioId,s.version FROM prevention_budget_global_years y
       JOIN prevention_budget_scenarios s ON s.id=y.scenarioId AND s.organizationId=y.organizationId
       WHERE y.runId=? AND y.organizationId=? AND y.status IN ('PENDING','SUSPENDED') ORDER BY y.year LIMIT 1`, [runId, organizationId]);
    if (next) await this.enqueueGlobalYear({ organizationId, scenarioId: next.scenarioId, scenarioVersion: Number(next.version), runId, year: Number(next.year) });
    return { runId, status: active?.status ?? 'PENDING' };
  }

  async jobStatus(organizationId: string, jobId: string): Promise<Record<string, unknown> | null> {
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return null;
    if ((!this.queue && !this.bulkQueue) || !jobId.startsWith('prevention-budget-')) return null;
    // Global jobs live on the bulk lane. Prefer it when an old main-lane job
    // with the same deterministic id is still retained from a prior deploy.
    const job = (this.bulkQueue ? await this.bulkQueue.getJob(jobId) : null) ?? (this.queue ? await this.queue.getJob(jobId) : null);
    if (!job || job.data?.organizationId !== organizationId) return null;
    const state = await job.getState();
    return {
      id: job.id,
      name: job.name,
      status: state.toUpperCase(),
      scenarioId: job.data.scenarioId,
      scenarioVersion: Number(job.data.scenarioVersion),
      itemId: job.data.itemId ?? null,
      failedReason: state === 'failed' ? job.failedReason ?? null : null,
    };
  }

  async globalRunStatus(organizationId: string, runId: string): Promise<Record<string, unknown> | null> {
    const [run] = await this.dataSource.query(
      'SELECT id,status,scenarioKey,currentYear,finalScenarioId,lastError FROM prevention_budget_global_runs WHERE id=? AND organizationId=? LIMIT 1',
      [runId, organizationId],
    );
    if (!run) return null;
    const rows: Array<{ year: number; status: string; availableAt?: string | Date | null }> = await this.dataSource.query(
      'SELECT year,status,availableAt FROM prevention_budget_global_years WHERE runId=? AND organizationId=? ORDER BY year ASC', [runId, organizationId],
    );
    const completedYears = rows.filter((row) => row.status === 'CALCULATED').length;
    return {
      id: run.id, name: PREVENTION_BUDGET_GLOBAL_JOB,
      // Keep the persisted DB state available while exposing the generic job
      // terminal state expected by the Budget UI/polling contract.
      status: run.status === 'PUBLISHED' ? 'COMPLETED' : run.status,
      runStatus: run.status, scenarioKey: run.scenarioKey, currentYear: run.currentYear ?? null,
      finalScenarioId: run.finalScenarioId ?? null, scenarioId: run.finalScenarioId ?? null,
      lastError: run.lastError ?? null, completedYears, totalYears: rows.length,
      nextResumeAt: rows.find((row) => row.status === 'SUSPENDED')?.availableAt ?? null,
      years: rows.map((row) => ({ year: Number(row.year), status: row.status, availableAt: row.availableAt ?? null })),
    };
  }

  async captureReconcileTargetsForReport(
    organizationId: string,
    reportId: string,
  ): Promise<PreventionBudgetScenarioReference[]> {
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return [];
    const scenarios: Array<{ id: string; version: number; sourceVersion: string }> = await this.dataSource.query(
      `SELECT DISTINCT s.id,s.version,s.sourceVersion
       FROM prevention_budget_scenarios s
       LEFT JOIN prevention_findings f ON f.organizationId=s.organizationId
         AND (s.periodMode='ALL' OR f.businessDate BETWEEN s.periodStart AND s.periodEnd)
         AND f.reportId=? AND f.findingType='RECOMMENDATION'
         AND ((s.missionId IS NULL AND (s.missionIds IS NULL OR JSON_LENGTH(s.missionIds)=0)) OR f.missionId=s.missionId OR JSON_CONTAINS(s.missionIds, JSON_QUOTE(f.missionId)))
         AND ((s.categoryId IS NULL AND (s.categoryIds IS NULL OR JSON_LENGTH(s.categoryIds)=0)) OR f.categoryId=s.categoryId OR JSON_CONTAINS(s.categoryIds, JSON_QUOTE(f.categoryId)))
         AND ((s.severity IS NULL AND (s.severities IS NULL OR JSON_LENGTH(s.severities)=0)) OR s.severity=CASE
           WHEN f.riskLevel='eleve' AND COALESCE((SELECT MAX(ps.score) FROM prevention_priority_scores ps
             WHERE ps.organizationId=f.organizationId AND ps.patternKey=f.patternKey
               AND ps.missionType=f.missionType AND ps.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED')
               AND ps.findingType=f.findingType),0)>=80 THEN 'critique'
           ELSE f.riskLevel END OR JSON_CONTAINS(s.severities, JSON_QUOTE(CASE
             WHEN f.riskLevel='eleve' AND COALESCE((SELECT MAX(ps2.score) FROM prevention_priority_scores ps2
               WHERE ps2.organizationId=f.organizationId AND ps2.patternKey=f.patternKey AND ps2.missionType=f.missionType
                 AND ps2.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED') AND ps2.findingType=f.findingType),0)>=80 THEN 'critique' ELSE f.riskLevel END)))
       LEFT JOIN prevention_budget_items i ON i.organizationId=s.organizationId AND i.scenarioId=s.id
       LEFT JOIN prevention_budget_item_sources src ON src.organizationId=i.organizationId
         AND src.itemId=i.id AND src.reportId=?
       WHERE s.organizationId=? AND (f.id IS NOT NULL OR src.id IS NOT NULL)
         AND s.status<>'ARCHIVED'
         AND NOT EXISTS (SELECT 1 FROM prevention_budget_scenarios newer
           WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey
             AND newer.version>s.version)`, [reportId, reportId, organizationId],
    );
    return scenarios.map((scenario) => ({
      organizationId,
      scenarioId: scenario.id,
      scenarioVersion: Number(scenario.version),
      sourceVersion: scenario.sourceVersion,
    }));
  }

  /** Recover report deletions whose post-commit event was lost. Source links
   * deliberately survive report deletion and identify the affected budgets. */
  async reconcileOrphanedReportSources(organizationId: string, reportId?: string): Promise<number> {
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return 0;
    const rows: Array<{ reportId: string; scenarioId: string; scenarioVersion: number; sourceVersion: string }> = await this.dataSource.query(
      `SELECT DISTINCT src.reportId,s.id AS scenarioId,s.version AS scenarioVersion,s.sourceVersion
       FROM prevention_budget_item_sources src
       JOIN prevention_budget_items item ON item.organizationId=src.organizationId AND item.id=src.itemId
       JOIN prevention_budget_scenarios s ON s.organizationId=item.organizationId AND s.id=item.scenarioId
       LEFT JOIN reports r ON r.organizationId=src.organizationId AND r.id=src.reportId
       WHERE src.organizationId=? AND src.reportId IS NOT NULL AND r.id IS NULL
         AND (? IS NULL OR src.reportId=?) AND s.status<>'ARCHIVED'
         AND NOT EXISTS (SELECT 1 FROM prevention_budget_scenarios newer
           WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey AND newer.version>s.version)
         AND NOT EXISTS (SELECT 1 FROM prevention_budget_reconciliation_intents done
           JOIN prevention_budget_scenarios prior ON prior.organizationId=done.organizationId
             AND prior.id=done.scenarioId
           WHERE done.organizationId=s.organizationId AND done.reportId=src.reportId
             AND prior.scenarioKey=s.scenarioKey AND done.status='PROCESSED')
       ORDER BY src.reportId,s.id LIMIT 100`,
      [organizationId, reportId ?? null, reportId ?? null],
    );
    let reconciled = 0;
    for (const row of rows) {
      const digest = createHash('sha256').update(`${organizationId}|${row.reportId}|${row.scenarioId}`).digest('hex');
      const eventId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const sourceVersion = createHash('sha256').update(`${row.sourceVersion}|orphan-report|${row.reportId}`).digest('hex');
      await this.dataSource.query(
        `INSERT INTO prevention_budget_reconciliation_intents
         (id,eventId,organizationId,reportId,scenarioId,scenarioVersion,sourceVersion,status,attempts,availableAt)
         VALUES (UUID(),?,?,?,?,?,?,'PENDING',0,UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE updatedAt=updatedAt`,
        [eventId, organizationId, row.reportId, row.scenarioId, row.scenarioVersion, sourceVersion],
      );
      reconciled += await this.processDeletionReconciliation(eventId, organizationId, row.reportId);
    }
    return reconciled;
  }

  async processDeletionReconciliation(
    eventId: string,
    organizationId: string,
    reportId: string,
  ): Promise<number> {
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return 0;
    const workerId = randomUUID();
    const intents = await this.dataSource.transaction(async (manager) => {
      const rows: PreventionBudgetReconciliationIntentRow[] = await manager.query(
        `SELECT id,scenarioId,scenarioVersion,sourceVersion
         FROM prevention_budget_reconciliation_intents
         WHERE organizationId=? AND eventId=? AND reportId=?
           AND availableAt<=UTC_TIMESTAMP(6)
           AND status<>'PROCESSED'
         FOR UPDATE`, [organizationId, eventId, reportId],
      );
      if (rows.length === 0) return rows;
      const placeholders = rows.map(() => '?').join(',');
      await manager.query(
        `UPDATE prevention_budget_reconciliation_intents
         SET status='PROCESSING',attempts=attempts+1,lockedAt=UTC_TIMESTAMP(6),lockedBy=?,lastError=NULL
         WHERE organizationId=? AND id IN (${placeholders})`,
        [workerId, organizationId, ...rows.map((row) => row.id)],
      );
      return rows.map((row) => ({
        ...row,
        scenarioVersion: Number(row.scenarioVersion),
      }));
    });
    if (intents.length === 0) return 0;

    try {
      for (const intent of intents) {
        await this.enqueue(PREVENTION_BUDGET_RECONCILE_JOB, {
          organizationId,
          scenarioId: intent.scenarioId,
          scenarioVersion: intent.scenarioVersion,
          // This version was derived and persisted by ReportService before
          // deletion; do not recompute it from client/event input here.
          sourceVersion: intent.sourceVersion,
        });
      }
      const placeholders = intents.map(() => '?').join(',');
      await this.dataSource.query(
        `UPDATE prevention_budget_reconciliation_intents
         SET status='PROCESSED',processedAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL
         WHERE organizationId=? AND lockedBy=? AND id IN (${placeholders})`,
        [organizationId, workerId, ...intents.map((intent) => intent.id)],
      );
      return intents.length;
    } catch (error) {
      const message = String((error as any)?.message ?? error).slice(0, 1000);
      const placeholders = intents.map(() => '?').join(',');
      await this.dataSource.query(
        `UPDATE prevention_budget_reconciliation_intents
         SET status='PENDING',availableAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL,lastError=?
         WHERE organizationId=? AND lockedBy=? AND id IN (${placeholders})`,
        [message, organizationId, workerId, ...intents.map((intent) => intent.id)],
      );
      throw error;
    }
  }

  async enqueueReconcileForCapturedTargets(
    targets: PreventionBudgetScenarioReference[],
    triggerVersion: string,
  ): Promise<number> {
    let enqueued = 0;
    for (const target of targets) {
      if (this.activation && !(await this.activation.isEnabled(target.organizationId))) continue;
      const sourceVersion = createHash('sha256')
        .update(`${target.sourceVersion}|report|${triggerVersion}`)
        .digest('hex');
      await this.enqueue(PREVENTION_BUDGET_RECONCILE_JOB, {
        organizationId: target.organizationId,
        scenarioId: target.scenarioId,
        scenarioVersion: target.scenarioVersion,
        sourceVersion,
      });
      enqueued += 1;
    }
    return enqueued;
  }

  async enqueueReconcileForReport(
    organizationId: string,
    reportId: string,
    triggerVersion: string,
  ): Promise<number> {
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return 0;
    const targets = await this.captureReconcileTargetsForReport(organizationId, reportId);
    return this.enqueueReconcileForCapturedTargets(targets, triggerVersion);
  }

  private async propagateReportPrices(organizationId: string, scenarioId: string, triggerVersion: string): Promise<void> {
    const reports: Array<{ reportId: string }> = await this.dataSource.query(
      `SELECT DISTINCT src.reportId FROM prevention_budget_item_sources src
       JOIN prevention_budget_items item ON item.id=src.itemId AND item.organizationId=src.organizationId
       WHERE src.organizationId=? AND item.scenarioId=? AND src.reportId IS NOT NULL
         AND item.aiEstimateDetails IS NOT NULL AND item.lockedManual=0
       ORDER BY src.reportId`, [organizationId, scenarioId],
    );
    const targets = new Map<string, { reference: PreventionBudgetScenarioReference; reports: string[] }>();
    for (const { reportId } of reports) {
      for (const reference of await this.captureReconcileTargetsForReport(organizationId, reportId)) {
        if (reference.scenarioId === scenarioId) continue;
        const entry = targets.get(reference.scenarioId) ?? { reference, reports: [] };
        entry.reports.push(reportId);
        targets.set(reference.scenarioId, entry);
      }
    }
    for (const { reference, reports: affectedReports } of targets.values()) {
      const sourceVersion = createHash('sha256')
        .update(`${reference.sourceVersion}|estimate|${triggerVersion}|${affectedReports.sort().join(',')}`)
        .digest('hex');
      await this.enqueue(PREVENTION_BUDGET_RECONCILE_JOB, { ...reference, sourceVersion });
    }
  }

  private async serverPayload(
    request: PreventionBudgetEnqueueRequest,
    purpose: string,
  ): Promise<PreventionBudgetJobPayload> {
    if (this.activation) await this.activation.assertEnabled(request.organizationId);
    const [scenario]: Array<{ id: string; version: number; sourceVersion: string }> = await this.dataSource.query(
      `SELECT id,version,sourceVersion FROM prevention_budget_scenarios
       WHERE id=? AND organizationId=? LIMIT 1`, [request.scenarioId, request.organizationId],
    );
    if (!scenario) throw new UnrecoverableError('Prevention budget scenario is not tenant-scoped');
    if (request.itemId) {
      const [item]: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM prevention_budget_items WHERE id=? AND organizationId=? AND scenarioId=? LIMIT 1`,
        [request.itemId, request.organizationId, request.scenarioId],
      );
      if (!item) throw new UnrecoverableError('Prevention budget item is not tenant-scoped');
    }
    const sourceVersion = createHash('sha256')
      .update(`${scenario.sourceVersion}|${purpose}|${scenario.id}|${scenario.version}|${BUDGET_CALCULATION_VERSION}`)
      .digest('hex');
    return {
      organizationId: request.organizationId,
      scenarioId: scenario.id,
      scenarioVersion: Number(scenario.version),
      sourceVersion,
      ...(request.itemId ? { itemId: request.itemId } : {}),
      ...(request.runId ? { runId: request.runId } : {}),
      ...(request.year === undefined ? {} : { year: request.year }),
      ...(request.executionMode ? { executionMode: request.executionMode } : {}),
    };
  }

  async enqueueRefreshForCatalog(organizationId: string, catalogId: string): Promise<number> {
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return 0;
    const items: Array<{ scenarioId: string; scenarioVersion: number; sourceVersion: string; itemId: string; catalogVersion: number }> = await this.dataSource.query(
      `SELECT i.id itemId,i.scenarioId,s.version scenarioVersion,s.sourceVersion,changed.version catalogVersion
       FROM prevention_budget_items i JOIN prevention_budget_scenarios s
         ON s.organizationId=i.organizationId AND s.id=i.scenarioId
       JOIN prevention_cost_catalog changed ON changed.organizationId=i.organizationId AND changed.id=?
       JOIN prevention_cost_catalog c ON c.organizationId=i.organizationId AND c.id=i.catalogId
         AND ((c.matchingKey=changed.matchingKey) OR (c.matchingKey IS NULL AND changed.matchingKey IS NULL))
       WHERE i.organizationId=? AND s.status<>'ARCHIVED'
         AND NOT EXISTS (SELECT 1 FROM prevention_budget_scenarios newer
           WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey
             AND newer.version>s.version)`, [catalogId, organizationId],
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

  private async enqueue(name: PreventionBudgetJobName, payload: PreventionBudgetJobPayload, lane: 'MAIN' | 'BULK' = 'MAIN', delayMs = 0): Promise<PreventionBudgetEnqueuedJob> {
    const queue = lane === 'BULK' ? this.bulkQueue : this.queue;
    if (!queue) throw new Error('Prevention budget queue is unavailable');
    const jobId = preventionBudgetJobId(name, payload);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
      else return { id: jobId, status: 'DEDUPLICATED', name, scenarioId: payload.scenarioId, scenarioVersion: payload.scenarioVersion };
    }
    await queue.add(name, payload, {
      jobId, attempts: lane === 'BULK' ? 20 : 4, backoff: { type: 'exponential', delay: 60_000 },
      ...(delayMs > 0 ? { delay: delayMs } : {}),
      removeOnComplete: 1000, removeOnFail: 1000,
    });
    return { id: jobId, status: 'QUEUED', name, scenarioId: payload.scenarioId, scenarioVersion: payload.scenarioVersion };
  }

  private async recalculateScenarioItem(payload: PreventionBudgetJobPayload, requestEpochMs = Date.now()): Promise<{ id: string; version: number }> {
    if (!payload.itemId) throw new UnrecoverableError('Prevention budget item recalculation requires an item');
    const [base]: Array<any> = await this.dataSource.query('SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1', [payload.scenarioId, payload.organizationId]);
    if (!base) throw new UnrecoverableError('Prevention budget scenario not found in organization');
    assertPreventionBudgetScenarioVersion(Number(base.version), payload.scenarioVersion);
    const [already]: Array<any> = await this.dataSource.query(
      `SELECT id,version FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? AND sourceVersion=? AND status<>'DRAFT' LIMIT 1`,
      [payload.organizationId, base.scenarioKey, payload.sourceVersion],
    );
    if (already) return already;
    const [target]: Array<any> = await this.dataSource.query(
      'SELECT * FROM prevention_budget_items WHERE id=? AND organizationId=? AND scenarioId=? LIMIT 1',
      [payload.itemId, payload.organizationId, base.id],
    );
    if (!target) throw new UnrecoverableError('Prevention budget item does not belong to organization/scenario');
    if (Boolean(target.lockedManual) || LOCKED_STATUSES.includes(target.status)) throw new UnrecoverableError('Locked prevention budget item cannot be recalculated');
    const targetSources: Array<any> = await this.dataSource.query(
      `SELECT findingId,reportId FROM prevention_budget_item_sources
       WHERE organizationId=? AND itemId=? AND sourceKind='RECOMMENDATION'`, [payload.organizationId, target.id],
    );
    const linkedFindings: Array<any> = await this.dataSource.query(
      `SELECT f.id,f.reportId,f.sourceGroupId,f.normalizedKey,f.patternKey,f.content,f.categoryId,f.actionType,f.actionMetric,f.riskLevel,
              m.client,COALESCE(c.code,'UNCATEGORIZED') categoryKey
       FROM prevention_budget_item_sources src
       JOIN prevention_findings f ON f.organizationId=src.organizationId AND f.id=src.findingId AND f.findingType='RECOMMENDATION'
       LEFT JOIN prevention_categories c ON c.id=f.categoryId AND c.organizationId=f.organizationId
       LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
       WHERE src.organizationId=? AND src.itemId=? AND src.sourceKind='RECOMMENDATION'
         ${budgetPeriodPredicate(base.periodMode, base.periodStart, base.periodEnd).sql}`,
      [payload.organizationId, target.id, ...budgetPeriodPredicate(base.periodMode, base.periodStart, base.periodEnd).args],
    );
    if (targetSources.length && linkedFindings.length !== targetSources.filter((source) => source.findingId).length) {
      throw new UnrecoverableError('Prevention budget recommendation sources changed before item recalculation');
    }
    if (!targetSources.length && target.status === 'ESTIME') {
      throw new UnrecoverableError('Prevention budget estimated item has no recommendation source');
    }
    // A prior bounded scenario may not yet contain every report for this
    // client/action. Resolve the current source set before costing the line;
    // report occurrences are never summed into a fabricated quantity.
    let findings = linkedFindings;
    if (linkedFindings.length && isPriceableActionGroup(linkedFindings)) {
      const actionTypes = [...new Set(linkedFindings.map((finding) => finding.actionType))];
      if (actionTypes.length !== 1) throw new UnrecoverableError('Mixed budget action types cannot be recalculated as one item');
      const period = budgetPeriodPredicate(base.periodMode, base.periodStart, base.periodEnd);
      const missionIds = storedStringArray(base.missionIds); if (!missionIds.length && base.missionId) missionIds.push(String(base.missionId));
      const categoryIds = storedStringArray(base.categoryIds); if (!categoryIds.length && base.categoryId) categoryIds.push(String(base.categoryId));
      const severities = storedStringArray(base.severities); if (!severities.length && base.severity) severities.push(String(base.severity));
      const severity = budgetSeverityFilter(severities);
      const candidates: Array<any> = await this.dataSource.query(
        `SELECT f.id,f.reportId,f.sourceGroupId,f.normalizedKey,f.patternKey,f.content,f.categoryId,f.actionType,f.actionMetric,f.riskLevel,
                m.client,COALESCE(c.code,'UNCATEGORIZED') categoryKey
         FROM prevention_findings f
         LEFT JOIN prevention_categories c ON c.id=f.categoryId AND c.organizationId=f.organizationId
         LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
         WHERE f.organizationId=? AND f.findingType='RECOMMENDATION' AND f.actionType=?
           ${period.sql}
           ${missionIds.length ? 'AND f.missionId IN (?)' : ''}
           ${categoryIds.length ? 'AND f.categoryId IN (?)' : ''}
           ${severity.sql}
         ORDER BY f.id LIMIT 5001`,
        [payload.organizationId, actionTypes[0], ...period.args,
          ...(missionIds.length ? [missionIds] : []), ...(categoryIds.length ? [categoryIds] : []), ...severity.args],
      );
      if (candidates.length > 5000) throw new UnrecoverableError('Too many recommendations for a targeted budget recalculation');
      findings = candidates.filter((finding) => budgetClientActionKey(
        budgetClientIdentity(finding.client).key, budgetActionGroup(finding).itemKey,
      ) === target.itemKey);
      if (!findings.length || linkedFindings.some((linked) => !findings.some((current) => current.id === linked.id))) {
        throw new UnrecoverableError('Prevention budget action sources changed before item recalculation');
      }
    }
    const grouped = new Map<string, any[]>();
    for (const finding of findings) grouped.set(String(finding.reportId), [...(grouped.get(String(finding.reportId)) ?? []), finding]);
    let estimate: any = null;
    let preparedReportEstimates: PreparedReportEstimate[] = [];
    if (findings.length && isPriceableActionGroup(findings)) {
      if (!this.estimateAi) throw new Error('Prevention budget estimation AI service is unavailable');
      const reportInputs: PreventionBudgetEstimateInput[] = [...grouped.entries()].map(([reportId, rows]) => ({
        itemKey: createHash('sha256').update(`budget-report-action-v1|${target.itemKey}|${reportId}`).digest('hex'),
        pricingCohortKey: target.itemKey, reportId, clientLabel: target.clientLabel ?? undefined,
        adminPrompt: typeof target.adminPrompt === 'string' ? target.adminPrompt : null,
        title: target.title, categoryKey: target.categoryKey,
        priority: rows.some((row) => row.riskLevel === 'eleve') ? 'HIGH'
          : rows.some((row) => row.riskLevel === 'moyen') ? 'MEDIUM' : 'LOW',
        occurrenceCount: rows.length, reportCount: 1, actionType: budgetActionGroup(rows[0]).familyId ?? undefined,
        recommendations: rows.map((row) => String(row.content)),
        metricEvidence: rows.flatMap((row) => parseMetricEvidence(row.actionMetric)), catalogReference: null,
      }));
      const resolved = await this.prepareReportEstimates(payload.organizationId, reportInputs, true);
      preparedReportEstimates = resolved.prepared;
      const estimates = resolved.estimates;
      const rows = reportInputs.map((input) => {
        const found = estimates.get(input.itemKey);
        if (!found) throw new Error('Prevention budget estimation AI omitted a report action');
        return { reportId: input.reportId!, estimate: found };
      });
      estimate = maximumReportBudgetEstimate(rows);
    }
    const input: PreventionBudgetLineInput = {
      itemKey: target.itemKey, title: target.title, categoryId: target.categoryId ?? null, categoryKey: target.categoryKey,
      clientKey: target.clientKey ?? null, clientLabel: target.clientLabel ?? null, priority: target.priority,
      quantity: String(target.quantity), unit: target.unit, catalogMatch: null,
      ...(estimate ? { aiEstimate: { quantity: estimate.quantity, unit: estimate.unit, unitCostHt: estimate.unitCostHt, totalHt: estimate.totalHt, details: estimate.details } } : {}),
    };
    const calculation = calculatePreventionBudget([input], String(base.contingencyRatePercent));
    const nextLine = calculation.lines[0];
    return this.dataSource.transaction(async (manager) => {
      const [lockedBase]: Array<any> = await manager.query('SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? FOR UPDATE', [payload.scenarioId, payload.organizationId]);
      if (!lockedBase) throw new UnrecoverableError('Prevention budget scenario not found in organization');
      assertPreventionBudgetScenarioVersion(Number(lockedBase.version), payload.scenarioVersion);
      const [latest]: Array<any> = await manager.query('SELECT * FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? ORDER BY version DESC LIMIT 1 FOR UPDATE', [payload.organizationId, lockedBase.scenarioKey]);
      if (latest?.id !== lockedBase.id) throw new UnrecoverableError('Prevention budget changed while AI estimate was being prepared');
      const [transactionAlready]: Array<any> = await manager.query('SELECT id,version FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? AND sourceVersion=? AND status<>\'DRAFT\' LIMIT 1', [payload.organizationId, lockedBase.scenarioKey, payload.sourceVersion]);
      if (transactionAlready) return transactionAlready;
      await this.publishReportEstimates(manager, payload.organizationId, preparedReportEstimates, true, requestEpochMs, payload.estimateRequestOrder ?? 0);
      const previousItems: Array<any> = await manager.query('SELECT * FROM prevention_budget_items WHERE organizationId=? AND scenarioId=? ORDER BY id ASC', [payload.organizationId, lockedBase.id]);
      const previousSources: Array<any> = await manager.query('SELECT * FROM prevention_budget_item_sources WHERE organizationId=? AND itemId IN (?)', [payload.organizationId, previousItems.map((item) => item.id)]);
      const nextItems = previousItems.map((item) => item.id === target.id ? { ...item, ...nextLine, adminPrompt: target.adminPrompt, adminPromptActorId: target.adminPromptActorId } : item);
      const totals = summarizeBudgetRows(nextItems, String(lockedBase.contingencyRatePercent));
      const version = Number(lockedBase.version) + 1; const scenarioId = randomUUID();
      await manager.query(`INSERT INTO prevention_budget_scenarios
        (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,missionIds,categoryId,categoryIds,severity,severities,clientKeys,adminPrompt,adminPromptActorId,status,contingencyRatePercent,retainedBudgetHt,estimatedBudgetHt,validatedBudgetHt,contingencyAmountHt,totalBudgetHt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'CALCULATED',?,?,?,?,?,?)`, [scenarioId, payload.organizationId, lockedBase.scenarioKey, version, payload.sourceVersion,
        lockedBase.periodStart ?? null, lockedBase.periodEnd ?? null, lockedBase.periodMode ?? 'BOUNDED', lockedBase.missionId ?? null, JSON.stringify(storedStringArray(lockedBase.missionIds)), lockedBase.categoryId ?? null, JSON.stringify(storedStringArray(lockedBase.categoryIds)), lockedBase.severity ?? null, JSON.stringify(storedStringArray(lockedBase.severities)),
        JSON.stringify(storedBudgetClientKeys(lockedBase.clientKeys)), lockedBase.adminPrompt ?? null, lockedBase.adminPromptActorId ?? null,
        totals.contingencyRatePercent, totals.retainedBudgetHt, totals.estimatedBudgetHt, totals.validatedBudgetHt, totals.contingencyAmountHt, totals.totalBudgetHt]);
      const itemMap = new Map<string, string>();
      for (const item of nextItems) {
        const copyId = randomUUID(); itemMap.set(item.id, copyId);
        await manager.query(`INSERT INTO prevention_budget_items
          (id,organizationId,scenarioId,itemKey,catalogId,categoryId,categoryKey,clientKey,clientLabel,title,priority,quantity,unit,unitCostHt,totalHt,status,justification,aiEstimateDetails,adminPrompt,adminPromptActorId,priceSource,lockedManual)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [copyId, payload.organizationId, scenarioId, item.itemKey, item.catalogId ?? null, item.categoryId ?? null, item.categoryKey,
          item.clientKey ?? null, item.clientLabel ?? null, item.title, item.priority, item.quantity, item.unit, item.unitCostHt, item.totalHt, item.status, item.justification,
          item.aiEstimateDetails == null ? null : typeof item.aiEstimateDetails === 'string' ? item.aiEstimateDetails : JSON.stringify(item.aiEstimateDetails), item.adminPrompt ?? null, item.adminPromptActorId ?? null, item.priceSource ?? null, Boolean(item.lockedManual) ? 1 : 0]);
      }
      for (const source of previousSources) {
        if (source.itemId === target.id && source.sourceKind === 'RECOMMENDATION') continue;
        await manager.query('INSERT INTO prevention_budget_item_sources (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId) VALUES (?,?,?,?,?,?,?)', [randomUUID(), payload.organizationId, itemMap.get(source.itemId), source.sourceKind, source.sourceKey, source.findingId, source.reportId]);
      }
      for (const finding of findings) await manager.query(
        `INSERT IGNORE INTO prevention_budget_item_sources (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId)
         VALUES (?,?,?,'RECOMMENDATION',?,?,?)`,
        [randomUUID(), payload.organizationId, itemMap.get(target.id), preventionBudgetStableRecommendationKey(finding), finding.id, finding.reportId],
      );
      await manager.query(`INSERT INTO prevention_budget_audit (id,organizationId,scenarioId,scenarioVersion,action,actorType,actorId,beforeState,afterState)
        VALUES (?,?,?,?,?,'WORKER',NULL,?,?)`, [randomUUID(), payload.organizationId, scenarioId, version, 'RECALCULATE_ITEM', JSON.stringify({ scenarioId: lockedBase.id, version: lockedBase.version, itemId: target.id }), JSON.stringify({ itemKey: target.itemKey, totalHt: nextLine.totalHt, aiEstimated: Boolean(nextLine.aiEstimateDetails), promptHash: target.adminPrompt ? createHash('sha256').update(target.adminPrompt).digest('hex') : null })]);
      return { id: scenarioId, version };
    });
  }

  private async prepareReportEstimates(
    organizationId: string,
    reportInputs: PreventionBudgetEstimateInput[],
    forceFresh: boolean,
    globalEstimateCheckpoint?: PreventionBudgetGlobalEstimateCheckpoint,
    legacyEstimates = new Map<string, PreventionBudgetAiEstimate>(),
  ): Promise<{ estimates: Map<string, PreventionBudgetAiEstimate>; prepared: PreparedReportEstimate[] }> {
    if (!this.estimateAi) throw new Error('Prevention budget estimation AI service is unavailable');
    const prepared: PreparedReportEstimate[] = [];
    const missing: PreventionBudgetEstimateInput[] = [];
    for (const input of reportInputs) {
      if (!input.reportId || !input.pricingCohortKey) throw new Error('Budget report estimate requires report and action keys');
      const inputHash = budgetReportEstimateInputHash(input);
      const [latest]: Array<{ id: string; estimate: unknown }> = await this.dataSource.query(
        `SELECT id,estimate FROM prevention_budget_report_estimates
         WHERE organizationId=? AND itemKey=? AND reportId=? AND inputHash=?
         ORDER BY requestOrder DESC,createdAt DESC,id DESC LIMIT 1`,
        [organizationId, input.pricingCohortKey, input.reportId, inputHash],
      );
      const cached = latest ? parseBudgetReportEstimate(latest.estimate) : null;
      if (!forceFresh && cached) {
        prepared.push({ input, inputHash, previousId: latest.id, estimate: cached, fresh: false });
      } else if (!forceFresh && legacyEstimates.has(input.itemKey)) {
        prepared.push({ input, inputHash, previousId: latest?.id ?? null,
          estimate: legacyEstimates.get(input.itemKey)!, fresh: true });
      } else {
        missing.push(input);
        prepared.push({ input, inputHash, previousId: latest?.id ?? null, estimate: null as any, fresh: true });
      }
    }
    if (missing.length) {
      const generated = globalEstimateCheckpoint
        ? await this.estimateGlobalReportInputs(missing, globalEstimateCheckpoint)
        : await this.estimateAi.estimate(missing);
      for (const row of prepared.filter((candidate) => candidate.fresh && !candidate.estimate)) {
        const estimate = generated.get(row.input.itemKey);
        if (!estimate) throw new Error('Prevention budget estimation AI omitted a report action');
        row.estimate = estimate;
      }
    }
    return { prepared, estimates: new Map(prepared.map((row) => [row.input.itemKey, row.estimate])) };
  }

  private async publishReportEstimates(
    manager: { query: (sql: string, args?: unknown[]) => Promise<any[]> },
    organizationId: string,
    prepared: PreparedReportEstimate[],
    forceFresh: boolean,
    requestEpochMs: number,
    requestOrder: number,
  ): Promise<void> {
    if (!prepared.length) return;
    // Serialize price publication for this tenant. An automatic job that read
    // an older reference must retry instead of publishing a divergent total.
    await manager.query('SELECT id FROM organizations WHERE id=? FOR UPDATE', [organizationId]);
    for (const row of prepared) {
      const [latest]: Array<{ id: string; requestOrder: string }> = await manager.query(
        `SELECT id,requestOrder FROM prevention_budget_report_estimates
         WHERE organizationId=? AND itemKey=? AND reportId=? AND inputHash=?
         ORDER BY requestOrder DESC,createdAt DESC,id DESC LIMIT 1`,
        [organizationId, row.input.pricingCohortKey, row.input.reportId, row.inputHash],
      );
      if (forceFresh && latest && Number(latest.requestOrder) >= requestOrder) {
        throw new UnrecoverableError('A newer budget estimate superseded this recalculation');
      }
      if (!forceFresh && (latest?.id ?? null) !== row.previousId) {
        throw new Error('Budget report estimate changed while the scenario was being calculated');
      }
      if (!row.fresh) continue;
      const estimateId = randomUUID();
      await manager.query(
        `INSERT INTO prevention_budget_report_estimates
         (id,organizationId,itemKey,reportId,inputHash,requestEpochMs,requestOrder,estimate)
         VALUES (?,?,?,?,?,?,?,?)`,
        [estimateId, organizationId, row.input.pricingCohortKey, row.input.reportId,
          row.inputHash, requestEpochMs, requestOrder, JSON.stringify(row.estimate)],
      );
      // Scenario versions retain their own immutable explanations. Only the
      // current reusable reference is needed in this cache.
      await manager.query(
        `DELETE FROM prevention_budget_report_estimates
         WHERE organizationId=? AND itemKey=? AND reportId=? AND inputHash=? AND id<>?`,
        [organizationId, row.input.pricingCohortKey, row.input.reportId, row.inputHash, estimateId],
      );
    }
  }

  private async rebuildScenario(
    payload: PreventionBudgetJobPayload,
    action: 'BUILD' | 'RECALCULATE' | 'REFRESH_ITEM' | 'RECONCILE',
    beforeCommit?: () => Promise<void>,
    globalEstimateCheckpoint?: PreventionBudgetGlobalEstimateCheckpoint,
    requestEpochMs = Date.now(),
  ): Promise<{ id: string; version: number }> {
    const defaultRate = loadPreventionBudgetContingencyRate(this.config);
    const [base]: Array<any> = await this.dataSource.query(
      `SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1`,
      [payload.scenarioId, payload.organizationId],
    );
    if (!base) throw new UnrecoverableError('Prevention budget scenario not found in organization');
    assertPreventionBudgetScenarioVersion(Number(base.version), payload.scenarioVersion);
    const [already]: Array<any> = await this.dataSource.query(
      `SELECT id,version FROM prevention_budget_scenarios
       WHERE organizationId=? AND scenarioKey=? AND sourceVersion=? AND status<>'DRAFT' LIMIT 1`,
      [payload.organizationId, base.scenarioKey, payload.sourceVersion],
    );
    if (already) return already;
    const missionIds = storedStringArray(base.missionIds); if (!missionIds.length && base.missionId) missionIds.push(String(base.missionId));
    const categoryIds = storedStringArray(base.categoryIds); if (!categoryIds.length && base.categoryId) categoryIds.push(String(base.categoryId));
    const severities = storedStringArray(base.severities); if (!severities.length && base.severity) severities.push(String(base.severity));
    const severity = budgetSeverityFilter(severities);
    const periodPredicate = budgetPeriodPredicate(base.periodMode, base.periodStart, base.periodEnd);
    const [latestSnapshot]: Array<any> = await this.dataSource.query(
      `SELECT * FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? ORDER BY version DESC LIMIT 1`,
      [payload.organizationId, base.scenarioKey],
    );
    const findings: Array<any> = await this.dataSource.query(
      `SELECT f.id,f.reportId,f.sourceGroupId,f.patternKey,f.normalizedKey,f.content,f.categoryId,f.actionType,f.actionMetric,
              f.riskLevel,f.businessDate,m.client,COALESCE(c.code,'UNCATEGORIZED') categoryKey
       FROM prevention_findings f LEFT JOIN prevention_categories c ON c.id=f.categoryId
         AND c.organizationId=f.organizationId
       LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
       WHERE f.organizationId=? AND f.findingType='RECOMMENDATION'
         ${periodPredicate.sql}
         ${missionIds.length ? 'AND f.missionId IN (?)' : ''}
         ${categoryIds.length ? 'AND f.categoryId IN (?)' : ''}
         ${severity.sql}
       ORDER BY f.patternKey,f.id`,
      [payload.organizationId, ...periodPredicate.args, ...(missionIds.length ? [missionIds] : []), ...(categoryIds.length ? [categoryIds] : []), ...severity.args],
    );
    const selectedClientKeys = new Set(storedBudgetClientKeys(base.clientKeys));
    const previous: Array<any> = latestSnapshot ? await this.dataSource.query(
      `SELECT * FROM prevention_budget_items WHERE organizationId=? AND scenarioId=?`,
      [payload.organizationId, latestSnapshot.id],
    ) : [];
    const previousSources: Array<any> = latestSnapshot ? await this.dataSource.query(
      `SELECT s.*,i.itemKey FROM prevention_budget_item_sources s
       INNER JOIN prevention_budget_items i ON i.id=s.itemId AND i.organizationId=s.organizationId
       WHERE s.organizationId=? AND i.scenarioId=?`,
      [payload.organizationId, latestSnapshot.id],
    ) : [];
    const previousByKey = new Map(previous.map((row) => [row.itemKey, row]));
    const currentFindingById = new Map(findings.map((finding) => [String(finding.id), finding]));
    const currentFindingByStableKey = new Map(findings.map((finding) => [preventionBudgetStableRecommendationKey(finding), finding]));
    const groups = new Map<string, any[]>();
    const groupTitles = new Map<string, string>();
    const groupCategories = new Map<string, string>();
    const groupClients = new Map<string, { key: string; label: string }>();
    for (const finding of findings) {
      const client = budgetClientIdentity(finding.client);
      if (selectedClientKeys.size && !selectedClientKeys.has(client.key)) continue;
      const action = budgetActionGroup(finding);
      const key = budgetClientActionKey(client.key, action.itemKey);
      const group = groups.get(key) ?? [];
      group.push(finding);
      groups.set(key, group);
      if (!groupTitles.has(key)) groupTitles.set(key, action.title);
      if (!groupCategories.has(key)) groupCategories.set(key, action.categoryKey);
      if (!groupClients.has(key)) groupClients.set(key, client);
    }
    const inputs: PreventionBudgetLineInput[] = [...groups.entries()].map(([itemKey, group]) => {
      const first = group[0];
      const categoryKey = groupCategories.get(itemKey) ?? first.categoryKey;
      const old = previousByKey.get(itemKey);
      return {
        itemKey,
        title: groupTitles.get(itemKey) ?? String(first.content).slice(0, 500),
        clientKey: groupClients.get(itemKey)?.key ?? null,
        clientLabel: groupClients.get(itemKey)?.label ?? null,
        categoryId: first.categoryKey === categoryKey ? first.categoryId ?? null : null,
        categoryKey,
        priority: group.some((finding) => finding.riskLevel === 'eleve') ? 'HIGH'
          : group.some((finding) => finding.riskLevel === 'moyen') ? 'MEDIUM' : 'LOW',
        quantity: String(group.length),
        unit: 'ACTION',
        catalogMatch: null,
        manual: old && (Boolean(old.lockedManual) || LOCKED_STATUSES.includes(old.status)) ? {
          quantity: String(old.quantity), unit: old.unit, unitCostHt: old.unitCostHt === null ? null : String(old.unitCostHt),
          priceSource: old.priceSource === null ? null : String(old.priceSource), status: old.status, priority: old.priority,
          lockedManual: true, aiEstimateDetails: parseAiEstimateDetails(old.aiEstimateDetails),
        } : undefined,
      };
    });
    appendMissingLockedBudgetLines(inputs, previous);
    const needsEstimate = inputs.filter((input) => !input.manual && isPriceableActionGroup(groups.get(input.itemKey) ?? []));
    let preparedReportEstimates: PreparedReportEstimate[] = [];
    const forceFresh = action === 'RECALCULATE';
    if (needsEstimate.length) {
      if (!this.estimateAi) throw new Error('Prevention budget estimation AI service is unavailable');
      const reportInputs: PreventionBudgetEstimateInput[] = needsEstimate.flatMap((input) => {
        const group = groups.get(input.itemKey) ?? [];
        const byReport = new Map<string, any[]>();
        for (const finding of group) {
          const reportId = String(finding.reportId);
          byReport.set(reportId, [...(byReport.get(reportId) ?? []), finding]);
        }
        return [...byReport.entries()].map(([reportId, reportFindings]) => ({
          itemKey: createHash('sha256').update(`budget-report-action-v1|${input.itemKey}|${reportId}`).digest('hex'),
          pricingCohortKey: input.itemKey,
          reportId, clientLabel: input.clientLabel ?? undefined, adminPrompt: typeof base.adminPrompt === 'string' ? base.adminPrompt : null,
          title: input.title, categoryKey: input.categoryKey,
          priority: reportFindings.some((finding) => finding.riskLevel === 'eleve') ? 'HIGH'
            : reportFindings.some((finding) => finding.riskLevel === 'moyen') ? 'MEDIUM' : 'LOW',
          occurrenceCount: reportFindings.length, reportCount: 1,
          actionType: budgetActionGroup(reportFindings[0]).familyId ?? undefined,
          recommendations: reportFindings.map((finding) => String(finding.content)),
          metricEvidence: reportFindings.flatMap((finding) => {
            const value = typeof finding.actionMetric === 'string'
              ? (() => { try { return JSON.parse(finding.actionMetric); } catch { return null; } })()
              : finding.actionMetric;
            return value && typeof value === 'object' && typeof value.quantity === 'string' &&
              typeof value.unit === 'string' && typeof value.basis === 'string' &&
              typeof value.confidence === 'number' ? [value] : [];
          }),
          catalogReference: null,
        }));
      });
      const legacyEstimates = new Map<string, PreventionBudgetAiEstimate>();
      if (!forceFresh) for (const reportInput of reportInputs) {
        const old = previousByKey.get(reportInput.pricingCohortKey!);
        const details = parseAiEstimateDetails(old?.aiEstimateDetails) as PreventionBudgetAiEstimate['details'] | null;
        if (Boolean(old?.lockedManual) || LOCKED_STATUSES.includes(old?.status) || details?.kind !== 'AI_ESTIMATE') continue;
        if (reportInput.metricEvidence?.length || old.categoryKey !== reportInput.categoryKey) continue;
        const previousKeys = previousSources.filter((source) => source.itemKey === reportInput.pricingCohortKey &&
          String(source.reportId) === reportInput.reportId && source.sourceKind === 'RECOMMENDATION')
          .map((source) => String(source.sourceKey)).sort();
        const currentKeys = (groups.get(reportInput.pricingCohortKey!) ?? [])
          .filter((finding) => String(finding.reportId) === reportInput.reportId)
          .map((finding) => preventionBudgetStableRecommendationKey(finding)).sort();
        if (!previousKeys.length || JSON.stringify(previousKeys) !== JSON.stringify(currentKeys)) continue;
        const summary = details.sourceReportEstimates?.find((row: any) => String(row.reportId) === reportInput.reportId);
        if (!summary || typeof summary.totalHt !== 'string') continue;
        legacyEstimates.set(reportInput.itemKey, {
          quantity: '1', unit: 'FORFAIT', unitCostHt: summary.totalHt, totalHt: summary.totalHt,
          details: { ...details, rationale: summary.rationale, rangeLowHt: summary.rangeLowHt,
            rangeHighHt: summary.rangeHighHt, governingReportId: reportInput.reportId,
            sourceRecommendations: reportInput.recommendations,
            // A consolidated line does not retain the component split of every
            // losing report. Do not attribute another report's components here.
            components: details.governingReportId === reportInput.reportId ? details.components : [],
            sourceReportEstimates: undefined },
        });
      }
      const resolved = await this.prepareReportEstimates(
        payload.organizationId, reportInputs, forceFresh, globalEstimateCheckpoint, legacyEstimates,
      );
      preparedReportEstimates = resolved.prepared;
      const estimates = resolved.estimates;
      for (const input of needsEstimate) {
        const relevant = reportInputs.filter((candidate) =>
          (groups.get(input.itemKey) ?? []).some((finding) => String(finding.reportId) === candidate.reportId) &&
          candidate.itemKey === createHash('sha256').update(`budget-report-action-v1|${input.itemKey}|${candidate.reportId}`).digest('hex'));
        const estimate = maximumReportBudgetEstimate(relevant.map((candidate) => {
          const found = estimates.get(candidate.itemKey);
          if (!found) throw new Error('Prevention budget estimation AI omitted a report action');
          return { reportId: candidate.reportId!, estimate: found };
        }));
        input.aiEstimate = { quantity: estimate.quantity, unit: estimate.unit, unitCostHt: estimate.unitCostHt,
          totalHt: estimate.totalHt, details: estimate.details };
      }
    }
    const calculation = calculatePreventionBudget(inputs, String(base.contingencyRatePercent ?? defaultRate));
    return this.dataSource.transaction(async (manager) => {
      if (beforeCommit) await beforeCommit();
      const [lockedBase]: Array<any> = await manager.query(
        `SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? FOR UPDATE`,
        [payload.scenarioId, payload.organizationId],
      );
      if (!lockedBase) throw new UnrecoverableError('Prevention budget scenario not found in organization');
      assertPreventionBudgetScenarioVersion(Number(lockedBase.version), payload.scenarioVersion);
      const [transactionLatest]: Array<any> = await manager.query(
        `SELECT * FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [payload.organizationId, lockedBase.scenarioKey],
      );
      if (transactionLatest?.id !== latestSnapshot?.id) throw new UnrecoverableError('Prevention budget changed while AI estimates were being prepared');
      const [transactionAlready]: Array<any> = await manager.query(
        `SELECT id,version FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? AND sourceVersion=? AND status<>'DRAFT' LIMIT 1`,
        [payload.organizationId, lockedBase.scenarioKey, payload.sourceVersion],
      );
      if (transactionAlready) return transactionAlready;
      await this.publishReportEstimates(manager, payload.organizationId, preparedReportEstimates, forceFresh, requestEpochMs, payload.estimateRequestOrder ?? 0);
      const nextVersion = Number(transactionLatest?.version ?? 0) + 1;
      const rate = lockedBase.contingencyRatePercent ?? defaultRate;
      const scenarioId = randomUUID();
      await manager.query(
        `INSERT INTO prevention_budget_scenarios
          (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,missionIds,categoryId,categoryIds,severity,severities,clientKeys,adminPrompt,adminPromptActorId,status,contingencyRatePercent,
           retainedBudgetHt,estimatedBudgetHt,validatedBudgetHt,contingencyAmountHt,totalBudgetHt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'CALCULATED',?,?,?,?,?,?)`,
        [scenarioId, payload.organizationId, lockedBase.scenarioKey, nextVersion, payload.sourceVersion,
          lockedBase.periodStart ?? null, lockedBase.periodEnd ?? null, lockedBase.periodMode ?? 'BOUNDED', lockedBase.missionId ?? null, JSON.stringify(storedStringArray(lockedBase.missionIds)), lockedBase.categoryId ?? null, JSON.stringify(storedStringArray(lockedBase.categoryIds)), lockedBase.severity ?? null, JSON.stringify(storedStringArray(lockedBase.severities)),
          JSON.stringify(storedBudgetClientKeys(lockedBase.clientKeys)), lockedBase.adminPrompt ?? null, lockedBase.adminPromptActorId ?? null,
          calculation.totals.contingencyRatePercent,
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
          (id,organizationId,scenarioId,itemKey,catalogId,categoryId,categoryKey,clientKey,clientLabel,title,priority,quantity,unit,unitCostHt,totalHt,status,justification,aiEstimateDetails,priceSource,lockedManual)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [itemId, payload.organizationId, scenarioId, line.itemKey,
            line.lockedManual ? old?.catalogId ?? null : line.aiEstimateDetails?.kind === 'AI_ESTIMATE' ? null : catalogMatch?.id ?? null,
            line.categoryId, line.categoryKey, line.clientKey ?? null, line.clientLabel ?? null,
            line.title, line.priority, line.quantity, line.unit,
            line.unitCostHt, line.totalHt, line.status,
            line.lockedManual && old?.justification
              ? old.justification
              : `Consolidé depuis ${groups.get(line.itemKey)?.length ?? 0} recommandation(s)`,
            line.aiEstimateDetails ? JSON.stringify(line.aiEstimateDetails) : null,
            line.priceSource, line.lockedManual ? 1 : 0],
        );
        for (const finding of groups.get(line.itemKey) ?? []) {
          await manager.query(
            `INSERT INTO prevention_budget_item_sources
              (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId) VALUES (?,?,?,'RECOMMENDATION',?,?,?)`,
            [randomUUID(), payload.organizationId, itemId, preventionBudgetStableRecommendationKey(finding), finding.id, finding.reportId],
          );
        }
        if (line.lockedManual) {
          for (const source of previousSources.filter((candidate) => candidate.itemKey === line.itemKey)) {
            const current = source.sourceKind === 'RECOMMENDATION'
              ? currentFindingByStableKey.get(String(source.sourceKey)) ?? currentFindingById.get(String(source.findingId))
              : undefined;
            await manager.query(
              `INSERT IGNORE INTO prevention_budget_item_sources
                (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId) VALUES (?,?,?,?,?,?,?)`,
              [randomUUID(), payload.organizationId, itemId, source.sourceKind,
                current ? preventionBudgetStableRecommendationKey(current) : source.sourceKey,
                current?.id ?? source.findingId, source.reportId],
            );
          }
        }
      }
      await manager.query(
        `INSERT INTO prevention_budget_audit
          (id,organizationId,scenarioId,scenarioVersion,action,actorType,actorId,beforeState,afterState)
         VALUES (?,?,?,?,?,'WORKER',NULL,?,?)`,
        [randomUUID(), payload.organizationId, scenarioId, nextVersion, action,
          transactionLatest ? JSON.stringify({ scenarioId: transactionLatest.id, version: transactionLatest.version, retainedBudgetHt: transactionLatest.retainedBudgetHt, totalBudgetHt: transactionLatest.totalBudgetHt }) : null,
          JSON.stringify({ lineCount: calculation.lines.length, totals: calculation.totals, aiEstimatedLines: calculation.lines.filter((line) => line.aiEstimateDetails?.kind === 'AI_ESTIMATE').length })],
      );
      return { id: scenarioId, version: nextVersion };
    });
  }

  /**
   * Estimate a global year in durable pages. Each page is committed before the
   * next LLM call, so a worker restart only resumes missing report estimates.
   * The source assertion is repeated around every page and the Paris bulk
   * window is checked before starting the next call; closing at 06:00 leaves
   * the checkpoint SUSPENDED and schedules an explicit next-window continuation.
   */
  private async estimateGlobalReportInputs(
    reportInputs: Array<any>,
    checkpoint: PreventionBudgetGlobalEstimateCheckpoint,
  ): Promise<Map<string, any>> {
    if (!this.estimateAi) throw new Error('Prevention budget estimation AI service is unavailable');
    const estimates = new Map<string, any>();
    const checkpointTable = checkpoint.storage === 'GLOBAL'
      ? 'prevention_budget_global_estimates' : 'prevention_budget_estimate_checkpoints';
    const checkpointScope = checkpoint.storage === 'GLOBAL'
      ? 'organizationId=? AND runId=? AND year=?'
      : 'organizationId=? AND runId=? AND scenarioId=?';
    const checkpointScopeArgs = checkpoint.storage === 'GLOBAL'
      ? [checkpoint.organizationId, checkpoint.runId, checkpoint.year]
      : [checkpoint.organizationId, checkpoint.runId, checkpoint.scenarioId];
    const persisted: Array<any> = await this.dataSource.query(
      `SELECT itemKey,reportId,sourceVersion,estimate
         FROM ${checkpointTable}
        WHERE ${checkpointScope}`,
      checkpointScopeArgs,
    );
    for (const row of persisted) {
      if (row.sourceVersion !== checkpoint.sourceVersion) throw new UnrecoverableError('Global budget estimate checkpoint source snapshot changed');
      const value = typeof row.estimate === 'string' ? (() => { try { return JSON.parse(row.estimate); } catch { return null; } })() : row.estimate;
      if (value && typeof value === 'object') estimates.set(String(row.itemKey), value);
    }
    for (let offset = 0; offset < reportInputs.length; offset += GLOBAL_ESTIMATE_PAGE_SIZE) {
      await checkpoint.assertSourceStable();
      if (checkpoint.enforceWindow && this.bulkAdmission?.settings && !isWithinPreventionBulkWindow(new Date(), this.bulkAdmission.settings)) {
        throw new PreventionBudgetWindowClosedError('Prevention budget bulk window closed at Europe/Paris 06:00');
      }
      const page = reportInputs.slice(offset, offset + GLOBAL_ESTIMATE_PAGE_SIZE);
      const missing = page.filter((input) => !estimates.has(String(input.itemKey)));
      if (missing.length) {
        const pageEstimates = await this.estimateAi.estimate(missing);
        for (const input of missing) {
          const estimate = pageEstimates.get(input.itemKey);
          if (!estimate) throw new Error('Prevention budget estimation AI omitted a report action');
          estimates.set(String(input.itemKey), estimate);
        }
        await checkpoint.assertSourceStable();
        await this.dataSource.transaction(async (manager) => {
          for (const input of missing) {
            const estimate = estimates.get(String(input.itemKey));
            const insertSql = checkpoint.storage === 'GLOBAL'
              ? `INSERT INTO prevention_budget_global_estimates
                  (id,runId,year,organizationId,itemKey,reportId,sourceVersion,estimate)
                 VALUES (?,?,?,?,?,?,?,?)`
              : `INSERT INTO prevention_budget_estimate_checkpoints
                  (id,runId,scenarioId,organizationId,itemKey,reportId,sourceVersion,estimate)
                 VALUES (?,?,?,?,?,?,?,?)`;
            await manager.query(
              `${insertSql} ON DUPLICATE KEY UPDATE sourceVersion=VALUES(sourceVersion),estimate=VALUES(estimate),completedAt=CURRENT_TIMESTAMP(6)`,
              checkpoint.storage === 'GLOBAL'
                ? [randomUUID(), checkpoint.runId, checkpoint.year, checkpoint.organizationId, input.itemKey, input.reportId, checkpoint.sourceVersion, JSON.stringify(estimate)]
                : [randomUUID(), checkpoint.runId, checkpoint.scenarioId, checkpoint.organizationId, input.itemKey, input.reportId, checkpoint.sourceVersion, JSON.stringify(estimate)],
            );
          }
          const progressSql = checkpoint.storage === 'GLOBAL'
            ? `UPDATE prevention_budget_global_years SET estimateCursor=?,estimateCount=? WHERE id=? AND runId=? AND organizationId=?`
            : `UPDATE prevention_budget_scenarios SET estimateCursor=?,estimateCount=? WHERE id=? AND organizationId=?`;
          const progressArgs = checkpoint.storage === 'GLOBAL'
            ? [Math.min(offset + page.length, reportInputs.length), estimates.size, checkpoint.checkpointId, checkpoint.runId, checkpoint.organizationId]
            : [Math.min(offset + page.length, reportInputs.length), estimates.size, checkpoint.scenarioId, checkpoint.organizationId];
          await manager.query(progressSql, progressArgs);
        });
      } else {
        const progressSql = checkpoint.storage === 'GLOBAL'
          ? `UPDATE prevention_budget_global_years SET estimateCursor=?,estimateCount=? WHERE id=? AND runId=? AND organizationId=?`
          : `UPDATE prevention_budget_scenarios SET estimateCursor=?,estimateCount=? WHERE id=? AND organizationId=?`;
        const progressArgs = checkpoint.storage === 'GLOBAL'
          ? [Math.min(offset + page.length, reportInputs.length), estimates.size, checkpoint.checkpointId, checkpoint.runId, checkpoint.organizationId]
          : [Math.min(offset + page.length, reportInputs.length), estimates.size, checkpoint.scenarioId, checkpoint.organizationId];
        await this.dataSource.query(progressSql, progressArgs);
      }
    }
    return estimates;
  }
}

function parseAiEstimateDetails(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseMetricEvidence(value: unknown): Array<{ quantity: string; unit: string; basis: string; confidence: number }> {
  const parsed = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  return parsed && typeof parsed === 'object' && typeof parsed.quantity === 'string' && typeof parsed.unit === 'string' && typeof parsed.basis === 'string' && typeof parsed.confidence === 'number' ? [parsed as any] : [];
}

function parseGlobalFilters(value: unknown): { clientKeys: string[]; categoryId: string | null; categoryIds: string[]; severity: string | null; severities: string[]; missionId: string | null; missionIds: string[]; contingencyRatePercent?: string } {
  const parsed = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { clientKeys: [], categoryId: null, categoryIds: [], severity: null, severities: [], missionId: null, missionIds: [] };
  const row = parsed as Record<string, unknown>;
  return {
    clientKeys: storedBudgetClientKeys(row.clientKeys),
    categoryId: typeof row.categoryId === 'string' ? row.categoryId : null,
    categoryIds: storedStringArray(row.categoryIds),
    severity: typeof row.severity === 'string' ? row.severity : null,
    severities: storedStringArray(row.severities),
    missionId: typeof row.missionId === 'string' ? row.missionId : null,
    missionIds: storedStringArray(row.missionIds),
    contingencyRatePercent: typeof row.contingencyRatePercent === 'string' ? row.contingencyRatePercent : undefined,
  };
}

function summarizeBudgetRows(items: Array<any>, _rateValue: string): Record<string, string> {
  const cents = (value: unknown): bigint => {
    const [whole, fraction = ''] = String(value ?? '0').split('.');
    return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  };
  const format = (value: bigint): string => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
  const retained = items.reduce((sum, item) => sum + cents(item.totalHt), 0n);
  const estimated = items.filter((item) => item.status === 'ESTIME').reduce((sum, item) => sum + cents(item.totalHt), 0n);
  const validated = items.filter((item) => LOCKED_STATUSES.includes(item.status)).reduce((sum, item) => sum + cents(item.totalHt), 0n);
  return { contingencyRatePercent: '0.00', retainedBudgetHt: format(retained), estimatedBudgetHt: format(estimated), validatedBudgetHt: format(validated), contingencyAmountHt: '0.00', totalBudgetHt: format(retained) };
}
