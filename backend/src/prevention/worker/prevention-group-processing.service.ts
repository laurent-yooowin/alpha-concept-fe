import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Queue, UnrecoverableError } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { isPreventionConstructionPhase } from '../prevention-phase';
import { PREVENTION_GROUP_QUEUE } from '../queue/prevention-queue.constants';
import { PreventionGroupLlmTimeoutError, PreventionOnlyAiService, PreventionOnlyInput, PreventionOnlyResult } from '../ai/prevention-only-ai.service';
import { PreventionExtractionService } from '../extraction/prevention-extraction.service';
import { PreventionActivationService } from '../prevention-activation.service';
import { PreventionOutboxService } from '../outbox/prevention-outbox.service';
import { buildPreventionGroupInput, preventionEntryGroupId, preventionGroupSourceHash, PreventionGroupEntry } from './prevention-group-source';
import { normalizePreventionList } from '../extraction/prevention-text-normalizer';
import { parseRecommendationOverrides, recommendationTextHash } from '../prevention-recommendation-override';
import { isPreventionActionType, UNCLASSIFIED_ACTION_TYPE } from '../prevention-action-types';
import { preventionFailureDiagnostic } from './prevention-log-error';

export const PREVENTION_GROUP_JOB = 'prevention.group.evaluate';
export const PREVENTION_RECOMMENDATION_JOB = 'prevention.recommendation.assess';
const MAX_ATTEMPTS = 5;
const MAX_VISIT_ENTRIES = 500;
const MAX_VISIT_GROUPS = 100;
const MAX_GROUP_ENTRIES = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PreventionGroupJobPayload {
  organizationId: string;
  visitId: string;
  sourceGroupId: string;
  sourceHash: string;
}

export interface PreventionRecommendationJobPayload {
  organizationId: string;
  visitId: string;
  sourceGroupId: string;
  recommendationHash: string;
  recoveryMode?: 'SCHEDULED_MISSING_TYPES' | 'IMMEDIATE_MISSING_TYPES';
  classificationLimit?: number;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parsed(value: unknown): any {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value && typeof value === 'object' ? value : null;
}

function eligibleVisitGroups(value: unknown): Map<string, PreventionGroupEntry[]> {
  const photos = parsed(value);
  const groups = new Map<string, PreventionGroupEntry[]>();
  if (!Array.isArray(photos)) return groups;
  if (photos.length > MAX_VISIT_ENTRIES) throw new Error('Prevention visit has too many entries to stage');
  photos.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const entry = raw as PreventionGroupEntry;
    const id = preventionEntryGroupId(entry, index);
    const current = groups.get(id) ?? [];
    if (current.length >= MAX_GROUP_ENTRIES) throw new Error('Prevention group has too many entries to stage');
    current.push(entry);
    groups.set(id, current);
    if (groups.size > MAX_VISIT_GROUPS) throw new Error('Prevention visit has too many groups to stage');
  });
  for (const [id, entries] of groups) {
    if (!entries.some((entry) => entry.analysis && typeof entry.analysis === 'object' && !Array.isArray(entry.analysis))) groups.delete(id);
    else if (id.length > 100) throw new Error(`Prevention group identifier exceeds 100 characters`);
  }
  return groups;
}

function currentRecommendationTexts(photos: unknown[], sourceGroupId: string): string[] {
  const entries = photos.filter((entry: any, index: number) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
    preventionEntryGroupId(entry, index) === sourceGroupId) as PreventionGroupEntry[];
  if (!entries.length || entries.length > MAX_GROUP_ENTRIES) return [];
  const analysis = entries.find((entry) => entry.analysis)?.analysis;
  return normalizePreventionList(analysis?.recommendation ?? analysis?.recommendations);
}

function originalRecommendationTexts(sourcePayload: unknown): string[] {
  const entries = parsed(sourcePayload)?.entries;
  if (!Array.isArray(entries)) return [];
  const reference = entries.find((entry: any) => Array.isArray(entry?.recommendationTexts));
  return reference ? normalizePreventionList(reference.recommendationTexts) : [];
}

function pendingRecommendations(texts: string[], sourcePayload: unknown, riskAssessments: unknown, overrides: unknown,
  recoverMissingTypes: boolean, classificationOnly = false): {
  classify: Array<{ index: number; text: string }>; classifyEdited: string[]; assess: string[];
} {
  const originalTexts = originalRecommendationTexts(sourcePayload);
  const original = new Set(originalTexts);
  const persisted = parsed(riskAssessments)?.recommendations;
  const current = new Set(texts);
  const classify = originalTexts.flatMap((text, index) => recoverMissingTypes && current.has(text) &&
    (!Array.isArray(persisted) || !isPreventionActionType(persisted[index]?.actionType) ||
      persisted[index]?.actionType === UNCLASSIFIED_ACTION_TYPE) ? [{ index, text }] : []);
  const assessed = parseRecommendationOverrides(overrides);
  const classifyEdited = classificationOnly ? [...new Set(texts.filter((text) => !original.has(text) &&
    assessed[recommendationTextHash(text)]?.actionType === UNCLASSIFIED_ACTION_TYPE))] : [];
  const assess = classificationOnly ? [] : [...new Set(texts.filter((text) => {
    const overrideType = assessed[recommendationTextHash(text)]?.actionType;
    if (isPreventionActionType(overrideType) && overrideType !== UNCLASSIFIED_ACTION_TYPE) return false;
    return !original.has(text);
  }))];
  return { classify, classifyEdited, assess };
}

