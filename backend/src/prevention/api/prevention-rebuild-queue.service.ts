import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PREVENTION_BULK_QUEUE_NAME } from '../queue/prevention-queue.constants';
import { PREVENTION_MANUAL_REBUILD_JOB } from '../scheduler/prevention-scheduler.types';
import { PreventionActivationService } from '../prevention-activation.service';
import { PreventionBulkAdmissionService } from '../scheduler/prevention-bulk-admission.service';
import { executionModeForVolume, loadPreventionBulkConfiguration, nextPreventionBulkWindowStart, preventionBulkWindowKey, PreventionBulkConfiguration } from '../scheduler/prevention-bulk.config';
import { PreventionBulkExecutionMode } from '../scheduler/prevention-bulk-admission.types';
import { budgetClientIdentity, parseBudgetClientKeys } from '../budget/prevention-budget-client';
import { PreventionRebuildScopeDto } from './prevention-rebuild.dto';

export const MANUAL_JOB_TYPE = 'MANUAL_REBUILD';
const ACTIVE_STATUSES = ['PENDING', 'PROCESSING', 'SCHEDULED'];
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const deterministicId = (value: string): string => { const hash = createHash('sha256').update(value).digest('hex'); return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32); };

export interface PreventionRebuildPreview {
  reportCount: number;
  findingCount: number;
  immediateLimit: number;
  executionMode: PreventionBulkExecutionMode;
  scheduledFor: string | null;
  previewToken: string;
  scopeDigest?: string | null;
  scopeMissionIds?: string[] | null;
  sourceVersion?: string;
}

export interface PreventionRebuildAdmission extends PreventionRebuildPreview {
  id: string;
  status: string;
}

