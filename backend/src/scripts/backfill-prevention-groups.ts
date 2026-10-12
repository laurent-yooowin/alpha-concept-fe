import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { mkdir, open } from 'fs/promises';
import { constants } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import dataSource from '../config/typeorm.config';
import { PreventionActivationService } from '../prevention/prevention-activation.service';
import { PREVENTION_GROUP_QUEUE_NAME } from '../prevention/queue/prevention-queue.constants';
import { createPreventionRedisOptions } from '../prevention/redis/prevention-redis.config';
import { PreventionGroupProcessingService } from '../prevention/worker/prevention-group-processing.service';
import { PreventionGroupEntry, preventionEntryGroupId } from '../prevention/worker/prevention-group-source';

config();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_ORGANIZATION = 1000;
const MAX_AUDIT_BYTES = 10 * 1024 * 1024;
const AUDIT_FILE = resolve(process.cwd(), 'logs', 'prevention-group-backfill.jsonl');

type OrganizationRow = { id: string; isActive: number | boolean; preventionEnabled: number | boolean };
type VisitRow = { id: string; photos: unknown };
type JobRow = { visitId: string; sourceGroupId: string };
type Queryable = { query(sql: string, parameters?: unknown[]): Promise<any[]> };
type Backfill = Pick<PreventionGroupProcessingService, 'backfillOrganization'>;
type Audit = (entry: Record<string, unknown>) => Promise<void>;

export function createPreventionGroupAudit(filePath: string, runId: string, maxBytes = MAX_AUDIT_BYTES): Audit {
  return async (entry) => {
    const line = JSON.stringify({ runId, at: new Date().toISOString(), ...entry }) + '\n';
    const bytes = Buffer.byteLength(line);
    const handle = await open(filePath, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      const file = await handle.stat();
      if (!file.isFile() || file.nlink !== 1 || (file.mode & 0o777) !== 0o600) {
        throw new Error('Prevention group audit file must be a private regular file');
      }
      if (file.size + bytes > maxBytes) {
        throw new Error('Prevention group audit reached its size limit; archive it before retrying');
      }
      await handle.writeFile(line);
    } finally {
      await handle.close();
    }
  };
}

export type PreventionGroupBackfillOptions = {
  apply: boolean;
  organizationId?: string;
  allEnabled: boolean;
};

export function parsePreventionGroupBackfillOptions(env: NodeJS.ProcessEnv): PreventionGroupBackfillOptions {
  const organizationId = env.PREVENTION_GROUP_BACKFILL_ORGANIZATION_ID?.trim() || undefined;
  if (organizationId && !UUID_PATTERN.test(organizationId)) {
    throw new Error('PREVENTION_GROUP_BACKFILL_ORGANIZATION_ID must be a UUID');
  }
  const apply = env.PREVENTION_GROUP_BACKFILL_APPLY === 'true';
  const allEnabled = env.PREVENTION_GROUP_BACKFILL_ALL_ENABLED === 'true';
  if (apply && (Boolean(organizationId) === allEnabled)) {
    throw new Error('Apply requires exactly one of ORGANIZATION_ID or ALL_ENABLED=true');
  }
  return { apply, organizationId, allEnabled };
}

function analyzedGroupIds(photos: unknown): Set<string> {
  let entries = photos;
  if (typeof entries === 'string') {
    try { entries = JSON.parse(entries); } catch { return new Set(); }
  }
  if (!Array.isArray(entries)) return new Set();
  const result = new Set<string>();
  entries.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const entry = raw as PreventionGroupEntry;
    if (entry.analysis && typeof entry.analysis === 'object' && !Array.isArray(entry.analysis)) {
      result.add(preventionEntryGroupId(entry, index));
    }
  });
  return result;
}

function invalidHistoricalGroup(visits: VisitRow[]): { visitId: string; entryNo: number } | null {
  for (const visit of visits) {
    let entries = visit.photos;
    if (typeof entries === 'string') {
      try { entries = JSON.parse(entries); } catch { continue; }
    }
    if (!Array.isArray(entries)) continue;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] as PreventionGroupEntry | null;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          !entry.analysis || typeof entry.analysis !== 'object' || Array.isArray(entry.analysis)) continue;
      if (preventionEntryGroupId(entry, index).length > 100) return { visitId: visit.id, entryNo: index + 1 };
    }
  }
  return null;
}

