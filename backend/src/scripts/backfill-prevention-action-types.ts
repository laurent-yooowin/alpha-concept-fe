import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { resolve } from 'path';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import dataSource from '../config/typeorm.config';
import { PreventionOnlyAiService } from '../prevention/ai/prevention-only-ai.service';
import { isPreventionActionType, UNCLASSIFIED_ACTION_TYPE } from '../prevention/prevention-action-types';
import { PreventionActivationService } from '../prevention/prevention-activation.service';
import { PreventionOutboxService } from '../prevention/outbox/prevention-outbox.service';
import { createPreventionGroupAudit } from './backfill-prevention-groups';
import { buildPreventionGroupInput, preventionEntryGroupId, PreventionGroupEntry } from '../prevention/worker/prevention-group-source';

config();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIT_FILE = resolve(process.cwd(), 'logs', 'prevention-action-type-backfill.jsonl');
const PAGE_SIZE = 25;
const MAX_PAGES = 1000;

type JobRow = { id: string; organizationId: string; visitId: string; sourceGroupId: string;
  sourceHash: string; riskAssessments: unknown; sourcePayload: unknown; photos: unknown };

function parsedObject(value: unknown): any {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value && typeof value === 'object' ? value : null;
}

function recommendationTexts(job: JobRow): string[] | null {
  const payload = parsedObject(job.sourcePayload);
  const entries = payload?.entries;
  if (!Array.isArray(entries)) return null;
  const first = entries.find((entry: any) => Array.isArray(entry?.recommendationTexts));
  return first ? first.recommendationTexts : [];
}

function currentRecommendationsMatch(job: JobRow): boolean {
  const photos = parsedObject(job.photos);
  if (!Array.isArray(photos) || photos.length > 1000) return false;
  const entries = photos.filter((entry: any, index: number) => entry && typeof entry === 'object' &&
    preventionEntryGroupId(entry, index) === job.sourceGroupId) as PreventionGroupEntry[];
  if (!entries.length) return false;
  const persisted = recommendationTexts(job);
  if (!persisted?.length) return false;
  // This backfill classifies recommendation text only. Photo URLs, directives or
  // other group metadata may have changed without changing those texts. Never
  // apply the old risk vector to edited recommendations, though.
  const current = buildPreventionGroupInput(entries).input.entries.flatMap((entry) => entry.recommendationTexts ?? []);
  return JSON.stringify(current) === JSON.stringify(persisted);
}

