import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Queue, Job } from 'bullmq';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PREVENTION_BULK_QUEUE_NAME } from '../queue/prevention-queue.constants';
import { MANUAL_JOB_TYPE, PreventionRebuildQueueService } from './prevention-rebuild-queue.service';
import { PreventionGroupProcessingService } from '../worker/prevention-group-processing.service';
import { loadPreventionBudgetRawSourceVersion, loadPreventionBudgetSourceVersion, PreventionBudgetService } from '../budget/prevention-budget.service';
import { PreventionObservabilityService } from '../observability/prevention-observability.service';
import { loadPreventionBulkConfiguration, nextPreventionBulkWindowStart, PreventionBulkConfiguration } from '../scheduler/prevention-bulk.config';
import { PREVENTION_DIFFERENTIAL_JOB, PREVENTION_HYPER_ADMIN_RECOVERY_JOB, PREVENTION_MANUAL_REBUILD_JOB } from '../scheduler/prevention-scheduler.types';
import { preventionFailureDiagnostic } from '../worker/prevention-log-error';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function deterministicUuid(value: string): string {
  const hex = digest(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface PreventionHyperAdminRecoveryPreview {
  organizationId: string;
  reportCount: number;
  findingCount: number;
  estimationWorkloadCount: number;
  groupCount: number;
  pendingGroupCount: number;
  immediateAllowed: boolean;
  immediateReason: string;
  hardRejected: boolean;
  scheduledFor: string | null;
  sourceVersion: string;
  activationRunId: string | null;
  confirmationToken: string;
  activationScan: Record<string, unknown> | null;
  worker: Record<string, unknown>;
}

@Injectable()
export class PreventionHyperAdminRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PreventionHyperAdminRecoveryService.name);
  private readonly queue: Queue;
  private readonly signingKey: Buffer;
  private readonly bulkConfiguration: PreventionBulkConfiguration;
  private readonly config: ConfigService;
  private recoverySweepTimer?: ReturnType<typeof setInterval>;

  private logStage(organizationId: string, recoveryRunId: string, stage: string, status: string): void {
    this.logger.log({
      message: 'PREVENTION_RECOVERY_STAGE_CHANGED',
      event: 'PREVENTION_RECOVERY_STAGE_CHANGED',
      organizationId,
      recoveryRunId,
      stage,
      status,
    } as any);
  }

  constructor(
    private readonly db: DataSource,
    config: ConfigService,
    @Optional() private readonly rebuild?: PreventionRebuildQueueService,
    @Optional() private readonly groups?: PreventionGroupProcessingService,
    @Optional() private readonly budget?: PreventionBudgetService,
    @Optional() private readonly observability?: PreventionObservabilityService,
  ) {
    this.config = config;
    this.queue = new Queue(PREVENTION_BULK_QUEUE_NAME, { connection: createPreventionRedisOptions(config) });
    const secret = config.get<string>('PREVENTION_HYPER_ADMIN_RECOVERY_SECRET') || config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      if (process.env.NODE_ENV === 'production') throw new Error('A strong Hyper Admin recovery signing secret is required');
      this.signingKey = Buffer.from('local-hyper-admin-recovery-secret-please-change-32');
    } else this.signingKey = Buffer.from(secret);
    this.bulkConfiguration = loadPreventionBulkConfiguration(config);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.recoverySweepTimer) clearInterval(this.recoverySweepTimer);
    await this.queue.close();
  }

  /** Redis is intentionally not the source of truth for this flow. Requeue
   * every durable non-terminal run on API/worker restart so a lost BullMQ job
   * cannot strand a tenant in PROCESSING forever. */
  async onApplicationBootstrap(): Promise<void> {
    await this.requeueActiveRuns();
    this.recoverySweepTimer = setInterval(() => { void this.requeueActiveRuns(); }, 60_000);
    (this.recoverySweepTimer as any).unref?.();
  }

  private async requeueActiveRuns(): Promise<void> {
    const sweepCutoff = new Date();
    let afterCreatedAt: string | null = null;
    let afterId: string | null = null;
    for (;;) {
      const args: unknown[] = [sweepCutoff];
      let cursor = '';
      if (afterCreatedAt !== null && afterId !== null) {
        cursor = ' AND (createdAt>? OR (createdAt=? AND id>?))';
        args.push(afterCreatedAt, afterCreatedAt, afterId);
      }
      const runs: Array<{ id: string; organizationId: string; status: string; scheduledFor: string | null; createdAt: string }> = await this.db.query(
        `SELECT id,organizationId,status,scheduledFor,createdAt FROM prevention_hyper_admin_recovery_runs
         WHERE status IN ('PENDING','PROCESSING','SCHEDULED') AND createdAt<=?
           AND (leaseUntil IS NULL OR leaseUntil<UTC_TIMESTAMP(6))${cursor}
         ORDER BY createdAt,id LIMIT 500`, args,
      );
      if (!runs.length) break;
      for (const run of runs) {
        const delayMs = run.scheduledFor ? Math.max(0, Date.parse(String(run.scheduledFor)) - Date.now()) : 0;
        await this.enqueueRecovery(run.id, run.organizationId, delayMs, true, run.scheduledFor).catch(() => undefined);
      }
      if (runs.length < 500) break;
      const last = runs[runs.length - 1];
      afterCreatedAt = String(last.createdAt);
      afterId = String(last.id);
    }
  }

  private assertOrganizationId(organizationId: string): void {
    if (!UUID_PATTERN.test(organizationId)) throw new ConflictException('Organisation invalide');
  }

  private sign(preview: Pick<PreventionHyperAdminRecoveryPreview, 'organizationId' | 'reportCount' | 'findingCount' | 'estimationWorkloadCount' | 'groupCount' | 'sourceVersion' | 'activationRunId'>, issuedAt = Date.now()): string {
    const body = Buffer.from(JSON.stringify({ v: 1, nonce: randomUUID(), organizationId: preview.organizationId, reportCount: preview.reportCount, findingCount: preview.findingCount, estimationWorkloadCount: preview.estimationWorkloadCount, groupCount: preview.groupCount, sourceVersion: preview.sourceVersion, activationRunId: preview.activationRunId, issuedAt })).toString('base64url');
    const signature = createHmac('sha256', this.signingKey).update(`prevention-hyper-recovery-v1|${body}`).digest('base64url');
    return `${body}.${signature}`;
  }

  private verify(token: string, preview: Pick<PreventionHyperAdminRecoveryPreview, 'organizationId' | 'reportCount' | 'findingCount' | 'estimationWorkloadCount' | 'groupCount' | 'sourceVersion' | 'activationRunId'>): string {
    if (!token || token.length > 2048) throw new ConflictException('Prévisualisation de rattrapage invalide');
    const parts = token.split('.');
    if (parts.length !== 2) throw new ConflictException('Prévisualisation de rattrapage invalide');
    let payload: any;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { payload = null; }
    const expected = createHmac('sha256', this.signingKey).update(`prevention-hyper-recovery-v1|${parts[0]}`).digest();
    const supplied = Buffer.from(parts[1], 'base64url');
    const issuedAt = Number(payload?.issuedAt);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || payload?.v !== 1 ||
        typeof payload?.nonce !== 'string' || !UUID_PATTERN.test(payload.nonce) ||
        payload?.organizationId !== preview.organizationId || Number(payload?.reportCount) !== preview.reportCount ||
        Number(payload?.findingCount) !== preview.findingCount || Number(payload?.estimationWorkloadCount) !== preview.estimationWorkloadCount ||
        Number(payload?.groupCount) !== preview.groupCount || payload?.sourceVersion !== preview.sourceVersion ||
        payload?.activationRunId !== preview.activationRunId || !Number.isSafeInteger(issuedAt) ||
        issuedAt > Date.now() + 5_000 || Date.now() - issuedAt > 15 * 60_000) {
      throw new ConflictException('Le volume de rattrapage a changé, veuillez actualiser la prévisualisation');
    }
    // Bind the durable one-time command to this exact signed token. A fresh
    // preview gets a new issuedAt and therefore may intentionally authorize a
    // later recovery even when source counts are unchanged.
    return digest(`${token}`);
  }

  private async workerHealth(): Promise<Record<string, unknown>> {
    if (!this.observability) return { status: 'unknown', heartbeatAgeSeconds: null };
    const health = await this.observability.health();
    return { status: health.worker.status, heartbeatAgeSeconds: health.worker.heartbeatAgeSeconds };
  }

  async preview(organizationId: string): Promise<PreventionHyperAdminRecoveryPreview> {
    this.assertOrganizationId(organizationId);
    const [organization] = await this.db.query('SELECT id,isActive,preventionEnabled FROM organizations WHERE id=? LIMIT 1', [organizationId]);
    if (!organization) throw new NotFoundException('Organisation introuvable');
    if (Number(organization.isActive) !== 1 || Number(organization.preventionEnabled) !== 1) throw new ConflictException('Organisation inactive ou prévention désactivée');
    const [volume] = await this.db.query(
      `SELECT
        (SELECT COUNT(DISTINCT r.id) FROM reports r JOIN visits v ON v.id=r.visitId AND v.organizationId=? WHERE r.organizationId=?) reportCount,
        (SELECT COUNT(*) FROM prevention_findings f WHERE f.organizationId=?) findingCount,
        (SELECT COUNT(DISTINCT CONCAT(COALESCE(NULLIF(TRIM(m.client),''),'__UNASSIGNED__'),'|',COALESCE(f.actionType,f.normalizedKey,'UNKNOWN'),'|',COALESCE(f.categoryId,'UNCATEGORIZED')))
           FROM prevention_findings f LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
          WHERE f.organizationId=? AND f.findingType='RECOMMENDATION') estimationWorkloadCount,
        (SELECT COUNT(*) FROM prevention_group_processing_jobs g WHERE g.organizationId=? AND g.processingStatus IN ('PENDING','PROCESSING','RETRY')) pendingGroupCount`,
      [organizationId, organizationId, organizationId, organizationId, organizationId],
    );
    const reportCount = Number(volume?.reportCount ?? 0);
    const findingCount = Number(volume?.findingCount ?? 0);
    const estimationWorkloadCount = Number(volume?.estimationWorkloadCount ?? 0);
    const intConfig = (key: string, fallback: number): number => {
      const value = Number(this.config.get(key, fallback));
      return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    };
    if (!this.groups) throw new ConflictException('Service de construction Prévention indisponible');
    const groupHardCeiling = intConfig('PREVENTION_RECOVERY_HARD_GROUP_CEILING', 10_000);
    const groupCount = await this.groups.countEligibleGroups(organizationId, groupHardCeiling);
    const workUnits = reportCount + findingCount + groupCount;
    const hardRejected = reportCount > intConfig('PREVENTION_BUDGET_HARD_REPORT_CEILING', 10_000) ||
      findingCount > intConfig('PREVENTION_BUDGET_HARD_RECOMMENDATION_CEILING', 100_000) ||
      estimationWorkloadCount > intConfig('PREVENTION_BUDGET_HARD_ESTIMATION_CEILING', 10_000) || groupCount > groupHardCeiling;
    const budgetImmediateAllowed = reportCount <= intConfig('PREVENTION_BUDGET_IMMEDIATE_REPORT_CEILING', 250) &&
      findingCount <= intConfig('PREVENTION_BUDGET_IMMEDIATE_RECOMMENDATION_CEILING', 2_500) &&
      estimationWorkloadCount <= intConfig('PREVENTION_BUDGET_IMMEDIATE_ESTIMATION_CEILING', 250);
    const immediateAllowed = !hardRejected && workUnits <= this.bulkConfiguration.immediateRebuildCeiling && budgetImmediateAllowed;
    const immediateReason = hardRejected ? 'VOLUME_EXCEEDS_HARD_CEILING'
      : !budgetImmediateAllowed ? 'BUDGET_VOLUME_REQUIRES_BULK_WINDOW'
        : workUnits > this.bulkConfiguration.immediateRebuildCeiling ? 'REBUILD_VOLUME_REQUIRES_BULK_WINDOW' : 'WITHIN_IMMEDIATE_CEILING';
    const scheduledFor = immediateAllowed ? null : nextPreventionBulkWindowStart(new Date(), this.bulkConfiguration).toISOString();
    const [activation] = await this.db.query(
      `SELECT r.id runId,r.status runStatus,r.scheduledFor,c.status checkpointStatus,c.processedReports,
              c.pendingJobs,c.failedJobs,c.scanComplete,c.lastError
       FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?
       WHERE c.organizationId=? AND r.workKind='ACTIVATION' ORDER BY r.createdAt DESC LIMIT 1`,
      [organizationId, organizationId],
    );
    const sourceVersion = await loadPreventionBudgetSourceVersion(this.db, organizationId);
    return {
      organizationId, reportCount, findingCount, estimationWorkloadCount, groupCount,
      pendingGroupCount: Number(volume?.pendingGroupCount ?? 0), immediateAllowed, hardRejected,
      immediateReason,
      scheduledFor, sourceVersion, activationRunId: activation?.runId ? String(activation.runId) : null,
      confirmationToken: this.sign({ organizationId, reportCount, findingCount, estimationWorkloadCount, groupCount, sourceVersion, activationRunId: activation?.runId ? String(activation.runId) : null }),
      activationScan: activation ? { ...activation, processedReports: Number(activation.processedReports ?? 0), pendingJobs: Number(activation.pendingJobs ?? 0), failedJobs: Number(activation.failedJobs ?? 0), scanComplete: Boolean(activation.scanComplete) } : null,
      worker: await this.workerHealth(),
    };
  }

  async confirm(organizationId: string, token: string, immediateRequested: boolean, createdBy?: string): Promise<Record<string, unknown>> {
    this.assertOrganizationId(organizationId);
    const preview = await this.preview(organizationId);
    const confirmationDigest = this.verify(token, preview);
    if (immediateRequested && !preview.immediateAllowed) {
      throw new ConflictException({ message: 'Le volume dépasse le plafond d’exécution immédiate', preview });
    }
    if (preview.hardRejected) throw new ConflictException({ message: 'Le volume dépasse le plafond global autorisé', preview });
    const executionMode = immediateRequested ? 'IMMEDIATE' : 'SCHEDULED';
    const recoveryId = randomUUID();
    const scheduledFor = executionMode === 'SCHEDULED'
      ? nextPreventionBulkWindowStart(new Date(), this.bulkConfiguration).toISOString() : null;
    // Persist the command before touching the scheduler/Redis. A queue or
    // process failure therefore leaves an inspectable durable run that the
    // bootstrap sweep can retry instead of untracked work.
    const existing = await this.db.transaction(async (manager) => {
      // Serialize confirmations per tenant. The activation row may be
      // adopted by the first command, changing the next preview token.
      await manager.query('SELECT id FROM organizations WHERE id=? FOR UPDATE', [organizationId]);
      const [sameDigest] = await manager.query(
        `SELECT id,status FROM prevention_hyper_admin_recovery_runs
         WHERE organizationId=? AND confirmationDigest=? LIMIT 1 FOR UPDATE`, [organizationId, confirmationDigest],
      );
      if (sameDigest) {
        if (['PENDING', 'PROCESSING', 'SCHEDULED'].includes(String(sameDigest.status))) return sameDigest;
        throw new ConflictException('Ce jeton de rattrapage a déjà été utilisé');
      }
      const [active] = await manager.query(
        `SELECT id FROM prevention_hyper_admin_recovery_runs
         WHERE organizationId=? AND status IN ('PENDING','PROCESSING','SCHEDULED')
         ORDER BY createdAt DESC LIMIT 1 FOR UPDATE`, [organizationId],
      );
      if (active) return active;
      await manager.query(
        `INSERT INTO prevention_hyper_admin_recovery_runs
         (id,organizationId,status,executionMode,scheduledFor,extractionRunId,stage,reportCount,findingCount,immediateAllowed,sourceVersion,confirmationDigest,createdBy)
         VALUES (?,?,?, ?,?,?,?,?,?,?,?,?,?)`,
        [recoveryId, organizationId, 'PENDING', executionMode, scheduledFor,
          null, 'EXTRACTION', preview.reportCount, preview.findingCount, preview.immediateAllowed ? 1 : 0, preview.sourceVersion, confirmationDigest, createdBy ?? null],
      );
      return null;
    });
    if (existing) return this.status(organizationId, existing.id);
    try {
      if (!this.rebuild) throw new ConflictException('Service de reconstruction indisponible');
      const measured = await this.enqueueExtraction(organizationId, executionMode, preview.reportCount, preview.findingCount);
      await this.db.query(
        `UPDATE prevention_hyper_admin_recovery_runs
         SET extractionRunId=?,status=?
         WHERE id=? AND organizationId=? AND stage='EXTRACTION'`,
        [measured.id, executionMode === 'IMMEDIATE' ? 'PROCESSING' : 'SCHEDULED', recoveryId, organizationId],
      );
      this.logStage(organizationId, recoveryId, 'EXTRACTION', executionMode === 'IMMEDIATE' ? 'PROCESSING' : 'SCHEDULED');
      await this.enqueueRecovery(recoveryId, organizationId, scheduledFor ? Math.max(1_000, Date.parse(scheduledFor) - Date.now()) : 0);
    } catch (error) {
      await this.noteError(recoveryId, organizationId, 'RECOVERY_QUEUE_ENQUEUE_FAILED');
      throw error;
    }
    const result = await this.status(organizationId, recoveryId);
    return { runId: recoveryId, ...(result.latestRun as Record<string, unknown> ?? {}), ...result };
  }

  /** Adopt an untouched activation checkpoint so a confirmed full recovery
   * does not wait behind the same tenant's automatic differential job. If the
   * checkpoint already owns report tasks, the normal manual-rebuild path is
   * retained and the bulk admission fence serializes both runs. */
  private async enqueueExtraction(organizationId: string, executionMode: 'IMMEDIATE' | 'SCHEDULED', reportCount: number, findingCount: number): Promise<{ id: string; status: string }> {
    const activation = await this.db.transaction(async (manager) => {
      const [candidate] = await manager.query(
        `SELECT r.id,r.scheduledFor,r.status,c.status checkpointStatus,c.reportCursor,c.processedReports,c.scanComplete,c.pendingJobs,c.lockedBy
         FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?
         WHERE r.jobType=? AND r.workKind='ACTIVATION' AND c.organizationId=?
           AND r.status IN ('PENDING','PROCESSING','SCHEDULED') ORDER BY r.createdAt DESC LIMIT 1 FOR UPDATE`,
        [organizationId, PREVENTION_DIFFERENTIAL_JOB, organizationId],
      );
      const adoptable = candidate && candidate.checkpointStatus === 'PENDING' && !candidate.reportCursor && Number(candidate.processedReports ?? 0) === 0 && !Number(candidate.scanComplete) && Number(candidate.pendingJobs ?? 0) === 0 && !candidate.lockedBy;
      if (!adoptable) return null;
      const oldScheduledFor = new Date(candidate.scheduledFor).toISOString();
      const oldDigest = createHash('sha256').update(`${PREVENTION_DIFFERENTIAL_JOB}|${oldScheduledFor}|${organizationId}|FIRST|SCHEDULED`).digest('hex');
      const oldJob = await this.queue.getJob(`prevention-scheduler-org-${oldDigest}`);
      if (oldJob) {
        const oldState = await oldJob.getState();
        if (oldState === 'active') return null;
        await oldJob.remove().catch(() => undefined);
      }
      const scheduledFor = executionMode === 'SCHEDULED' ? nextPreventionBulkWindowStart(new Date(), this.bulkConfiguration) : new Date();
      await manager.query(
        `UPDATE prevention_scheduler_runs SET jobType=?,workKind='ADMIN_RECONSTRUCTION',executionMode=?,scheduledFor=?,status=?,reportCount=?,findingCount=?,immediateLimit=?,lastError=NULL WHERE id=? AND workKind='ACTIVATION'`,
        [MANUAL_JOB_TYPE, executionMode, scheduledFor, executionMode === 'SCHEDULED' ? 'SCHEDULED' : 'PROCESSING', reportCount, findingCount, this.bulkConfiguration.immediateRebuildCeiling, candidate.id],
      );
      return { id: String(candidate.id), scheduledFor };
    });
    if (!activation) {
      if (!this.rebuild) throw new ConflictException('Service de reconstruction indisponible');
      return this.rebuild.enqueueForMode(organizationId, executionMode);
    }
    const runId = activation.id;
    const scheduledFor = activation.scheduledFor;
    const jobId = `prevention-manual-rebuild-${createHash('sha256').update(`${organizationId}|${runId}`).digest('hex')}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return { id: runId, status: executionMode === 'SCHEDULED' ? 'SCHEDULED' : 'PROCESSING' };
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(PREVENTION_MANUAL_REBUILD_JOB, { organizationId, runId, scheduledFor: scheduledFor.toISOString() }, {
      jobId, ...(executionMode === 'SCHEDULED' ? { delay: Math.max(0, scheduledFor.getTime() - Date.now()) } : {}),
      attempts: 4, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
    return { id: runId, status: executionMode === 'SCHEDULED' ? 'SCHEDULED' : 'PROCESSING' };
  }

  async process(job: Job): Promise<string> {
    try {
      return await this.processInternal(job);
    } catch (error) {
      const data = job.data as { organizationId?: string; recoveryId?: string };
      if (UUID_PATTERN.test(String(data?.organizationId ?? '')) && UUID_PATTERN.test(String(data?.recoveryId ?? ''))) {
        const [run] = await this.db.query(
          `SELECT status FROM prevention_hyper_admin_recovery_runs WHERE id=? AND organizationId=? LIMIT 1`,
          [data.recoveryId, data.organizationId],
        ).catch(() => [null]);
        const terminalAttempt = Number(job.attemptsMade ?? 0) + 1 >= Number(job.opts?.attempts ?? 1);
        if (terminalAttempt && run && !['COMPLETED', 'FAILED'].includes(String(run.status))) {
          await this.enqueueRecovery(String(data.recoveryId), String(data.organizationId), 60_000).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private async processInternal(job: Job): Promise<string> {
    const data = job.data as { organizationId?: string; recoveryId?: string };
    this.assertOrganizationId(String(data?.organizationId ?? ''));
    if (!UUID_PATTERN.test(String(data?.recoveryId ?? ''))) throw new Error('Invalid Hyper Admin recovery payload');
    const [run] = await this.db.query('SELECT * FROM prevention_hyper_admin_recovery_runs WHERE id=? AND organizationId=? LIMIT 1', [data.recoveryId, data.organizationId]);
    if (!run || ['COMPLETED', 'FAILED'].includes(String(run.status))) return 'SKIPPED';
    const leaseOwner = `${process.pid}:${randomUUID()}`;
    const leaseMs = this.leaseDurationMs();
    const claimResult: any = await this.db.query(
      `UPDATE prevention_hyper_admin_recovery_runs
       SET leaseOwner=?,leaseUntil=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND)
       WHERE id=? AND organizationId=? AND status IN ('PENDING','PROCESSING','SCHEDULED')
         AND (leaseUntil IS NULL OR leaseUntil<UTC_TIMESTAMP(6) OR leaseOwner=?)`,
      [leaseOwner, leaseMs * 1000, data.recoveryId, data.organizationId, leaseOwner],
    );
    // TypeORM's MySQL driver returns an OkPacket. The array fallback keeps
    // lightweight service tests compatible without weakening the production
    // affected-row CAS check.
    if (!Array.isArray(claimResult) && Number(claimResult?.affectedRows ?? 0) !== 1) return 'LEASED';
    try {
      const [claimedRun] = await this.db.query(
        `SELECT * FROM prevention_hyper_admin_recovery_runs
         WHERE id=? AND organizationId=? AND leaseOwner=? AND leaseUntil>UTC_TIMESTAMP(6) LIMIT 1`,
        [data.recoveryId, data.organizationId, leaseOwner],
      );
      if (!claimedRun || ['COMPLETED', 'FAILED'].includes(String(claimedRun.status))) return 'LEASED';
      return await this.processClaimedRun(job, data, claimedRun, leaseOwner);
    } finally {
      await this.db.query(
        `UPDATE prevention_hyper_admin_recovery_runs SET leaseOwner=NULL,leaseUntil=NULL WHERE id=? AND organizationId=? AND leaseOwner=?`,
        [data.recoveryId, data.organizationId, leaseOwner],
      ).catch(() => undefined);
    }
  }

  private async renewLease(organizationId: string, recoveryId: string, leaseOwner: string): Promise<void> {
    const leaseMs = this.leaseDurationMs();
    const result: any = await this.db.query(
      `UPDATE prevention_hyper_admin_recovery_runs
       SET leaseUntil=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND)
       WHERE id=? AND organizationId=? AND leaseOwner=? AND leaseUntil>UTC_TIMESTAMP(6)`,
      [leaseMs * 1000, recoveryId, organizationId, leaseOwner],
    );
    if (!Array.isArray(result) && Number(result?.affectedRows ?? 0) !== 1) throw new Error('PREVENTION_RECOVERY_LEASE_LOST');
  }

  private leaseDurationMs(): number {
    return Math.max(10_000, Math.min(15 * 60_000, Number(this.config.get('PREVENTION_HYPER_ADMIN_RECOVERY_LEASE_MS', 120_000)) || 120_000));
  }

  private async withLease<T>(organizationId: string, recoveryId: string, leaseOwner: string, operation: () => Promise<T>): Promise<T> {
    const heartbeatMs = Math.max(5_000, Math.floor(this.leaseDurationMs() / 3));
    let heartbeatError: unknown;
    const timer = setInterval(() => {
      void this.renewLease(organizationId, recoveryId, leaseOwner).catch((error) => { heartbeatError ??= error; });
    }, heartbeatMs);
    (timer as any).unref?.();
    try {
      const result = await operation();
      if (heartbeatError) throw heartbeatError;
      return result;
    } finally {
      clearInterval(timer);
    }
  }

  private async fencedUpdate(
    recoveryId: string,
    organizationId: string,
    leaseOwner: string,
    setClause: string,
    values: unknown[],
    expectedStage?: 'EXTRACTION' | 'GROUPS' | 'BUDGET',
  ): Promise<void> {
    const stageClause = expectedStage ? ' AND stage=?' : '';
    const params = [...values, recoveryId, organizationId, leaseOwner, ...(expectedStage ? [expectedStage] : [])];
    const result: any = await this.db.query(
      `UPDATE prevention_hyper_admin_recovery_runs SET ${setClause}
       WHERE id=? AND organizationId=? AND leaseOwner=? AND leaseUntil>UTC_TIMESTAMP(6)
         AND status NOT IN ('COMPLETED','FAILED')${stageClause}`,
      params,
    );
    if (!Array.isArray(result) && Number(result?.affectedRows ?? 0) !== 1) throw new Error('PREVENTION_RECOVERY_LEASE_LOST');
  }

  private async processClaimedRun(job: Job, data: { organizationId?: string; recoveryId?: string }, run: any, leaseOwner: string): Promise<string> {
    const organizationId = String(data.organizationId);
    const recoveryId = String(data.recoveryId);
    const [organization] = await this.db.query('SELECT isActive,preventionEnabled FROM organizations WHERE id=? LIMIT 1', [data.organizationId]);
    if (!organization || Number(organization.isActive) !== 1 || Number(organization.preventionEnabled) !== 1) {
      await this.fencedUpdate(recoveryId, organizationId, leaseOwner, `status='SCHEDULED',lastError=?`, ['ORG_DISABLED_PAUSED']);
      return 'PAUSED_DISABLED';
    }
    if (!run.extractionRunId) {
      if (!this.rebuild) throw new Error('Prevention reconstruction unavailable');
      const measured = await this.withLease(organizationId, recoveryId, leaseOwner,
        () => this.enqueueExtraction(data.organizationId!, run.executionMode === 'IMMEDIATE' ? 'IMMEDIATE' : 'SCHEDULED', Number(run.reportCount), Number(run.findingCount)));
      await this.fencedUpdate(recoveryId, organizationId, leaseOwner, `extractionRunId=?,status=?`, [measured.id, run.executionMode === 'IMMEDIATE' ? 'PROCESSING' : 'SCHEDULED'], 'EXTRACTION');
      await this.enqueueRecovery(run.id, data.organizationId, 1_000);
      return 'EXTRACTION_ENQUEUED';
    }
    if (run.stage === 'EXTRACTION') {
      const [source] = await this.db.query(
        `SELECT r.status runStatus,c.status checkpointStatus,c.pendingJobs,c.failedJobs,c.scanComplete
         FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?
         WHERE r.id=? AND c.organizationId=? LIMIT 1`, [data.organizationId, run.extractionRunId, data.organizationId],
      );
      if (!source || source.runStatus === 'FAILED' || source.checkpointStatus === 'FAILED' || Number(source.failedJobs) > 0) {
        await this.fail(run.id, data.organizationId, 'EXTRACTION_FAILED', 'EXTRACTION', leaseOwner); return 'FAILED';
      }
      if (source.runStatus !== 'COMPLETED' || source.checkpointStatus !== 'COMPLETED' || Number(source.pendingJobs) > 0) {
        await this.enqueueRecovery(run.id, data.organizationId, 30_000); return 'WAITING_EXTRACTION';
      }
      // Full extraction intentionally materializes/replaces findings. Refresh
      // the durable budget snapshot after that expected write; later changes
      // (during groups or budgeting) remain a genuine source-drift failure.
      await this.renewLease(organizationId, recoveryId, leaseOwner);
      const { extractedSourceVersion, extractedRawSourceVersion } = await this.withLease(organizationId, recoveryId, leaseOwner, async () => ({
        extractedSourceVersion: await loadPreventionBudgetSourceVersion(this.db, data.organizationId),
        extractedRawSourceVersion: await loadPreventionBudgetRawSourceVersion(this.db, data.organizationId),
      }));
      await this.renewLease(organizationId, recoveryId, leaseOwner);
      await this.fencedUpdate(recoveryId, organizationId, leaseOwner, 'sourceVersion=?,rawSourceVersion=?', [extractedSourceVersion, extractedRawSourceVersion], 'EXTRACTION');
      await this.fencedUpdate(recoveryId, organizationId, leaseOwner, `stage='GROUPS',status='PROCESSING'`, [], 'EXTRACTION');
      this.logStage(organizationId, recoveryId, 'GROUPS', 'PROCESSING');
    }
    const [current] = await this.db.query('SELECT * FROM prevention_hyper_admin_recovery_runs WHERE id=? AND organizationId=? LIMIT 1', [recoveryId, organizationId]);
    if (current?.stage === 'GROUPS') {
      if (!this.groups) throw new Error('Prevention group processing unavailable');
      if (current.expectedGroupCount == null) {
        const groupHardCeiling = Math.max(1, Number(this.config.get('PREVENTION_RECOVERY_HARD_GROUP_CEILING', 10_000)) || 10_000);
        const expectedGroupCount = await this.withLease(organizationId, recoveryId, leaseOwner,
          () => this.groups!.countEligibleGroups(organizationId, groupHardCeiling));
        if (expectedGroupCount > groupHardCeiling) {
          await this.fail(current.id, organizationId, 'GROUP_VOLUME_EXCEEDS_HARD_CEILING', 'GROUPS', leaseOwner);
          return 'FAILED';
        }
        await this.renewLease(organizationId, recoveryId, leaseOwner);
        await this.fencedUpdate(recoveryId, organizationId, leaseOwner, 'expectedGroupCount=?', [expectedGroupCount], 'GROUPS');
        current.expectedGroupCount = expectedGroupCount;
      }
      await this.renewLease(organizationId, recoveryId, leaseOwner);
      const result = await this.withLease(organizationId, recoveryId, leaseOwner,
        () => this.groups!.backfillOrganization(data.organizationId!, 100, current.groupCursor ?? undefined, undefined, recoveryId));
      await this.renewLease(organizationId, recoveryId, leaseOwner);
      if (result.visits >= 100 && result.nextCursor) {
        await this.fencedUpdate(recoveryId, organizationId, leaseOwner, 'groupCursor=?', [result.nextCursor], 'GROUPS');
        await this.enqueueRecovery(run.id, data.organizationId, 1_000); return 'CONTINUED_GROUPS';
      }
      const [groupState] = await this.db.query(
        `SELECT COUNT(*) total,SUM(processingStatus IN ('PENDING','PROCESSING','RETRY')) pending,
                SUM(processingStatus='READY') ready,
                SUM(processingStatus='FAILED') failed
         FROM prevention_group_processing_jobs WHERE organizationId=? AND recoveryRunId=?`, [data.organizationId, recoveryId],
      );
      if (Number(groupState?.failed ?? 0) > 0) {
        await this.fail(current.id, data.organizationId, 'PREVENTION_GROUP_PROCESSING_FAILED', 'GROUPS', leaseOwner);
        return 'FAILED';
      }
      if (Number(groupState?.pending ?? 0) > 0) { await this.enqueueRecovery(run.id, data.organizationId, 30_000); return 'WAITING_GROUPS'; }
      // A removed visit group may leave a durable historical job. Extraction
      // builds findings only from current visit entries, so such a job cannot
      // contribute to this budget; keep it for audit and human validation.
      // A still-eligible old job must continue to block publication.
      const [obsoleteGroups] = await this.db.query(
        `SELECT COUNT(*) total FROM prevention_group_processing_jobs g
         JOIN visits v ON v.organizationId=g.organizationId AND v.id=g.visitId
         WHERE g.organizationId=? AND (g.recoveryRunId IS NULL OR g.recoveryRunId<>?)
           AND EXISTS (
             SELECT 1 FROM JSON_TABLE(v.photos, '$[*]' COLUMNS (
               entryOrder FOR ORDINALITY,
               groupId VARCHAR(100) PATH '$.groupId',
               entryId VARCHAR(100) PATH '$.id',
               analysis JSON PATH '$.analysis'
             )) entry
             WHERE CAST(COALESCE(NULLIF(entry.groupId,''),NULLIF(entry.entryId,''),
                                 CONCAT('entry-',entry.entryOrder-1)) AS BINARY)
                   = CAST(g.sourceGroupId AS BINARY)
               AND JSON_TYPE(entry.analysis)='OBJECT'
           )`,
        [data.organizationId, recoveryId],
      );
      if (Number(obsoleteGroups?.total ?? 0) > 0) {
        await this.fail(current.id, data.organizationId, 'GROUP_SOURCE_OBSOLETE_OR_UNAVAILABLE', 'GROUPS', leaseOwner);
        return 'FAILED';
      }
      if (Number(groupState?.total ?? 0) !== Number(current.expectedGroupCount) ||
          Number(groupState?.ready ?? 0) !== Number(current.expectedGroupCount)) {
        await this.fail(current.id, data.organizationId, 'GROUP_REBUILD_INCOMPLETE', 'GROUPS', leaseOwner);
        return 'FAILED';
      }
      // READY group assessments create report events in the same transaction.
      // Wait until every affected report's snapshot was updated after its last
      // event; both columns use the DB clock. indexedAt mixes application and
      // DB time zones, while group.updatedAt also changes on human validation.
      const [indexState] = await this.db.query(
        `SELECT COUNT(*) AS lagging FROM (
           SELECT r.id FROM prevention_group_processing_jobs g
           JOIN reports r ON r.organizationId=g.organizationId AND r.visitId=g.visitId
           LEFT JOIN prevention_report_snapshots s ON s.organizationId=r.organizationId AND s.reportId=r.id
           LEFT JOIN prevention_outbox_events e ON e.organizationId=r.organizationId AND e.aggregateId=r.id
             AND e.aggregateType='REPORT' AND e.eventType='REPORT_UPSERTED'
           WHERE g.organizationId=? AND g.recoveryRunId=?
           GROUP BY r.id
           HAVING MAX(s.updatedAt) IS NULL OR MAX(e.createdAt) IS NULL OR MAX(s.updatedAt)<MAX(e.createdAt)
         ) pendingReports`, [data.organizationId, recoveryId],
      );
      if (Number(indexState?.lagging ?? 0) > 0) {
        const [failedIndex] = await this.db.query(
          `SELECT COUNT(DISTINCT r.id) AS failed FROM prevention_group_processing_jobs g
           JOIN reports r ON r.organizationId=g.organizationId AND r.visitId=g.visitId
           LEFT JOIN prevention_report_snapshots s ON s.organizationId=r.organizationId AND s.reportId=r.id
           JOIN prevention_outbox_events e ON e.organizationId=r.organizationId AND e.aggregateId=r.id
             AND e.aggregateType='REPORT' AND e.eventType='REPORT_UPSERTED' AND e.status='FAILED'
           WHERE g.organizationId=? AND g.recoveryRunId=?
             AND (s.updatedAt IS NULL OR e.createdAt>s.updatedAt)
             AND NOT EXISTS (
               SELECT 1 FROM prevention_outbox_events newer
               WHERE newer.organizationId=e.organizationId AND newer.aggregateId=e.aggregateId
                 AND newer.aggregateType='REPORT' AND newer.eventType='REPORT_UPSERTED'
                 AND (newer.createdAt>e.createdAt OR (newer.createdAt=e.createdAt AND newer.id>e.id))
             )`,
          [data.organizationId, recoveryId],
        );
        if (Number(failedIndex?.failed ?? 0) > 0) {
          await this.fail(current.id, data.organizationId, 'PREVENTION_REPORT_INDEX_FAILED', 'GROUPS', leaseOwner);
          return 'FAILED';
        }
        await this.enqueueRecovery(run.id, data.organizationId, 30_000);
        return 'WAITING_GROUP_INDEX';
      }
      if (!this.budget) throw new Error('Prevention budget service unavailable');
      await this.renewLease(organizationId, recoveryId, leaseOwner);
      const currentRawSourceVersion = await loadPreventionBudgetRawSourceVersion(this.db, data.organizationId);
      if (current.rawSourceVersion && current.rawSourceVersion !== currentRawSourceVersion) {
        await this.fail(current.id, data.organizationId, 'PREVENTION_SOURCE_CHANGED_RECONFIRM', 'GROUPS', leaseOwner);
        return 'FAILED';
      }
      // Group processing may legitimately enrich derived action metadata. Once
      // it is quiescent, publish a fresh full source snapshot for the global
      // budget. Read the raw fingerprint twice so a concurrent source edit is
      // not silently folded into the snapshot between these reads.
      const { currentSourceVersion, finalRawSourceVersion } = await this.withLease(organizationId, recoveryId, leaseOwner, async () => ({
        currentSourceVersion: await loadPreventionBudgetSourceVersion(this.db, data.organizationId),
        finalRawSourceVersion: await loadPreventionBudgetRawSourceVersion(this.db, data.organizationId),
      }));
      await this.renewLease(organizationId, recoveryId, leaseOwner);
      if (currentRawSourceVersion !== finalRawSourceVersion) {
        await this.fail(current.id, data.organizationId, 'PREVENTION_SOURCE_CHANGED_RECONFIRM', 'GROUPS', leaseOwner);
        return 'FAILED';
      }
      await this.fencedUpdate(recoveryId, organizationId, leaseOwner, 'sourceVersion=?', [currentSourceVersion], 'GROUPS');
      await this.renewLease(organizationId, recoveryId, leaseOwner);
      const budgetPreview = await this.preview(data.organizationId);
      if (budgetPreview.hardRejected) {
        await this.fail(current.id, data.organizationId, 'BUDGET_VOLUME_EXCEEDS_HARD_CEILING', 'BUDGET', leaseOwner, 'GROUPS');
        return 'FAILED';
      }
      const budgetExecutionMode = current.executionMode === 'IMMEDIATE' && budgetPreview.immediateAllowed ? 'IMMEDIATE' : 'SCHEDULED';
      if (budgetExecutionMode !== current.executionMode) {
        await this.fencedUpdate(recoveryId, organizationId, leaseOwner, `executionMode='SCHEDULED',scheduledFor=?`, [budgetPreview.scheduledFor ?? nextPreventionBulkWindowStart(new Date(), this.bulkConfiguration).toISOString()], 'GROUPS');
      }
      let budgetRun: { runId: string; status: string };
      try {
        await this.renewLease(organizationId, recoveryId, leaseOwner);
        budgetRun = await this.withLease(organizationId, recoveryId, leaseOwner,
          () => this.budget!.ensureGlobalYearlyRun(data.organizationId!, budgetExecutionMode));
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        if (/hard ceiling|source changed/i.test(message)) {
          await this.fail(current.id, data.organizationId, message, 'BUDGET', leaseOwner, 'GROUPS');
          return 'FAILED';
        }
        throw error;
      }
      await this.fencedUpdate(recoveryId, organizationId, leaseOwner, `stage='BUDGET',budgetRunId=?`, [budgetRun.runId], 'GROUPS');
      this.logStage(organizationId, recoveryId, 'BUDGET', 'PROCESSING');
    }
    const [latest] = await this.db.query('SELECT * FROM prevention_hyper_admin_recovery_runs WHERE id=? AND organizationId=? LIMIT 1', [recoveryId, organizationId]);
    if (latest?.stage === 'BUDGET') {
      const [budget] = await this.db.query('SELECT status,lastError FROM prevention_budget_global_runs WHERE id=? AND organizationId=? LIMIT 1', [latest.budgetRunId, data.organizationId]);
      if (!budget || budget.status === 'FAILED') { await this.fail(latest.id, data.organizationId, budget?.lastError ?? 'BUDGET_FAILED', 'BUDGET', leaseOwner); return 'FAILED'; }
      if (budget.status !== 'PUBLISHED') { await this.enqueueRecovery(latest.id, data.organizationId, 30_000); return 'WAITING_BUDGET'; }
      await this.fencedUpdate(recoveryId, organizationId, leaseOwner, `stage='COMPLETED',status='COMPLETED'`, [], 'BUDGET');
      this.logStage(organizationId, recoveryId, 'COMPLETED', 'COMPLETED');
      return 'COMPLETED';
    }
    await this.enqueueRecovery(run.id, data.organizationId, 1_000);
    return 'CONTINUED';
  }

  private async noteError(id: string, organizationId: string, error: string): Promise<void> {
    await this.db.query(`UPDATE prevention_hyper_admin_recovery_runs SET lastError=? WHERE id=? AND organizationId=? AND status NOT IN ('COMPLETED','FAILED')`, [error.slice(0, 1000), id, organizationId]);
  }

  private async fail(id: string, organizationId: string, error: string, failedStage: 'EXTRACTION' | 'GROUPS' | 'BUDGET', leaseOwner?: string, expectedStage?: 'EXTRACTION' | 'GROUPS' | 'BUDGET'): Promise<void> {
    if (leaseOwner) {
      await this.fencedUpdate(id, organizationId, leaseOwner, `stage='FAILED',failedStage=?,status='FAILED',lastError=?`, [failedStage, error.slice(0, 1000)], expectedStage ?? failedStage);
    } else {
      await this.db.query(`UPDATE prevention_hyper_admin_recovery_runs SET stage='FAILED',failedStage=?,status='FAILED',lastError=? WHERE id=? AND organizationId=?`, [failedStage, error.slice(0, 1000), id, organizationId]);
    }
    this.logger.error({
      message: 'PREVENTION_RECOVERY_FAILED',
      event: 'PREVENTION_RECOVERY_FAILED',
      organizationId,
      recoveryRunId: id,
      failedStage,
      ...preventionFailureDiagnostic(error),
    } as any);
  }

  private async enqueueRecovery(recoveryId: string, organizationId: string, delayMs: number, bootstrap = false, scheduledFor?: string | null): Promise<void> {
    const now = Date.now();
    const resumeKey = delayMs > 0
      ? `scheduled-${digest(String(scheduledFor ?? now + delayMs)).slice(0, 16)}`
      : `due-${Math.floor(now / 60_000)}`;
    await this.queue.add(PREVENTION_HYPER_ADMIN_RECOVERY_JOB, { recoveryId, organizationId }, {
      // Future runs deduplicate until their scheduled window. A due run gets
      // one fresh retry per minute if an earlier attempt ended as LEASED.
      jobId: bootstrap ? `prevention-hyper-recovery-resume-${recoveryId}-${resumeKey}` : `prevention-hyper-recovery-${recoveryId}-${now}`,
      delay: Math.max(0, delayMs), attempts: 4, backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 1000, removeOnFail: 1000,
    });
  }

  async status(organizationId: string, runId?: string, sharedWorker?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertOrganizationId(organizationId);
    const [organization] = await this.db.query('SELECT id,isActive,preventionEnabled FROM organizations WHERE id=? LIMIT 1', [organizationId]);
    if (!organization) throw new NotFoundException('Organisation introuvable');
    const [run] = await this.db.query(
      `SELECT * FROM prevention_hyper_admin_recovery_runs WHERE organizationId=? ${runId ? 'AND id=?' : ''} ORDER BY createdAt DESC LIMIT 1`,
      runId ? [organizationId, runId] : [organizationId],
    );
    if (runId && !run) throw new NotFoundException('Rattrapage introuvable');
    const [activation] = await this.db.query(
      `SELECT r.id runId,r.status runStatus,r.scheduledFor,c.status checkpointStatus,c.processedReports,c.pendingJobs,c.failedJobs,c.scanComplete,c.lastError
       FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id AND c.organizationId=?
       WHERE c.organizationId=? AND r.workKind='ACTIVATION' ORDER BY r.createdAt DESC LIMIT 1`, [organizationId, organizationId],
    );
    const [groups] = await this.db.query(
      `SELECT COUNT(*) total, SUM(processingStatus IN ('PENDING','PROCESSING','RETRY')) pending,
              SUM(processingStatus='READY') ready,SUM(processingStatus='FAILED') failed
       FROM prevention_group_processing_jobs WHERE organizationId=?`, [organizationId],
    );
    const [reconstructedGroups] = run ? await this.db.query(
      `SELECT COUNT(*) total,SUM(processingStatus='READY') ready,SUM(processingStatus='FAILED') failed
       FROM prevention_group_processing_jobs WHERE organizationId=? AND recoveryRunId=?`, [organizationId, run.id],
    ) : [null];
    const [extraction] = run?.extractionRunId ? await this.db.query(
      `SELECT c.status checkpointStatus,c.processedReports,c.pendingJobs,c.failedJobs,c.scanComplete
       FROM prevention_scheduler_checkpoints c
       WHERE c.runId=? AND c.organizationId=? LIMIT 1`, [run.extractionRunId, organizationId],
    ) : [null];
    const budget = run?.budgetRunId && this.budget ? await this.budget.globalRunStatus(organizationId, run.budgetRunId) : null;
    const [publishedBudget] = run?.budgetRunId ? await this.db.query(
      `SELECT s.totalBudgetHt FROM prevention_budget_global_runs g
       JOIN prevention_budget_scenarios s ON s.id=g.finalScenarioId AND s.organizationId=g.organizationId
       WHERE g.id=? AND g.organizationId=? LIMIT 1`, [run.budgetRunId, organizationId]) : [null];
    const failedStage = run?.stage === 'FAILED' ? String(run.failedStage ?? '') : '';
    const extractionStatus = run?.stage === 'FAILED'
      ? (failedStage === 'EXTRACTION' ? 'FAILED' : 'SKIPPED')
      : run?.stage === 'EXTRACTION' ? (extraction?.checkpointStatus ?? run.status) : run ? 'COMPLETED' : null;
    const groupsStatus = run?.stage === 'FAILED'
      ? (failedStage === 'GROUPS' ? 'FAILED' : 'SKIPPED')
      : run?.stage === 'GROUPS' ? (Number(reconstructedGroups?.failed ?? 0) ? 'FAILED' : 'PROCESSING')
        : run?.stage === 'EXTRACTION' ? 'PENDING' : run ? 'COMPLETED' : null;
    const budgetStatus = run?.stage === 'FAILED'
      ? (failedStage === 'BUDGET' ? 'FAILED' : 'SKIPPED')
      : run?.stage === 'BUDGET' ? (budget?.status ?? 'PROCESSING') : run?.stage === 'COMPLETED' ? 'COMPLETED' : run ? 'PENDING' : null;
    return {
      organizationId,
      organization: { isActive: Number(organization.isActive) === 1, preventionEnabled: Number(organization.preventionEnabled) === 1, paused: Number(organization.isActive) !== 1 || Number(organization.preventionEnabled) !== 1 },
      effectiveStatus: Number(organization.isActive) !== 1 || Number(organization.preventionEnabled) !== 1
        ? 'PAUSED_DISABLED' : (run?.status ?? 'IDLE'),
      latestRun: run ? {
        id: run.id, status: run.status, stage: run.stage, executionMode: run.executionMode,
        scheduledFor: run.scheduledFor ?? null, extractionRunId: run.extractionRunId ?? null,
        budgetRunId: run.budgetRunId ?? null, sourceVersion: run.sourceVersion ?? null,
        reportCount: Number(run.reportCount), findingCount: Number(run.findingCount),
        steps: [
          { kind: 'EXTRACTION', status: extractionStatus, total: Number(run.reportCount), processed: Number(extraction?.processedReports ?? 0), pending: Number(extraction?.pendingJobs ?? 0), failed: Number(extraction?.failedJobs ?? 0) },
          { kind: 'GROUPS', status: groupsStatus, total: Number(run.expectedGroupCount ?? 0), processed: Number(reconstructedGroups?.ready ?? 0), failed: Number(reconstructedGroups?.failed ?? 0) },
          { kind: 'BUDGET', status: budgetStatus, totalHt: publishedBudget?.totalBudgetHt ?? null, error: run.lastError ?? null },
        ],
        error: run.lastError ?? null,
      } : null,
      activationScan: activation ?? null,
      groups: { total: Number(groups?.total ?? 0), pending: Number(groups?.pending ?? 0), ready: Number(groups?.ready ?? 0), failed: Number(groups?.failed ?? 0) },
      worker: sharedWorker ?? await this.workerHealth(),
    };
  }

  async statuses(organizationIds: string[]): Promise<Record<string, unknown>[]> {
    const worker = await this.workerHealth();
    // The organizations screen polls this endpoint for every card. Do not
    // turn that poll into one rich status query per tenant: fetch the bounded
    // card summary in batches and reserve `status()` for the detail modal.
    const ids = [...new Set(organizationIds.filter((id) => UUID_PATTERN.test(id)))];
    if (!ids.length) return [];
    const results: Record<string, unknown>[] = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      results.push(...await this.statusesBatch(ids.slice(offset, offset + 500), worker));
    }
    const resultByOrganization = new Map(results.map((result) => [String(result.organizationId), result]));
    return ids.map((id) => resultByOrganization.get(id)).filter((result): result is Record<string, unknown> => Boolean(result));
  }

  private async statusesBatch(ids: string[], worker: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const placeholders = ids.map(() => '?').join(',');
    const [organizations, runs, activations, groups] = await Promise.all([
      this.db.query(
        `SELECT id,isActive,preventionEnabled FROM organizations WHERE id IN (${placeholders})`,
        ids,
      ),
      this.db.query(
        `SELECT r.*,c.status checkpointStatus,c.processedReports,c.pendingJobs,c.failedJobs,c.scanComplete,
                bg.status budgetStatus,bs.totalBudgetHt
         FROM prevention_hyper_admin_recovery_runs r
         LEFT JOIN prevention_scheduler_checkpoints c ON c.runId=r.extractionRunId AND c.organizationId=r.organizationId
         LEFT JOIN prevention_budget_global_runs bg ON bg.id=r.budgetRunId AND bg.organizationId=r.organizationId
         LEFT JOIN prevention_budget_scenarios bs ON bs.id=bg.finalScenarioId AND bs.organizationId=bg.organizationId
         WHERE r.organizationId IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1 FROM prevention_hyper_admin_recovery_runs newer
             WHERE newer.organizationId=r.organizationId
               AND (newer.createdAt>r.createdAt OR (newer.createdAt=r.createdAt AND newer.id>r.id))
           )`,
        ids,
      ),
      this.db.query(
        `SELECT r.id runId,c.organizationId,r.status runStatus,r.scheduledFor,
                c.status checkpointStatus,c.processedReports,c.pendingJobs,c.failedJobs,c.scanComplete,c.lastError
         FROM prevention_scheduler_runs r
         JOIN prevention_scheduler_checkpoints c ON c.runId=r.id
         WHERE r.workKind='ACTIVATION' AND c.organizationId IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1 FROM prevention_scheduler_runs newer
             JOIN prevention_scheduler_checkpoints newerCheckpoint
               ON newerCheckpoint.runId=newer.id
             WHERE newerCheckpoint.organizationId=c.organizationId AND newer.workKind='ACTIVATION'
               AND (newer.createdAt>r.createdAt OR (newer.createdAt=r.createdAt AND newer.id>r.id))
           )`,
        ids,
      ),
      this.db.query(
        `SELECT organizationId,recoveryRunId,COUNT(*) total,
                SUM(processingStatus IN ('PENDING','PROCESSING','RETRY')) pending,
                SUM(processingStatus='READY') ready,SUM(processingStatus='FAILED') failed
         FROM prevention_group_processing_jobs
         WHERE organizationId IN (${placeholders}) GROUP BY organizationId,recoveryRunId`,
        ids,
      ),
    ]);
    const byId = <T extends Record<string, unknown>>(rows: T[]): Map<string, T> =>
      new Map(rows.map((row) => [String(row.organizationId ?? row.id), row]));
    const runByOrg = byId(runs);
    const activationByOrg = byId(activations);
    const groupByOrg = new Map<string, { total: number; pending: number; ready: number; failed: number }>();
    const groupByRun = new Map<string, Record<string, unknown>>();
    for (const group of groups as Array<Record<string, unknown>>) {
      const organizationId = String(group.organizationId);
      const combined = groupByOrg.get(organizationId) ?? { total: 0, pending: 0, ready: 0, failed: 0 };
      combined.total += Number(group.total ?? 0);
      combined.pending += Number(group.pending ?? 0);
      combined.ready += Number(group.ready ?? 0);
      combined.failed += Number(group.failed ?? 0);
      groupByOrg.set(organizationId, combined);
      if (group.recoveryRunId) groupByRun.set(`${organizationId}|${String(group.recoveryRunId)}`, group);
    }
    return (organizations as Array<Record<string, unknown>>).map((organization) => {
      const organizationId = String(organization.id);
      const run = runByOrg.get(organizationId);
      const activation = activationByOrg.get(organizationId) ?? null;
      const group = groupByOrg.get(organizationId) ?? { total: 0, pending: 0, ready: 0, failed: 0 };
      const reconstructedGroup = run ? (groupByRun.get(`${organizationId}|${String(run.id)}`) ?? {}) : {};
      const paused = Number(organization.isActive) !== 1 || Number(organization.preventionEnabled) !== 1;
      const failedStage = run?.stage === 'FAILED' ? String(run.failedStage ?? '') : '';
      const extractionStatus = run
        ? run.stage === 'FAILED' ? (failedStage === 'EXTRACTION' ? 'FAILED' : 'SKIPPED')
          : (run.stage === 'EXTRACTION' ? (run.checkpointStatus ?? run.status) : 'COMPLETED')
        : null;
      const groupsStatus = run
        ? run.stage === 'FAILED' ? (failedStage === 'GROUPS' ? 'FAILED' : 'SKIPPED')
          : (run.stage === 'GROUPS' ? (Number(reconstructedGroup.failed ?? 0) ? 'FAILED' : 'PROCESSING')
            : run.stage === 'EXTRACTION' ? 'PENDING' : 'COMPLETED')
        : null;
      const budgetStatus = run
        ? run.stage === 'FAILED' ? (failedStage === 'BUDGET' ? 'FAILED' : 'SKIPPED')
          : (run.stage === 'BUDGET' ? (run.budgetStatus ?? 'PROCESSING')
            : run.stage === 'COMPLETED' ? 'COMPLETED' : 'PENDING')
        : null;
      return {
        organizationId,
        organization: {
          isActive: Number(organization.isActive) === 1,
          preventionEnabled: Number(organization.preventionEnabled) === 1,
          paused,
        },
        effectiveStatus: paused ? 'PAUSED_DISABLED' : (run?.status ?? 'IDLE'),
        latestRun: run ? {
          id: run.id,
          status: run.status,
          stage: run.stage,
          executionMode: run.executionMode,
          scheduledFor: run.scheduledFor ?? null,
          extractionRunId: run.extractionRunId ?? null,
          budgetRunId: run.budgetRunId ?? null,
          reportCount: Number(run.reportCount ?? 0),
          findingCount: Number(run.findingCount ?? 0),
          steps: [
            { kind: 'EXTRACTION', status: extractionStatus, total: Number(run.reportCount ?? 0), processed: Number(run.processedReports ?? 0), pending: Number(run.pendingJobs ?? 0), failed: Number(run.failedJobs ?? 0) },
            { kind: 'GROUPS', status: groupsStatus, total: Number(run.expectedGroupCount ?? 0), processed: Number(reconstructedGroup.ready ?? 0), failed: Number(reconstructedGroup.failed ?? 0) },
            { kind: 'BUDGET', status: budgetStatus, totalHt: run.totalBudgetHt ?? null, error: run.lastError ?? null },
          ],
          error: run.lastError ?? null,
        } : null,
        activationScan: activation,
        groups: { total: Number(group.total ?? 0), pending: Number(group.pending ?? 0), ready: Number(group.ready ?? 0), failed: Number(group.failed ?? 0) },
        worker,
      };
    });
  }
}