async function assertStillEligible(db: Queryable, organizationId: string, audit: Audit): Promise<void> {
  const [organization]: OrganizationRow[] = await db.query(
    'SELECT isActive,preventionEnabled FROM organizations WHERE id=? LIMIT 1', [organizationId],
  );
  if (Number(organization?.isActive) === 1 && Number(organization?.preventionEnabled) === 1) return;
  await audit({ event: 'ORGANIZATION_INTERRUPTED', organizationId, reason: 'PREVENTION_NOT_ACTIVE' });
  throw Object.assign(new Error('Organization disabled during Prevention group backfill'),
    { code: 'ORGANIZATION_DISABLED_DURING_BACKFILL' });
}

export async function inventoryPreventionGroupPage(
  db: Queryable,
  organizationId: string,
  visits: VisitRow[],
): Promise<{ analyzedGroups: number; missingGroups: number; existingGroups: number }> {
  if (!visits.length) return { analyzedGroups: 0, missingGroups: 0, existingGroups: 0 };
  const placeholders = visits.map(() => '?').join(',');
  const jobs: JobRow[] = await db.query(
    `SELECT visitId,sourceGroupId FROM prevention_group_processing_jobs
     WHERE organizationId=? AND visitId IN (${placeholders})`,
    [organizationId, ...visits.map((visit) => visit.id)],
  );
  const existing = new Set(jobs.map((job) => JSON.stringify([job.visitId, job.sourceGroupId])));
  let analyzedGroups = 0;
  let missingGroups = 0;
  for (const visit of visits) {
    for (const groupId of analyzedGroupIds(visit.photos)) {
      analyzedGroups += 1;
      if (!existing.has(JSON.stringify([visit.id, groupId]))) missingGroups += 1;
    }
  }
  return { analyzedGroups, missingGroups, existingGroups: analyzedGroups - missingGroups };
}