@Injectable()
export class PreventionGroupProcessingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreventionGroupProcessingService.name);
  private timer: NodeJS.Timeout | null = null;

  private async enabledForUpdate(manager: { query(sql: string, parameters?: any[]): Promise<any[]> }, organizationId: string): Promise<boolean> {
    const [organization] = await manager.query(
      'SELECT isActive,preventionEnabled FROM organizations WHERE id=? LIMIT 1 FOR UPDATE',
      [organizationId],
    );
    return Number(organization?.isActive) === 1 && Number(organization?.preventionEnabled) === 1;
  }

  constructor(
    private readonly db: DataSource,
    @Optional() @Inject(PREVENTION_GROUP_QUEUE) private readonly queue?: Queue,
    @Optional() private readonly extraction?: PreventionExtractionService,
    @Optional() private readonly activation?: PreventionActivationService,
    @Optional() private readonly outbox?: PreventionOutboxService,
  ) {}

  onModuleInit(): void {
    // The HTTP application acts as a small durable dispatcher. The worker owns
    // execution; a deterministic job id makes this safe across restarts.
    if (!this.queue) return;
    void this.enqueueDue().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.enqueueDue().catch(() => undefined);
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Called only after an explicit SPS AI analysis has been saved. */
  async scheduleExplicitGroup(organizationId: string, visitId: string, sourceGroupId: string): Promise<{ status: string; changed: boolean }> {
    if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(visitId) || !sourceGroupId || sourceGroupId.length > 100) {
      throw new Error('Invalid Prevention group identifiers');
    }
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return { status: 'DISABLED', changed: false };
    const [visit] = await this.db.query(
      'SELECT missionId,photos FROM visits WHERE organizationId=? AND id=? LIMIT 1', [organizationId, visitId],
    );
    if (!visit) throw new Error('Prevention visit not found');
    let photos: unknown = visit.photos;
    if (typeof photos === 'string') { try { photos = JSON.parse(photos); } catch { photos = null; } }
    if (!Array.isArray(photos) || photos.length > MAX_VISIT_ENTRIES) throw new Error('Invalid or oversized Prevention visit photos');
    const entries = photos.filter((raw, index) => raw && typeof raw === 'object' && !Array.isArray(raw) &&
      preventionEntryGroupId(raw as PreventionGroupEntry, index) === sourceGroupId) as PreventionGroupEntry[];
    if (!entries.length || entries.length > MAX_GROUP_ENTRIES ||
      !entries.some((entry) => entry.analysis && typeof entry.analysis === 'object' && !Array.isArray(entry.analysis))) {
      throw new Error('Prevention group analysis not found or oversized');
    }
    const staged = await this.upsertGroup(organizationId, visitId, visit.missionId, sourceGroupId, entries, true);
    await this.enqueueDue();
    return staged;
  }

  /**
   * Stage a group while the SPS visit transaction is still open. The caller
   * must enqueueDue only after its transaction commits. This is deliberately
   * separate from scheduleExplicitGroup: the latter is the legacy/backfill
   * command and must never be part of the SPS write transaction.
   */
  async stageExplicitGroupInTransaction(
    manager: { query(sql: string, parameters?: any[]): Promise<any[]> },
    organizationId: string,
    visitId: string,
    missionId: string,
    sourceGroupId: string,
    entries: PreventionGroupEntry[],
  ): Promise<{ status: string; changed: boolean }> {
    if (this.activation && !(await this.enabledForUpdate(manager, organizationId))) {
      return { status: 'DISABLED', changed: false };
    }
    const { sourceKind, input } = buildPreventionGroupInput(entries);
    const sourceHash = preventionGroupSourceHash(sourceGroupId, entries);
    const [existing] = await manager.query(
      `SELECT id,sourceHash,processingStatus,phaseStatus,effectivePhase
       FROM prevention_group_processing_jobs
       WHERE organizationId=? AND visitId=? AND sourceGroupId=? LIMIT 1 FOR UPDATE`,
      [organizationId, visitId, sourceGroupId],
    );
    if (existing && existing.sourceHash === sourceHash && existing.processingStatus !== 'FAILED') {
      return { status: existing.processingStatus, changed: false };
    }
    const phaseStatus = existing?.phaseStatus === 'VALIDATED' ? 'VALIDATED' : 'PROPOSED';
    const effectivePhase = phaseStatus === 'VALIDATED' ? existing.effectivePhase : null;
    if (existing) {
      await manager.query(
        `UPDATE prevention_group_processing_jobs
         SET missionId=?,sourceKind=?,processingStatus='PENDING',phaseStatus=?,proposedPhase=NULL,effectivePhase=?,confidence=NULL,justification=NULL,riskAssessments=NULL,sourcePayload=?,sourceHash=?,recoveryRunId=NULL,attempts=0,availableAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL,lastError=NULL
         WHERE id=? AND organizationId=?`,
        [missionId, sourceKind, phaseStatus, effectivePhase, JSON.stringify(input), sourceHash, existing.id, organizationId],
      );
    } else {
      await manager.query(
        `INSERT INTO prevention_group_processing_jobs
         (id,organizationId,visitId,missionId,sourceGroupId,sourceKind,processingStatus,phaseStatus,proposedPhase,effectivePhase,confidence,justification,riskAssessments,sourcePayload,sourceHash,attempts,availableAt)
         VALUES (?,?,?,?,?,?, 'PENDING', ?, NULL, ?, NULL, NULL, NULL, ?, ?, 0, UTC_TIMESTAMP(6))`,
        [randomUUID(), organizationId, visitId, missionId, sourceGroupId, sourceKind, phaseStatus, effectivePhase, JSON.stringify(input), sourceHash],
      );
    }
    return { status: 'PENDING', changed: true };
  }

  async scheduleForVisit(visit: { id: string; organizationId?: string | null; missionId: string; userId?: string; photos?: unknown }, recoveryRunId?: string): Promise<void> {
    const organizationId = visit.organizationId;
    if (!organizationId || !UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(visit.id)) return;
    if (recoveryRunId && !UUID_PATTERN.test(recoveryRunId)) throw new Error('Invalid Prevention recovery run identifier');
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return;
    const [current] = await this.db.query(
      'SELECT missionId,photos FROM visits WHERE organizationId=? AND id=? LIMIT 1',
      [organizationId, visit.id],
    );
    if (!current) return;
    const groups = eligibleVisitGroups(current.photos);
    for (const [sourceGroupId, entries] of groups) {
      await this.upsertGroup(organizationId, visit.id, current.missionId, sourceGroupId, entries, false, !recoveryRunId, recoveryRunId);
    }
    await this.enqueueDue();
  }

  /** Explicit, bounded operator/admin backfill. Never called by dashboard reads. */
  async backfillOrganization(organizationId: string, limit = 100, cursor?: string, queueOverride?: Queue, recoveryRunId?: string): Promise<{ visits: number; queued: number; nextCursor: string | null }> {
    if (this.activation && !(await this.activation.isEnabled(organizationId))) {
      return { visits: 0, queued: 0, nextCursor: null };
    }
    const visits: Array<{ id: string; organizationId: string; missionId: string; userId: string; photos: unknown }> = await this.db.query(
      `SELECT id,organizationId,missionId,userId,photos FROM visits
       WHERE organizationId=? AND photos IS NOT NULL AND photos LIKE '%"analysis"%' AND (? IS NULL OR id>?)
       ORDER BY id ASC LIMIT ?`, [organizationId, cursor ?? null, cursor ?? null, Math.max(1, Math.min(100, limit))],
    );
    for (const visit of visits) await this.scheduleForVisit(visit, recoveryRunId);
    return { visits: visits.length, queued: await this.enqueueDue(50, queueOverride), nextCursor: visits.length ? visits[visits.length - 1].id : null };
  }

  async countEligibleGroups(organizationId: string, ceiling: number): Promise<number> {
    if (!UUID_PATTERN.test(organizationId) || !Number.isSafeInteger(ceiling) || ceiling < 1) throw new Error('Invalid Prevention group count scope');
    let count = 0;
    let cursor = '';
    for (;;) {
      const visits: Array<{ id: string; photos: unknown }> = await this.db.query(
        `SELECT id,photos FROM visits WHERE organizationId=? AND photos IS NOT NULL AND photos LIKE '%"analysis"%' AND id>?
         ORDER BY id LIMIT 100`, [organizationId, cursor],
      );
      for (const visit of visits) {
        count += eligibleVisitGroups(visit.photos).size;
        if (count > ceiling) return count;
      }
      if (visits.length < 100) return count;
      cursor = visits[visits.length - 1].id;
    }
  }

  private async upsertGroup(organizationId: string, visitId: string, missionId: string, sourceGroupId: string, entries: PreventionGroupEntry[], retryFailed = false, onlyIfMissing = false, recoveryRunId?: string): Promise<{ status: 'PENDING' | 'PROCESSING' | 'RETRY' | 'READY' | 'FAILED' | 'DISABLED'; changed: boolean }> {
    const { sourceKind, input } = buildPreventionGroupInput(entries);
    const sourceHash = preventionGroupSourceHash(sourceGroupId, entries);
    return this.db.transaction(async (manager) => {
      if (this.activation && !(await this.enabledForUpdate(manager, organizationId))) {
        return { status: 'DISABLED' as const, changed: false };
      }
      const [existing] = await manager.query(
        `SELECT id,sourceHash,processingStatus,phaseStatus,effectivePhase,proposedPhase,confidence,justification,riskAssessments,validatedBy,validatedAt,recoveryRunId
         FROM prevention_group_processing_jobs
         WHERE organizationId=? AND visitId=? AND sourceGroupId=? LIMIT 1 FOR UPDATE`,
        [organizationId, visitId, sourceGroupId],
      );
      const status = 'PENDING';
      const effectivePhase = existing?.phaseStatus === 'VALIDATED' ? existing.effectivePhase : null;
      const phaseStatus = existing?.phaseStatus === 'VALIDATED' ? 'VALIDATED' : 'PROPOSED';
      if (existing && onlyIfMissing) return { status: existing.processingStatus, changed: false };
      if (existing && recoveryRunId && existing.recoveryRunId === recoveryRunId && existing.sourceHash === sourceHash) {
        return { status: existing.processingStatus, changed: false };
      }
      if (existing && !recoveryRunId && existing.sourceHash === sourceHash && !(retryFailed && existing.processingStatus === 'FAILED')) {
        return { status: existing.processingStatus, changed: false };
      }
      if (existing) {
        await manager.query(
          `UPDATE prevention_group_processing_jobs
           SET missionId=?,sourceKind=?,processingStatus=?,phaseStatus=?,proposedPhase=?,effectivePhase=?,confidence=?,justification=?,riskAssessments=?,${recoveryRunId ? '' : 'recommendationOverrides=NULL,'}sourcePayload=?,sourceHash=?,recoveryRunId=?,attempts=0,availableAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL,lastError=NULL
           WHERE id=? AND organizationId=?`,
          [missionId, sourceKind, status, phaseStatus, null, effectivePhase,
            null, null, null, JSON.stringify(input), sourceHash, recoveryRunId ?? null,
            existing.id, organizationId],
        );
      } else {
        await manager.query(
          `INSERT INTO prevention_group_processing_jobs
           (id,organizationId,visitId,missionId,sourceGroupId,sourceKind,processingStatus,phaseStatus,proposedPhase,effectivePhase,confidence,justification,riskAssessments,sourcePayload,sourceHash,attempts,recoveryRunId,availableAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`,
          [randomUUID(), organizationId, visitId, missionId, sourceGroupId, sourceKind, status, phaseStatus,
            null, effectivePhase, null, null, null, JSON.stringify(input), sourceHash, 0, recoveryRunId ?? null],
        );
      }
      return { status, changed: true };
    });
  }

  matchesCurrentSource(sourceGroupId: string, entries: PreventionGroupEntry[], expectedHash: string): boolean {
    return preventionGroupSourceHash(sourceGroupId, entries) === expectedHash;
  }

  async enqueueDue(limit = 50, queueOverride?: Queue): Promise<number> {
    const queue = queueOverride ?? this.queue;
    if (!queue) return 0;
    await this.db.query(
      `UPDATE prevention_group_processing_jobs
       SET processingStatus='RETRY',lockedAt=NULL,lockedBy=NULL,lastError=COALESCE(lastError,'worker claim expired'),availableAt=UTC_TIMESTAMP(6)
       WHERE processingStatus='PROCESSING' AND lockedAt IS NOT NULL
         AND lockedAt < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 600 SECOND)`,
    );
    const rows: PreventionGroupJobPayload[] = await this.db.query(
      `SELECT organizationId,visitId,sourceGroupId,sourceHash
       FROM prevention_group_processing_jobs
       WHERE processingStatus IN ('PENDING','RETRY') AND availableAt<=UTC_TIMESTAMP(6)
         AND EXISTS (SELECT 1 FROM organizations o WHERE o.id=prevention_group_processing_jobs.organizationId AND o.isActive=1 AND o.preventionEnabled=1)
       ORDER BY availableAt ASC LIMIT ?`, [Math.max(1, Math.min(100, limit))],
    );
    for (const payload of rows) {
      await queue.add(PREVENTION_GROUP_JOB, payload, {
        jobId: `prevention-group-${stableHash(`${payload.organizationId}|${payload.visitId}|${payload.sourceGroupId}|${payload.sourceHash}`)}`,
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 60_000 },
        // The database is the durable retry source. A terminal BullMQ record
        // must not prevent dispatching the same group after a later recovery.
        removeOnComplete: true,
        removeOnFail: true,
      });
    }
    return rows.length;
  }

  async process(payload: PreventionGroupJobPayload, ai: PreventionOnlyAiService): Promise<string> {
    if (!UUID_PATTERN.test(payload.organizationId) || !UUID_PATTERN.test(payload.visitId) || !payload.sourceGroupId || !/^[0-9a-f]{64}$/i.test(payload.sourceHash)) {
      throw new Error('Invalid Prevention group payload');
    }
    if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
    const [job] = await this.db.query(
      `SELECT * FROM prevention_group_processing_jobs
       WHERE organizationId=? AND visitId=? AND sourceGroupId=? AND sourceHash=? LIMIT 1`,
      [payload.organizationId, payload.visitId, payload.sourceGroupId, payload.sourceHash],
    );
    if (!job || job.processingStatus === 'READY' || job.processingStatus === 'FAILED') return job ? job.processingStatus : 'MISSING';
    const claimed = await this.db.transaction(async (manager) => {
      if (this.activation && !(await this.enabledForUpdate(manager, payload.organizationId))) return null;
      const [current] = await manager.query(
        `SELECT * FROM prevention_group_processing_jobs WHERE id=? AND organizationId=? FOR UPDATE`,
        [job.id, payload.organizationId],
      );
      if (!current || current.sourceHash !== payload.sourceHash || !['PENDING', 'RETRY'].includes(current.processingStatus)) return null;
      const claimToken = randomUUID();
      await manager.query(
        `UPDATE prevention_group_processing_jobs SET processingStatus='PROCESSING',lockedAt=UTC_TIMESTAMP(6),lockedBy=?,attempts=attempts+1 WHERE id=? AND organizationId=?`,
        [claimToken, job.id, payload.organizationId],
      );
      return { ...current, claimToken };
    });
    if (!claimed) return 'SKIPPED';
    try {
      const input = await this.loadCurrentInput(payload);
      if (input === 'STALE') {
        await this.markStale(payload, claimed.claimToken);
        this.logStaleGroup(payload, claimed);
        return 'STALE';
      }
      const result = await ai.analyze(input, payload.organizationId, payload.visitId, payload.sourceGroupId);
      const reportId = await this.persistResult(payload, result, claimed.claimToken);
      if (reportId === 'STALE') this.logStaleGroup(payload, claimed);
      if (reportId === 'STALE' || reportId === 'DISABLED') return reportId;
      if (reportId === null) throw new Error('Prevention source disappeared during processing');
      if (reportId && !this.outbox && this.extraction) {
        await this.extraction.indexReport(payload.organizationId, reportId, new Date().toISOString().slice(0, 10), true);
      }
      return 'READY';
    } catch (error: any) {
      const attempts = Number(claimed.attempts) + 1;
      const terminal = error instanceof PreventionGroupLlmTimeoutError || attempts >= MAX_ATTEMPTS;
      await this.db.transaction(async (manager) => {
        await manager.query(
          `UPDATE prevention_group_processing_jobs
           SET processingStatus=?,availableAt=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND),lockedAt=NULL,lockedBy=NULL,lastError=?
           WHERE id=? AND organizationId=? AND sourceHash=? AND processingStatus='PROCESSING' AND lockedBy=?`,
          [terminal ? 'FAILED' : 'RETRY', terminal ? 0 : 60, String(error?.message ?? 'Prevention evaluation failed').slice(0, 1000),
            job.id, payload.organizationId, payload.sourceHash, claimed.claimToken],
        );
      });
      this.logger.warn({
        message: 'PREVENTION_GROUP_EVALUATION_FAILED',
        event: 'PREVENTION_GROUP_EVALUATION_FAILED',
        organizationId: payload.organizationId,
        visitId: payload.visitId,
        groupJobId: job.id,
        sourceGroupFingerprint: createHash('sha256').update(payload.sourceGroupId).digest('hex').slice(0, 16),
        recoveryRunId: claimed.recoveryRunId ?? null,
        attempts,
        terminal,
        ...preventionFailureDiagnostic(error),
      } as any);
      // The extended deadline exhausts the single approved LLM request. Do not
      // have BullMQ retry it after the database has marked the group terminal.
      if (error instanceof PreventionGroupLlmTimeoutError) throw new UnrecoverableError(error.message);
      throw error;
    }
  }

  private logStaleGroup(payload: PreventionGroupJobPayload, job: any): void {
    this.logger.warn({
      message: 'PREVENTION_GROUP_SOURCE_CHANGED',
      event: 'PREVENTION_GROUP_SOURCE_CHANGED',
      organizationId: payload.organizationId,
      visitId: payload.visitId,
      groupJobId: job.id,
      sourceGroupFingerprint: createHash('sha256').update(payload.sourceGroupId).digest('hex').slice(0, 16),
      recoveryRunId: job.recoveryRunId ?? null,
      errorCode: 'PREVENTION_SOURCE_CHANGED',
      terminal: true,
    } as any);
  }

  private async loadCurrentInput(payload: PreventionGroupJobPayload): Promise<PreventionOnlyInput | 'STALE'> {
    const [visit] = await this.db.query(
      'SELECT missionId,photos FROM visits WHERE organizationId=? AND id=? LIMIT 1',
      [payload.organizationId, payload.visitId],
    );
    if (!visit) return 'STALE';
    let photos: unknown = visit.photos;
    if (typeof photos === 'string') {
      try { photos = JSON.parse(photos); } catch { throw new Error('Invalid persisted visit photos'); }
    }
    if (!Array.isArray(photos) || photos.length > MAX_VISIT_ENTRIES) return 'STALE';
    const entries = photos.filter((entry: any, index: number) => entry && typeof entry === 'object' &&
      !Array.isArray(entry) && preventionEntryGroupId(entry, index) === payload.sourceGroupId) as PreventionGroupEntry[];
    if (entries.length > MAX_GROUP_ENTRIES) return 'STALE';
    if (!entries.length || !entries.some((entry) => entry.analysis && typeof entry.analysis === 'object')) return 'STALE';
    if (preventionGroupSourceHash(payload.sourceGroupId, entries) !== payload.sourceHash) {
      return 'STALE';
    }
    return buildPreventionGroupInput(entries).input;
  }

  private async persistResult(payload: PreventionGroupJobPayload, result: PreventionOnlyResult, claimToken: string): Promise<string | null | 'STALE' | 'DISABLED'> {
    return this.db.transaction(async (manager) => {
      if (this.activation && !(await this.enabledForUpdate(manager, payload.organizationId))) {
        await manager.query(
          `UPDATE prevention_group_processing_jobs SET processingStatus='PENDING',lockedAt=NULL,lockedBy=NULL
           WHERE organizationId=? AND visitId=? AND sourceGroupId=? AND sourceHash=?`,
          [payload.organizationId, payload.visitId, payload.sourceGroupId, payload.sourceHash],
        );
        return 'DISABLED';
      }
      const [visit] = await manager.query(
        `SELECT photos FROM visits WHERE id=? AND organizationId=? LIMIT 1 FOR UPDATE`,
        [payload.visitId, payload.organizationId],
      );
      let photos: unknown = visit?.photos;
      if (typeof photos === 'string') { try { photos = JSON.parse(photos); } catch { photos = []; } }
      if (!Array.isArray(photos)) return null;
      const [job] = await manager.query(
        `SELECT id,phaseStatus,effectivePhase,validatedBy,validatedAt,recoveryRunId FROM prevention_group_processing_jobs
         WHERE organizationId=? AND visitId=? AND sourceGroupId=? AND sourceHash=? AND processingStatus='PROCESSING' AND lockedBy=? LIMIT 1 FOR UPDATE`,
        [payload.organizationId, payload.visitId, payload.sourceGroupId, payload.sourceHash, claimToken],
      );
      if (!job) return null;
      const currentEntries = photos.filter((entry: any, index: number) => entry && typeof entry === 'object' && !Array.isArray(entry) && preventionEntryGroupId(entry, index) === payload.sourceGroupId) as PreventionGroupEntry[];
      if (preventionGroupSourceHash(payload.sourceGroupId, currentEntries) !== payload.sourceHash) {
        await manager.query(
          `UPDATE prevention_group_processing_jobs SET processingStatus='FAILED',availableAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL,lastError=? WHERE id=? AND organizationId=?`,
          ['Prevention source changed; a new explicit AI group analysis is required', job.id, payload.organizationId],
        );
        return 'STALE';
      }
      const effective = job.phaseStatus === 'VALIDATED' ? job.effectivePhase : result.phase;
      await manager.query(
        `UPDATE prevention_group_processing_jobs
         SET processingStatus='READY',phaseStatus=?,proposedPhase=?,effectivePhase=?,confidence=?,justification=?,riskAssessments=?,${job.recoveryRunId ? '' : 'recommendationOverrides=NULL,'}availableAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL,lastError=NULL
         WHERE id=? AND organizationId=?`,
        [job.phaseStatus ?? 'PROPOSED', result.phase, effective, result.confidence, result.justification,
          JSON.stringify({ observations: result.observations, recommendations: result.recommendations }), job.id, payload.organizationId],
      );
      const [report] = await manager.query(
        `SELECT id FROM reports WHERE organizationId=? AND visitId=? LIMIT 1`,
        [payload.organizationId, payload.visitId],
      );
      if (report && this.outbox) {
        await this.outbox.enqueueReportEvent(manager, {
          organizationId: payload.organizationId,
          reportId: report.id,
          eventType: 'REPORT_UPSERTED',
          aggregateVersion: randomUUID(),
        });
      }
      return report?.id ?? '';
    });
  }

  private async markStale(payload: PreventionGroupJobPayload, claimToken: string): Promise<void> {
    await this.db.query(
      `UPDATE prevention_group_processing_jobs
       SET processingStatus='FAILED',availableAt=UTC_TIMESTAMP(6),lockedAt=NULL,lockedBy=NULL,lastError=?
       WHERE organizationId=? AND visitId=? AND sourceGroupId=? AND sourceHash=?
         AND processingStatus='PROCESSING' AND lockedBy=?`,
      ['Prevention source changed; a new explicit AI group analysis is required',
        payload.organizationId, payload.visitId, payload.sourceGroupId, payload.sourceHash, claimToken],
    );
  }

  /** Schedule only recommendation edits, never a new SPS or phase assessment. */
  async enqueueEditedRecommendationsForReport(organizationId: string, reportId: string, queue: Queue, eventId: string,
    recoverMissingTypes = false, immediateRecovery = false, maxJobs = Number.MAX_SAFE_INTEGER,
    classificationBudget?: { remaining: number; used: number }): Promise<number> {
    if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(reportId)) throw new Error('Invalid Prevention report identifiers');
    if (!UUID_PATTERN.test(eventId)) throw new Error('Invalid Prevention report event identifier');
    if (this.activation && !(await this.activation.isEnabled(organizationId))) return 0;
    const [visit] = await this.db.query(
      `SELECT v.id AS visitId,v.photos FROM reports r
       INNER JOIN visits v ON v.id=r.visitId AND v.organizationId=r.organizationId
       WHERE r.organizationId=? AND r.id=? LIMIT 1`, [organizationId, reportId]);
    const photos = parsed(visit?.photos);
    if (!visit || !Array.isArray(photos) || photos.length > MAX_VISIT_ENTRIES) return 0;
    const jobs: Array<{ sourceGroupId: string; sourcePayload: unknown; riskAssessments: unknown; recommendationOverrides: unknown }> = await this.db.query(
      `SELECT sourceGroupId,sourcePayload,riskAssessments,recommendationOverrides
       FROM prevention_group_processing_jobs
       WHERE organizationId=? AND visitId=? AND processingStatus='READY'`, [organizationId, visit.visitId]);
    let scheduled = 0;
    for (const job of jobs) {
      const texts = currentRecommendationTexts(photos, job.sourceGroupId);
      if (!texts.length) continue;
      const pending = pendingRecommendations(texts, job.sourcePayload, job.riskAssessments, job.recommendationOverrides,
        recoverMissingTypes, immediateRecovery);
      if (!pending.classify.length && !pending.classifyEdited.length && !pending.assess.length) continue;
      if (scheduled >= maxJobs) throw new Error(`Prevention recommendation enqueue limit reached after ${scheduled} jobs`);
      const classificationUnits = pending.classify.length + pending.classifyEdited.length;
      if (classificationBudget && classificationUnits > classificationBudget.remaining) {
        throw new Error(`Prevention recommendation classification limit reached after ${classificationBudget.used} units`);
      }
      const payload: PreventionRecommendationJobPayload = {
        organizationId, visitId: visit.visitId, sourceGroupId: job.sourceGroupId,
        recommendationHash: stableHash(texts),
        ...(recoverMissingTypes ? { recoveryMode: immediateRecovery ? 'IMMEDIATE_MISSING_TYPES' as const :
          'SCHEDULED_MISSING_TYPES' as const } : {}),
        ...(immediateRecovery ? { classificationLimit: classificationUnits } : {}),
      };
      await queue.add(PREVENTION_RECOMMENDATION_JOB, payload, {
        // A new outbox event is a new durable request, even if A→B→A edits
        // return to a prior text while the first A job remains active.
        jobId: `prevention-recommendation-${stableHash({ payload, eventId })}`,
        attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true, removeOnFail: true,
      });
      if (classificationBudget) {
        classificationBudget.remaining -= classificationUnits;
        classificationBudget.used += classificationUnits;
      }
      scheduled += 1;
    }
    return scheduled;
  }

  async processEditedRecommendations(payload: PreventionRecommendationJobPayload, ai: PreventionOnlyAiService): Promise<string> {
    if (!UUID_PATTERN.test(payload.organizationId) || !UUID_PATTERN.test(payload.visitId) ||
      typeof payload.sourceGroupId !== 'string' || !payload.sourceGroupId || payload.sourceGroupId.length > 100 ||
      !/^[0-9a-f]{64}$/i.test(payload.recommendationHash) ||
      (Object.keys(payload).sort().join('|') !== 'organizationId|recommendationHash|sourceGroupId|visitId' &&
       Object.keys(payload).sort().join('|') !== 'organizationId|recommendationHash|recoveryMode|sourceGroupId|visitId' &&
       Object.keys(payload).sort().join('|') !== 'classificationLimit|organizationId|recommendationHash|recoveryMode|sourceGroupId|visitId') ||
      (payload.recoveryMode !== undefined && payload.recoveryMode !== 'SCHEDULED_MISSING_TYPES' &&
        payload.recoveryMode !== 'IMMEDIATE_MISSING_TYPES') ||
      (payload.recoveryMode === 'IMMEDIATE_MISSING_TYPES' &&
        (!Number.isInteger(payload.classificationLimit) || (payload.classificationLimit ?? 0) < 1 ||
          (payload.classificationLimit ?? 0) > 50)) ||
      (payload.recoveryMode !== 'IMMEDIATE_MISSING_TYPES' && payload.classificationLimit !== undefined)) {
      throw new Error('Invalid edited recommendation payload');
    }
    const recoverMissingTypes = payload.recoveryMode === 'SCHEDULED_MISSING_TYPES' ||
      payload.recoveryMode === 'IMMEDIATE_MISSING_TYPES';
    if (this.activation && !(await this.activation.isEnabled(payload.organizationId))) return 'SKIPPED_DISABLED';
    const [visit] = await this.db.query('SELECT photos FROM visits WHERE organizationId=? AND id=? LIMIT 1',
      [payload.organizationId, payload.visitId]);
    const photos = parsed(visit?.photos);
    if (!Array.isArray(photos) || photos.length > MAX_VISIT_ENTRIES) return 'STALE';
    const texts = currentRecommendationTexts(photos, payload.sourceGroupId);
    if (stableHash(texts) !== payload.recommendationHash) return 'STALE';
    const [job] = await this.db.query(
      `SELECT sourcePayload,riskAssessments,recommendationOverrides FROM prevention_group_processing_jobs
       WHERE organizationId=? AND visitId=? AND sourceGroupId=? AND processingStatus='READY' LIMIT 1`,
      [payload.organizationId, payload.visitId, payload.sourceGroupId]);
    if (!job) return 'STALE';
    const pending = pendingRecommendations(texts, job.sourcePayload, job.riskAssessments, job.recommendationOverrides,
      recoverMissingTypes, payload.recoveryMode === 'IMMEDIATE_MISSING_TYPES');
    if (payload.classificationLimit !== undefined &&
      pending.classify.length + pending.classifyEdited.length > payload.classificationLimit) return 'STALE';
    if (!pending.classify.length && !pending.classifyEdited.length && !pending.assess.length) return 'UNCHANGED';
    if ([...pending.classify.map((item) => item.text), ...pending.classifyEdited, ...pending.assess]
      .some((text) => text.length > 4000)) {
      throw new Error('Recommendation exceeds Prevention assessment size limit');
    }
    const classifyTexts = [...new Set([...pending.classify.map((item) => item.text), ...pending.classifyEdited])];
    const classified = new Map<string, Awaited<ReturnType<PreventionOnlyAiService['classifyRecommendationActions']>>[number]>();
    for (let offset = 0; offset < classifyTexts.length; offset += 40) {
      const batch = classifyTexts.slice(offset, offset + 40);
      const results = await ai.classifyRecommendationActions(batch);
      if (results.length !== batch.length) throw new Error('Incomplete Prevention action classification');
      results.forEach((result, index) => classified.set(batch[index], result));
    }
    const assessed = [];
    for (let offset = 0; offset < pending.assess.length; offset += 40) {
      assessed.push(...await ai.assessEditedRecommendations(pending.assess.slice(offset, offset + 40)));
    }
    return this.db.transaction(async (manager) => {
      if (this.activation && !(await this.enabledForUpdate(manager, payload.organizationId))) return 'SKIPPED_DISABLED';
      const [lockedVisit] = await manager.query('SELECT photos FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE',
        [payload.organizationId, payload.visitId]);
      const currentPhotos = parsed(lockedVisit?.photos);
      if (!Array.isArray(currentPhotos) || currentPhotos.length > MAX_VISIT_ENTRIES) return 'STALE';
      const currentTexts = currentRecommendationTexts(currentPhotos, payload.sourceGroupId);
      if (stableHash(currentTexts) !== payload.recommendationHash) return 'STALE';
      const [lockedJob] = await manager.query(
        `SELECT id,sourcePayload,riskAssessments,recommendationOverrides FROM prevention_group_processing_jobs
         WHERE organizationId=? AND visitId=? AND sourceGroupId=? AND processingStatus='READY' LIMIT 1 FOR UPDATE`,
        [payload.organizationId, payload.visitId, payload.sourceGroupId]);
      if (!lockedJob) return 'STALE';
      if (JSON.stringify(pendingRecommendations(currentTexts, lockedJob.sourcePayload, lockedJob.riskAssessments,
        lockedJob.recommendationOverrides, recoverMissingTypes,
        payload.recoveryMode === 'IMMEDIATE_MISSING_TYPES')) !== JSON.stringify(pending)) return 'STALE';
      const risks = parsed(lockedJob.riskAssessments);
      if (pending.classify.length && !Array.isArray(risks?.recommendations)) return 'STALE';
      for (const item of pending.classify) {
        const entry = risks.recommendations[item.index];
        const result = classified.get(item.text);
        if (!entry || !result) return 'STALE';
        entry.actionType = result.actionType === UNCLASSIFIED_ACTION_TYPE ? 'specific-action' : result.actionType;
        entry.actionTypeConfidence = result.actionTypeConfidence;
        entry.actionTypeVersion = result.actionTypeVersion;
      }
      const currentHashes = new Set(currentTexts.map(recommendationTextHash));
      const overrides = Object.fromEntries(Object.entries(parseRecommendationOverrides(lockedJob.recommendationOverrides))
        .filter(([hash]) => currentHashes.has(hash)));
      for (const text of pending.classifyEdited) {
        const hash = recommendationTextHash(text);
        const existing = overrides[hash];
        const result = classified.get(text);
        if (!existing || existing.actionType !== UNCLASSIFIED_ACTION_TYPE || !result) return 'STALE';
        overrides[hash] = { ...existing,
          actionType: result.actionType === UNCLASSIFIED_ACTION_TYPE ? 'specific-action' : result.actionType,
          actionTypeConfidence: result.actionTypeConfidence,
          actionTypeVersion: result.actionTypeVersion };
      }
      pending.assess.forEach((text, index) => {
        const result = assessed[index];
        overrides[recommendationTextHash(text)] = {
          riskLevel: result.riskLevel, confidence: result.confidence,
          actionType: result.actionType, actionTypeConfidence: result.actionTypeConfidence,
          actionTypeVersion: result.actionTypeVersion,
          actionMetric: null,
        };
      });
      if (pending.classify.length && (pending.classifyEdited.length || pending.assess.length)) await manager.query(
        'UPDATE prevention_group_processing_jobs SET riskAssessments=?,recommendationOverrides=? WHERE id=? AND organizationId=?',
        [JSON.stringify(risks), JSON.stringify(overrides), lockedJob.id, payload.organizationId]);
      else if (pending.classify.length) await manager.query(
        'UPDATE prevention_group_processing_jobs SET riskAssessments=? WHERE id=? AND organizationId=?',
        [JSON.stringify(risks), lockedJob.id, payload.organizationId]);
      else await manager.query('UPDATE prevention_group_processing_jobs SET recommendationOverrides=? WHERE id=? AND organizationId=?',
        [JSON.stringify(overrides), lockedJob.id, payload.organizationId]);
      const [report] = await manager.query('SELECT id FROM reports WHERE organizationId=? AND visitId=? LIMIT 1',
        [payload.organizationId, payload.visitId]);
      if (report && this.outbox) await this.outbox.enqueueReportEvent(manager, {
        organizationId: payload.organizationId, reportId: report.id,
        eventType: 'REPORT_UPSERTED', aggregateVersion: randomUUID(),
      });
      return 'READY';
    });
  }

  async markValidated(organizationId: string, visitId: string, sourceGroupId: string, phase: string, userId: string, validatedAt: Date, queryable: { query(sql: string, parameters?: any[]): Promise<any[]> } = this.db): Promise<void> {
    if (!isPreventionConstructionPhase(phase)) return;
    await queryable.query(
      `UPDATE prevention_group_processing_jobs SET phaseStatus='VALIDATED',effectivePhase=?,validatedBy=?,validatedAt=?
       WHERE organizationId=? AND visitId=? AND sourceGroupId=?`,
      [phase, userId, validatedAt, organizationId, visitId, sourceGroupId],
    );
  }
}