export async function backfillPreventionActionTypes(db: DataSource, ai: PreventionOnlyAiService | null,
  organizationId: string, apply: boolean,
  audit: (entry: Record<string, unknown>) => Promise<void>, maxUpdates = 10): Promise<{ inspected: number; missing: number; updated: number; stale: number }> {
  if (!UUID.test(organizationId)) throw new Error('A valid organization UUID is required');
  if (!Number.isInteger(maxUpdates) || maxUpdates < 1 || maxUpdates > 100) throw new Error('Action backfill batch size must be between 1 and 100');
  const [organization] = await db.query('SELECT isActive,preventionEnabled FROM organizations WHERE id=?', [organizationId]);
  if (!organization || Number(organization.isActive) !== 1 || Number(organization.preventionEnabled) !== 1) {
    throw new Error('Organization is not active for Prevention');
  }
  if (apply && !ai) throw new Error('Prevention action classifier is unavailable');
  const outbox = new PreventionOutboxService(new PreventionActivationService(db));
  const totals = { inspected: 0, missing: 0, updated: 0, stale: 0 };
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const jobs: JobRow[] = await db.query(
      `SELECT j.id,j.organizationId,j.visitId,j.sourceGroupId,j.sourceHash,j.riskAssessments,j.sourcePayload,v.photos
       FROM prevention_group_processing_jobs j
       INNER JOIN visits v ON v.id=j.visitId AND v.organizationId=j.organizationId
       WHERE j.organizationId=? AND j.processingStatus='READY' AND j.id>?
       ORDER BY j.id LIMIT ?`, [organizationId, cursor, PAGE_SIZE]);
    if (!jobs.length) return totals;
    cursor = jobs[jobs.length - 1].id;
    for (const job of jobs) {
      totals.inspected += 1;
      const risks = parsedObject(job.riskAssessments);
      const texts = recommendationTexts(job);
      if (!risks || !Array.isArray(risks.recommendations) || !texts || texts.length !== risks.recommendations.length) {
        await audit({ event: 'JOB_SKIPPED_INVALID', organizationId, jobId: job.id });
        continue;
      }
      const missingIndices = risks.recommendations.flatMap((item: any, index: number) =>
        isPreventionActionType(item?.actionType) && item.actionType !== UNCLASSIFIED_ACTION_TYPE ? [] : [index]);
      if (!missingIndices.length || !texts.length) continue;
      totals.missing += 1;
      if (!currentRecommendationsMatch(job)) {
        totals.stale += 1;
        await audit({ event: 'JOB_SKIPPED_STALE', organizationId, jobId: job.id, visitId: job.visitId });
        continue;
      }
      if (!apply) continue;
      const classifications = [];
      for (let offset = 0; offset < missingIndices.length; offset += 40) {
        const batch = await ai!.classifyRecommendationActions(missingIndices.slice(offset, offset + 40).map((index) => texts[index]));
        classifications.push(...batch);
      }
      const changed = await db.transaction(async (manager) => {
        const [active] = await manager.query(
          'SELECT isActive,preventionEnabled FROM organizations WHERE id=? FOR UPDATE', [organizationId]);
        if (!active || Number(active.isActive) !== 1 || Number(active.preventionEnabled) !== 1) {
          throw new Error('Organization disabled during action-type backfill');
        }
        // Match the API/worker lock order (visit before group job).
        const [visit] = await manager.query('SELECT photos FROM visits WHERE id=? AND organizationId=? FOR UPDATE',
          [job.visitId, organizationId]);
        if (!visit) return false;
        const [lockedJob]: JobRow[] = await manager.query(
          `SELECT id,organizationId,visitId,sourceGroupId,sourceHash,riskAssessments,sourcePayload
           FROM prevention_group_processing_jobs WHERE id=? AND organizationId=? AND processingStatus='READY' FOR UPDATE`,
          [job.id, organizationId]);
        if (!lockedJob || lockedJob.sourceHash !== job.sourceHash) return false;
        if (!currentRecommendationsMatch({ ...lockedJob, photos: visit.photos })) return false;
        const current = parsedObject(lockedJob.riskAssessments);
        if (!Array.isArray(current?.recommendations) || current.recommendations.length !== texts.length ||
          JSON.stringify(recommendationTexts(lockedJob)) !== JSON.stringify(texts)) return false;
        let updated = false;
        current.recommendations = current.recommendations.map((item: Record<string, unknown>, index: number) => {
          const missingOffset = missingIndices.indexOf(index);
          if (missingOffset < 0 || (isPreventionActionType(item?.actionType) && item.actionType !== UNCLASSIFIED_ACTION_TYPE)) return item;
          updated = true;
          return { ...item, actionType: classifications[missingOffset].actionType === UNCLASSIFIED_ACTION_TYPE ? 'specific-action' : classifications[missingOffset].actionType,
            actionTypeConfidence: classifications[missingOffset].actionTypeConfidence,
            actionTypeVersion: classifications[missingOffset].actionTypeVersion };
        });
        if (!updated) return false;
        await manager.query('UPDATE prevention_group_processing_jobs SET riskAssessments=? WHERE id=? AND organizationId=?',
          [JSON.stringify(current), job.id, organizationId]);
        const [report] = await manager.query('SELECT id FROM reports WHERE organizationId=? AND visitId=? LIMIT 1',
          [organizationId, job.visitId]);
        if (report) await outbox.enqueueReportEvent(manager, { organizationId, reportId: report.id,
          eventType: 'REPORT_UPSERTED', aggregateVersion: randomUUID() });
        return true;
      });
      if (changed) totals.updated += 1;
      else totals.stale += 1;
      await audit({ event: changed ? 'JOB_CLASSIFIED' : 'JOB_SKIPPED_STALE', organizationId,
        jobId: job.id, visitId: job.visitId, recommendationCount: texts.length });
      if (totals.updated >= maxUpdates) return totals;
    }
  }
  throw new Error('Prevention action backfill page limit reached');
}

async function main(): Promise<void> {
  const organizationId = process.env.PREVENTION_ACTION_BACKFILL_ORGANIZATION_ID?.trim() ?? '';
  const apply = process.env.PREVENTION_ACTION_BACKFILL_APPLY === 'true';
  const maxUpdates = Number(process.env.PREVENTION_ACTION_BACKFILL_MAX_UPDATES ?? '10');
  if (!UUID.test(organizationId)) throw new Error('PREVENTION_ACTION_BACKFILL_ORGANIZATION_ID must be a UUID');
  await mkdir(resolve(process.cwd(), 'logs'), { recursive: true, mode: 0o700 });
  const audit = createPreventionGroupAudit(AUDIT_FILE, randomUUID());
  const db = new DataSource({ ...dataSource.options, logging: false });
  try {
    await db.initialize();
    const ai = apply ? new PreventionOnlyAiService(new ConfigService(process.env), {} as any) : null;
    await audit({ event: 'RUN_STARTED', organizationId, dryRun: !apply, maxUpdates });
    const totals = await backfillPreventionActionTypes(db, ai, organizationId, apply, audit, maxUpdates);
    await audit({ event: 'RUN_COMPLETED', organizationId, dryRun: !apply, maxUpdates, ...totals });
    console.log(JSON.stringify({ organizationId, dryRun: !apply, maxUpdates, ...totals, auditFile: AUDIT_FILE }));
  } catch (error) {
    await audit({ event: 'RUN_FAILED', organizationId, dryRun: !apply,
      errorName: (error as Error)?.name ?? 'UNKNOWN' });
    throw error;
  } finally { if (db.isInitialized) await db.destroy(); }
}

if (require.main === module) void main().catch((error) => {
  console.error(JSON.stringify({ event: 'PREVENTION_ACTION_BACKFILL_FAILED', errorName: error?.name ?? 'UNKNOWN' }));
  process.exitCode = 1;
});