export async function runPreventionGroupBackfill(
  db: Queryable,
  backfill: Backfill | undefined,
  options: PreventionGroupBackfillOptions,
  audit: Audit,
): Promise<{ organizations: number; eligibleOrganizations: number; visits: number; missingBefore: number; staged: number }> {
  const organizations: OrganizationRow[] = await db.query(
    `SELECT id,isActive,preventionEnabled FROM organizations
     WHERE (? IS NULL OR id=?) ORDER BY id`,
    [options.organizationId ?? null, options.organizationId ?? null],
  );
  if (options.organizationId && !organizations.length) throw new Error('Requested organization not found');
  if (options.apply && !backfill) throw new Error('Backfill queue is unavailable');

  const total = { organizations: organizations.length, eligibleOrganizations: 0, visits: 0, missingBefore: 0, staged: 0 };
  for (const organization of organizations) {
    const eligible = Number(organization.isActive) === 1 && Number(organization.preventionEnabled) === 1;
    if (eligible) total.eligibleOrganizations += 1;
    else {
      await audit({ event: 'ORGANIZATION_INELIGIBLE', organizationId: organization.id,
        reason: 'PREVENTION_NOT_ACTIVE', dryRun: !options.apply });
      if (options.apply) continue;
    }
    let cursor: string | null = null;
    let pages = 0;
    let visitsScanned = 0;
    let missingBefore = 0;
    let staged = 0;
    while (true) {
      if (pages >= MAX_PAGES_PER_ORGANIZATION) throw new Error('Backfill page safety limit reached');
      const visits: VisitRow[] = await db.query(
        `SELECT id,photos FROM visits
         WHERE organizationId=? AND photos IS NOT NULL AND photos LIKE '%"analysis"%'
           AND (? IS NULL OR id>?) ORDER BY id ASC LIMIT ?`,
        [organization.id, cursor, cursor, PAGE_SIZE],
      );
      if (!visits.length) break;
      const invalid = invalidHistoricalGroup(visits);
      if (invalid) {
        await audit({ event: 'PAGE_REJECTED', organizationId: organization.id, ...invalid,
          reason: 'GROUP_ID_TOO_LONG' });
        throw Object.assign(new Error('Historical group identifier exceeds 100 characters'),
          { code: 'INVALID_HISTORICAL_GROUP_ID' });
      }
      const before = await inventoryPreventionGroupPage(db, organization.id, visits);
      const nextCursor = visits[visits.length - 1].id;
      await audit({ event: 'PAGE_STARTED', organizationId: organization.id, cursor, nextCursor,
        visits: visits.length, analyzedGroups: before.analyzedGroups, missingGroups: before.missingGroups });
      let newJobs = 0;
      if (options.apply) {
        const result = await backfill!.backfillOrganization(organization.id, PAGE_SIZE, cursor ?? undefined);
        await assertStillEligible(db, organization.id, audit);
        if (result.visits !== visits.length || result.nextCursor !== nextCursor) {
          throw new Error('Backfill page changed during execution; rerun safely from the start');
        }
        const after = await inventoryPreventionGroupPage(db, organization.id, visits);
        newJobs = Math.max(0, before.missingGroups - after.missingGroups);
        staged += newJobs;
      }
      await audit({ event: 'PAGE_COMPLETED', organizationId: organization.id, cursor, nextCursor,
        visits: visits.length, missingBefore: before.missingGroups, staged: newJobs, dryRun: !options.apply });
      visitsScanned += visits.length;
      missingBefore += before.missingGroups;
      cursor = nextCursor;
      pages += 1;
      if (visits.length < PAGE_SIZE) break;
    }
    if (options.apply) await assertStillEligible(db, organization.id, audit);
    const statuses: Array<{ processingStatus: string; jobCount: number }> = await db.query(
      `SELECT processingStatus,COUNT(*) AS jobCount FROM prevention_group_processing_jobs
       WHERE organizationId=? GROUP BY processingStatus ORDER BY processingStatus`,
      [organization.id],
    );
    await audit({ event: 'ORGANIZATION_COMPLETED', organizationId: organization.id,
      eligible, visits: visitsScanned, missingBefore, staged, dryRun: !options.apply, statuses });
    total.visits += visitsScanned;
    total.missingBefore += missingBefore;
    total.staged += staged;
  }
  if (options.apply && total.eligibleOrganizations === 0) {
    throw new Error('No active organization with Prevention enabled was selected');
  }
  return total;
}

async function main(): Promise<void> {
  const options = parsePreventionGroupBackfillOptions(process.env);
  const runId = randomUUID();
  await mkdir(resolve(process.cwd(), 'logs'), { recursive: true, mode: 0o700 });
  const audit = createPreventionGroupAudit(AUDIT_FILE, runId);
  await audit({ event: 'RUN_STARTED', dryRun: !options.apply,
    organizationId: options.organizationId ?? null, allEnabled: options.allEnabled });

  const db = new DataSource({ ...dataSource.options, logging: false });
  let queue: Queue | undefined;
  try {
    await db.initialize();
    if (options.apply) {
      const configService = new ConfigService(process.env);
      queue = new Queue(PREVENTION_GROUP_QUEUE_NAME, { connection: createPreventionRedisOptions(configService) });
      await queue.waitUntilReady();
    }
    const backfill = options.apply
      ? new PreventionGroupProcessingService(db, queue, undefined, new PreventionActivationService(db))
      : undefined;
    const summary = await runPreventionGroupBackfill(db, backfill, options, audit);
    await audit({ event: 'RUN_COMPLETED', dryRun: !options.apply, ...summary });
    console.log(JSON.stringify({ dryRun: !options.apply, ...summary, auditFile: AUDIT_FILE }));
  } catch (error) {
    const failure = error as Error & { code?: string };
    await audit({ event: 'RUN_FAILED', errorName: failure?.name || 'UNKNOWN', errorCode: failure?.code || null });
    throw error;
  } finally {
    if (queue) await queue.close();
    if (db.isInitialized) await db.destroy();
  }
}

if (require.main === module) void main().catch((error) => {
  const failure = error as Error & { code?: string };
  console.error(JSON.stringify({ event: 'PREVENTION_GROUP_BACKFILL_FAILED',
    errorName: failure?.name || 'UNKNOWN', errorCode: failure?.code || null }));
  process.exitCode = 1;
});
