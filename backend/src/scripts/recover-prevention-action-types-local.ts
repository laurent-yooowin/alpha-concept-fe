import 'reflect-metadata';
import { createHash } from 'crypto';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import dataSource from '../config/typeorm.config';
import { createPreventionRedisOptions } from '../prevention/redis/prevention-redis.config';
import { PREVENTION_GROUP_QUEUE_NAME } from '../prevention/queue/prevention-queue.constants';
import { PreventionActivationService } from '../prevention/prevention-activation.service';
import { PreventionGroupProcessingService } from '../prevention/worker/prevention-group-processing.service';

config();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;
const MAX_PAGES = 1000;
const MAX_IMMEDIATE_UNITS = 50;

type Queryable = { query(sql: string, parameters?: unknown[]): Promise<any[]> };
type RecoveryQueue = Pick<Queue, 'add'>;

function eventId(organizationId: string, reportId: string): string {
  const hash = createHash('sha256').update(`local-action-recovery|${organizationId}|${reportId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function assertEnabled(db: Queryable, organizationId: string): Promise<void> {
  const [organization] = await db.query(
    'SELECT isActive,preventionEnabled FROM organizations WHERE id=? LIMIT 1', [organizationId],
  );
  if (Number(organization?.isActive) !== 1 || Number(organization?.preventionEnabled) !== 1) {
    throw new Error('Organization is not active for Prevention');
  }
}

async function inventory(db: Queryable, organizationId: string): Promise<{ reportCount: number; missingCount: number }> {
  const [row] = await db.query(
    `SELECT COUNT(DISTINCT f.reportId) AS reportCount,COUNT(*) AS missingCount
     FROM prevention_findings f
     INNER JOIN reports r ON r.id=f.reportId AND r.organizationId=f.organizationId
     WHERE f.organizationId=? AND f.findingType='RECOMMENDATION'
       AND (f.actionType IS NULL OR f.actionType='A_CLASSER')`, [organizationId],
  );
  const reportCount = Number(row?.reportCount ?? 0);
  const missingCount = Number(row?.missingCount ?? 0);
  if (!Number.isSafeInteger(reportCount) || !Number.isSafeInteger(missingCount) ||
      reportCount < 0 || missingCount < 0 || reportCount > missingCount) {
    throw new Error('Invalid Prevention action recovery inventory');
  }
  return { reportCount, missingCount };
}

export async function recoverPreventionActionTypesLocal(db: Queryable, organizationId: string,
  apply: boolean, queue?: RecoveryQueue, immediateLimit = MAX_IMMEDIATE_UNITS):
  Promise<{ reportCount: number; missingCount: number; queuedGroups: number; dryRun: boolean }> {
  if (!UUID.test(organizationId)) throw new Error('A valid organization UUID is required');
  if (!Number.isInteger(immediateLimit) || immediateLimit < 1 || immediateLimit > MAX_IMMEDIATE_UNITS) {
    throw new Error('Immediate Prevention recovery limit must be between 1 and 50 units');
  }
  await assertEnabled(db, organizationId);
  const measured = await inventory(db, organizationId);
  if (!apply) return { ...measured, queuedGroups: 0, dryRun: true };
  if (!queue) throw new Error('Prevention recovery queue is unavailable');
  if (measured.reportCount + measured.missingCount > immediateLimit) {
    throw new Error('Prevention recovery exceeds the immediate limit; schedule a night run');
  }
  await assertEnabled(db, organizationId);
  const remeasured = await inventory(db, organizationId);
  if (remeasured.reportCount + remeasured.missingCount > immediateLimit) {
    throw new Error('Prevention recovery volume changed beyond the immediate limit');
  }
  const processor = new PreventionGroupProcessingService(db as DataSource, undefined, undefined,
    new PreventionActivationService(db as DataSource));
  let cursor = '';
  let queuedGroups = 0;
  let admittedUnits = 0;
  let admittedReportCount = 0;
  const classificationBudget = { remaining: immediateLimit, used: 0 };
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const reports: Array<{ reportId: string }> = await db.query(
      `SELECT DISTINCT f.reportId
       FROM prevention_findings f
       INNER JOIN reports r ON r.id=f.reportId AND r.organizationId=f.organizationId
       WHERE f.organizationId=? AND f.findingType='RECOMMENDATION'
         AND (f.actionType IS NULL OR f.actionType='A_CLASSER') AND f.reportId>?
       ORDER BY f.reportId LIMIT ?`, [organizationId, cursor, PAGE_SIZE],
    );
    if (!reports.length) return { ...remeasured, queuedGroups, dryRun: false };
    await assertEnabled(db, organizationId);
    for (const report of reports) {
      if (!UUID.test(report.reportId)) throw new Error('Invalid Prevention report in recovery inventory');
      const current = await inventory(db, organizationId);
      if (current.reportCount + current.missingCount > immediateLimit) {
        throw new Error(`Prevention recovery volume changed beyond the immediate limit after ${queuedGroups} queued jobs`);
      }
      const [reportVolume] = await db.query(
        `SELECT COUNT(*) AS missingCount FROM prevention_findings f
         INNER JOIN reports r ON r.id=f.reportId AND r.organizationId=f.organizationId
         WHERE f.organizationId=? AND f.reportId=? AND f.findingType='RECOMMENDATION'
           AND (f.actionType IS NULL OR f.actionType='A_CLASSER')`, [organizationId, report.reportId],
      );
      const missingInReport = Number(reportVolume?.missingCount ?? 0);
      if (!Number.isSafeInteger(missingInReport) || missingInReport < 0) throw new Error('Invalid report recovery volume');
      if (!missingInReport) continue;
      if (admittedUnits + 1 + missingInReport > immediateLimit) {
        throw new Error(`Prevention recovery admitted-unit limit reached after ${queuedGroups} queued jobs`);
      }
      admittedUnits += 1 + missingInReport;
      admittedReportCount += 1;
      classificationBudget.remaining = immediateLimit - admittedReportCount - classificationBudget.used;
      try {
        queuedGroups += await processor.enqueueEditedRecommendationsForReport(
          organizationId, report.reportId, queue as Queue, eventId(organizationId, report.reportId), true, true,
          immediateLimit - queuedGroups, classificationBudget,
        );
      } catch (error) {
        throw new Error(`Prevention recovery stopped after ${queuedGroups} completed report jobs: ${(error as Error).message}`);
      }
    }
    cursor = reports[reports.length - 1].reportId;
  }
  throw new Error('Prevention action recovery page limit reached');
}

async function main(): Promise<void> {
  const organizationId = process.env.PREVENTION_ACTION_RECOVERY_ORGANIZATION_ID?.trim() ?? '';
  const apply = process.env.PREVENTION_ACTION_RECOVERY_APPLY === 'true';
  if (apply && (process.env.NODE_ENV === 'production' || process.env.PREVENTION_ACTION_RECOVERY_LOCAL_ACK !== 'true' ||
      process.env.PREVENTION_ACTION_RECOVERY_TARGET !== 'local' ||
      !['127.0.0.1', 'localhost'].includes(process.env.DATABASE_HOST ?? '') ||
      process.env.DATABASE_NAME !== 'csps_db_dev')) {
    throw new Error('Local-only recovery apply requires explicit local target, localhost and csps_db_dev');
  }
  const db = new DataSource({ ...dataSource.options, logging: false });
  let queue: Queue | undefined;
  try {
    await db.initialize();
    if (apply) queue = new Queue(PREVENTION_GROUP_QUEUE_NAME, {
      connection: createPreventionRedisOptions(new ConfigService(process.env)),
    });
    const result = await recoverPreventionActionTypesLocal(db, organizationId, apply, queue);
    console.log(JSON.stringify({ organizationId, ...result }));
  } finally {
    if (queue) await queue.close();
    if (db.isInitialized) await db.destroy();
  }
}

if (require.main === module) void main().catch((error) => {
  console.error(JSON.stringify({ event: 'PREVENTION_ACTION_RECOVERY_FAILED', errorName: error?.name ?? 'UNKNOWN',
    message: error?.message ?? 'Unknown error' }));
  process.exitCode = 1;
});