@Injectable()
export class PreventionRebuildQueueService implements OnApplicationShutdown {
  private readonly queue: Queue;
  private readonly cooldownSeconds: number;
  private readonly bulkConfiguration: PreventionBulkConfiguration;
  private readonly previewSecret: string;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
    @Optional() private readonly activation?: PreventionActivationService,
    @Optional() private readonly bulkAdmission?: PreventionBulkAdmissionService,
  ) {
    this.queue = new Queue(PREVENTION_BULK_QUEUE_NAME, {
      connection: createPreventionRedisOptions(config),
    });
    const configuredCooldown = Number(config.get('PREVENTION_REBUILD_COOLDOWN_SECONDS', 3600));
    this.cooldownSeconds = Number.isInteger(configuredCooldown) && configuredCooldown >= 300 && configuredCooldown <= 86400 ? configuredCooldown : 3600;
    this.bulkConfiguration = loadPreventionBulkConfiguration(config);
    this.previewSecret = String(config.get('JWT_SECRET') ?? '');
    if (this.previewSecret.length < 32) throw new Error('JWT_SECRET is required to sign Prevention rebuild previews');
  }

  private signPreview(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.previewSecret).update(`prevention-rebuild-preview-v1|${encoded}`).digest('hex');
    return `${encoded}.${signature}`;
  }

  private verifyPreview(token: string): Record<string, unknown> {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra || !/^[0-9a-f]{64}$/.test(signature)) throw new ConflictException('La prévisualisation de reconstruction est invalide');
    const expected = createHmac('sha256', this.previewSecret).update(`prevention-rebuild-preview-v1|${encoded}`).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ConflictException('La prévisualisation de reconstruction est invalide');
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
    } catch { /* invalid payload */ }
    throw new ConflictException('La prévisualisation de reconstruction est invalide');
  }

  private async resolveScope(organizationId: string, scope: PreventionRebuildScopeDto): Promise<{ digest: string | null; missionIds: string[] | null }> {
    let clientKeys: string[];
    try { clientKeys = parseBudgetClientKeys(scope.clientKeys); }
    catch { throw new BadRequestException('Sélection de clients invalide'); }
    if (!clientKeys.length && !scope.missionId) return { digest: null, missionIds: null };
    const rows: Array<{ id: string; client: string | null }> = await this.dataSource.query(
      'SELECT id,client FROM missions WHERE organizationId=? ORDER BY id LIMIT 10001', [organizationId]);
    if (rows.length > 10000) throw new BadRequestException('Liste des chantiers trop volumineuse');
    const known = new Set(rows.map((row) => budgetClientIdentity(row.client).key));
    if (clientKeys.some((key) => !known.has(key))) throw new BadRequestException('Client introuvable dans l’organisation');
    if (scope.missionId && !rows.some((row) => row.id === scope.missionId)) throw new BadRequestException('Chantier introuvable dans l’organisation');
    const missionIds = rows.filter((row) => (!scope.missionId || row.id === scope.missionId) &&
      (!clientKeys.length || clientKeys.includes(budgetClientIdentity(row.client).key))).map((row) => row.id);
    return { digest: createHash('sha256').update(JSON.stringify([scope.missionId ?? null, clientKeys, missionIds])).digest('hex'), missionIds };
  }

  async preview(organizationId: string, scope: PreventionRebuildScopeDto = {}): Promise<PreventionRebuildPreview> {
    if (this.activation) await this.activation.assertEnabled(organizationId);
    if (!UUID_PATTERN.test(organizationId)) throw new ConflictException('Organisation invalide');
    const selected = await this.resolveScope(organizationId, scope);
    const scopedSql = selected.missionIds === null ? '' : selected.missionIds.length ? ' AND v.missionId IN (?)' : ' AND 1=0';
    const findingSql = selected.missionIds === null ? '' : selected.missionIds.length ? ' AND f.missionId IN (?)' : ' AND 1=0';
    const reportArgs = selected.missionIds?.length ? [selected.missionIds] : [];
    const rows: Array<{ reportCount: number | string; findingCount: number | string }> = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(DISTINCT r.id) FROM reports r
          INNER JOIN visits v ON v.id=r.visitId AND v.organizationId=?
          WHERE r.organizationId=?${scopedSql}) reportCount,
         (SELECT COUNT(*) FROM prevention_findings f WHERE f.organizationId=?${findingSql}) findingCount`,
      [organizationId, organizationId, ...reportArgs, organizationId, ...reportArgs],
    );
    const measured = rows?.[0] ?? { reportCount: 0, findingCount: 0 };
    const reportCount = Number(measured.reportCount ?? 0);
    const findingCount = Number(measured.findingCount ?? 0);
    if (!Number.isSafeInteger(reportCount) || reportCount < 0 || !Number.isSafeInteger(findingCount) || findingCount < 0) {
      throw new Error('Invalid Prevention reconstruction volume');
    }
    const sources: Array<{ id: string; reportUpdatedAt: Date; visitUpdatedAt: Date; photosHash: string }> = await this.dataSource.query(
      `SELECT r.id,r.updatedAt reportUpdatedAt,v.updatedAt visitUpdatedAt,
              SHA2(COALESCE(CAST(v.photos AS CHAR),''),256) photosHash
       FROM reports r JOIN visits v ON v.id=r.visitId AND v.organizationId=r.organizationId
       WHERE r.organizationId=?${scopedSql} ORDER BY r.id LIMIT 10001`,
      [organizationId, ...reportArgs],
    );
    if (sources.length > 10000) throw new BadRequestException('Trop de rapports pour une reconstruction');
    const sourceVersion = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
    const executionMode = executionModeForVolume(reportCount, findingCount, this.bulkConfiguration);
    const scheduledFor = executionMode === 'SCHEDULED'
      ? nextPreventionBulkWindowStart(new Date(), this.bulkConfiguration).toISOString()
      : null;
    const previewToken = this.signPreview({ organizationId, reportCount, findingCount, executionMode, scheduledFor,
      scopeDigest: selected.digest, sourceVersion,
      windowKey: scheduledFor ? preventionBulkWindowKey(new Date(scheduledFor), this.bulkConfiguration) : null, issuedAt: Date.now() });
    const result: PreventionRebuildPreview = { reportCount, findingCount, immediateLimit: this.bulkConfiguration.immediateRebuildCeiling, executionMode, scheduledFor, previewToken, scopeDigest: selected.digest };
    Object.defineProperty(result, 'scopeMissionIds', { value: selected.missionIds, enumerable: false });
    Object.defineProperty(result, 'sourceVersion', { value: sourceVersion, enumerable: false });
    return result;
  }

  async admit(organizationId: string, previewToken?: string, scope: PreventionRebuildScopeDto = {}): Promise<PreventionRebuildAdmission> {
    if (!previewToken) throw new BadRequestException('Une prévisualisation est requise avant la confirmation');
    if (previewToken.length > 2048) throw new ConflictException('La prévisualisation de reconstruction est invalide');
    const measured = await this.preview(organizationId, scope);
    {
      const supplied = this.verifyPreview(previewToken);
      const issuedAt = Number(supplied.issuedAt);
      if (supplied.organizationId !== organizationId || supplied.reportCount !== measured.reportCount ||
          supplied.findingCount !== measured.findingCount || supplied.executionMode !== measured.executionMode || supplied.scopeDigest !== measured.scopeDigest ||
          supplied.sourceVersion !== measured.sourceVersion ||
          (measured.scheduledFor && supplied.windowKey !== preventionBulkWindowKey(new Date(measured.scheduledFor), this.bulkConfiguration)) ||
          (!measured.scheduledFor && supplied.windowKey !== null) || !Number.isSafeInteger(issuedAt) ||
          issuedAt > Date.now() + 5_000 || Date.now() - issuedAt > 15 * 60_000) {
        throw new ConflictException({ message: 'Le volume de reconstruction a changé, veuillez actualiser la prévisualisation', preview: measured });
      }
    }
    const result = await this.enqueueMeasured(organizationId, measured);
    return { ...measured, ...result };
  }

  async enqueue(organizationId: string, previewToken?: string): Promise<{ id: string; status: string }> {
    // Kept for existing internal callers. HTTP confirmation must use admit(),
    // which requires a preview token and performs the freshness check.
    if (previewToken) {
      const result = await this.admit(organizationId, previewToken);
      return { id: result.id, status: result.status };
    }
    const measured = await this.preview(organizationId);
    return this.enqueueMeasured(organizationId, measured);
  }

  /** Internal Hyper Admin path. The caller has already applied the tenant and
   * volume checks; this keeps the scheduled/immediate choice server-side. */
  async enqueueForMode(organizationId: string, executionMode: PreventionBulkExecutionMode): Promise<{ id: string; status: string }> {
    const measured = await this.preview(organizationId);
    if (executionMode === 'IMMEDIATE' && measured.executionMode !== 'IMMEDIATE') {
      throw new ConflictException('Le volume de reconstruction dépasse le plafond immédiat');
    }
    if (executionMode === 'SCHEDULED') {
      measured.executionMode = 'SCHEDULED';
      measured.scheduledFor = nextPreventionBulkWindowStart(new Date(), this.bulkConfiguration).toISOString();
    }
    return this.enqueueMeasured(organizationId, measured);
  }

  private async enqueueMeasured(organizationId: string, measured: PreventionRebuildPreview): Promise<{ id: string; status: string }> {
    const runId = deterministicId(MANUAL_JOB_TYPE + "|" + organizationId + "|" + Math.floor(Date.now() / 300000));
    // The run table is intentionally global in P6. Tenant ownership is kept in
    // the manual job payload and checkpoint; the API only returns this opaque id.
    // Use a recent active checkpoint to deduplicate per tenant.
    const [tenantExisting] = await this.dataSource.query(
      `SELECT r.id,r.status,r.scheduledFor,c.scopeDigest FROM prevention_scheduler_runs r
       JOIN prevention_scheduler_checkpoints c ON c.runId=r.id
       WHERE r.jobType=? AND c.organizationId=? AND r.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
       ORDER BY r.createdAt DESC LIMIT 1`,
      [MANUAL_JOB_TYPE, organizationId, ...ACTIVE_STATUSES],
    );
    if (tenantExisting && ACTIVE_STATUSES.includes(String(tenantExisting.status))) {
      if ((tenantExisting.scopeDigest ?? null) !== (measured.scopeDigest ?? null)) throw new ConflictException('Une reconstruction d’un autre périmètre est déjà en cours');
      await this.enqueueRun(
        organizationId,
        tenantExisting.id,
        new Date(tenantExisting.scheduledFor).toISOString(),
        measured.executionMode,
      );
      return { id: tenantExisting.id, status: tenantExisting.status };
    }
    const [recent] = await this.dataSource.query(
      "SELECT r.id,r.status,TIMESTAMPDIFF(SECOND,r.createdAt,CURRENT_TIMESTAMP()) ageSeconds FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id WHERE r.jobType=? AND c.organizationId=? AND r.createdAt>DATE_SUB(CURRENT_TIMESTAMP(),INTERVAL ? SECOND) ORDER BY r.createdAt DESC LIMIT 1",
      [MANUAL_JOB_TYPE, organizationId, this.cooldownSeconds],
    );
    if (recent) throw new HttpException({ message: "Une reconstruction a déjà été demandée récemment", retryAfterSeconds: Math.max(1, this.cooldownSeconds - Number(recent.ageSeconds ?? 0)), jobId: recent.id }, HttpStatus.TOO_MANY_REQUESTS);

    const scheduledFor = measured.scheduledFor ?? new Date().toISOString();
    const status = measured.executionMode === 'SCHEDULED' ? 'SCHEDULED' : 'PROCESSING';
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        "INSERT IGNORE INTO prevention_scheduler_runs (id,jobType,scheduledFor,status,availableAt,dispatchComplete,reportCount,findingCount,immediateLimit,executionMode,workKind) VALUES (?,?,?, ?,UTC_TIMESTAMP(6),1,?,?,?,?,?)",
        [runId, MANUAL_JOB_TYPE, scheduledFor, status, measured.reportCount, measured.findingCount, measured.immediateLimit, measured.executionMode, 'ADMIN_RECONSTRUCTION'],
      );
      await manager.query(
        "INSERT IGNORE INTO prevention_scheduler_checkpoints (id,runId,organizationId,status,processedReports,scanComplete,availableAt,scopeDigest,scopeMissionIds) VALUES (?,?,?,'PENDING',0,0,UTC_TIMESTAMP(6),?,?)",
        [deterministicId(runId + "|" + organizationId), runId, organizationId, measured.scopeDigest ?? null,
          measured.scopeMissionIds === null || measured.scopeMissionIds === undefined ? null : JSON.stringify(measured.scopeMissionIds)],
      );
    });
    const [current] = await this.dataSource.query(
      "SELECT r.id,r.status,c.scopeDigest FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id WHERE r.id=? AND c.organizationId=? AND r.jobType=? LIMIT 1",
      [runId, organizationId, MANUAL_JOB_TYPE],
    );
    if (current && (current.scopeDigest ?? null) !== (measured.scopeDigest ?? null)) {
      throw new ConflictException('Une reconstruction d’un autre périmètre est déjà en cours');
    }
    if (!current || !['PROCESSING', 'SCHEDULED'].includes(current.status)) return current ?? { id: runId, status: "FAILED" };
    try {
      await this.enqueueRun(organizationId, runId, scheduledFor, measured.executionMode);
    } catch (error) {
      await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET status='FAILED',lastError=? WHERE id=?`,
        ['QUEUE_ENQUEUE_FAILED', runId],
      );
      throw error;
    }
    return { id: runId, status };
  }

  private async enqueueRun(organizationId: string, runId: string, scheduledFor: string, executionMode: PreventionBulkExecutionMode): Promise<void> {
    const jobId = `prevention-manual-rebuild-${createHash('sha256').update(`${organizationId}|${runId}`).digest('hex')}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') await existing.remove();
      else return;
    }
    await this.queue.add(PREVENTION_MANUAL_REBUILD_JOB, { organizationId, runId, scheduledFor }, {
      jobId, attempts: 4, backoff: { type: 'exponential', delay: 60_000 },
      ...(executionMode === 'SCHEDULED' ? { delay: Math.max(0, Date.parse(scheduledFor) - Date.now()) } : {}),
      removeOnComplete: 1000, removeOnFail: 1000,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
