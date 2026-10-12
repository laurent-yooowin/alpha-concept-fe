import { ConflictException, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Organization } from '../organizations/organization.entity';
import { PREVENTION_BULK_QUEUE_NAME } from './queue/prevention-queue.constants';
import { createPreventionRedisOptions } from './redis/prevention-redis.config';
import { PREVENTION_DIFFERENTIAL_JOB, PREVENTION_ORGANIZATION_SCAN_JOB } from './scheduler/prevention-scheduler.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deterministicUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export type ActivationScan = { organizationId: string; runId: string; scheduledFor: string };
type Queryable = { query(sql: string, parameters?: unknown[]): Promise<any> };

/** Caller holds the organization row lock; this persists a recoverable incremental checkpoint. */
async function stageLockedActivation(
  manager: Queryable,
  organizationId: string,
  now: Date,
  forceScan: boolean,
): Promise<ActivationScan | null> {
  if (!UUID_PATTERN.test(organizationId)) throw new ConflictException('Organisation invalide');
    const [organization]: Array<{ isActive: number | boolean; preventionEnabled: number | boolean }> = await manager.query(
      'SELECT isActive,preventionEnabled FROM organizations WHERE id=? FOR UPDATE', [organizationId],
    );
    if (!organization || Number(organization.isActive) !== 1) {
      throw new ConflictException('Organisation inactive ou introuvable');
    }
    if (Number(organization.preventionEnabled) === 1 && !forceScan) return null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const scheduledFor = new Date(now.getTime() + attempt).toISOString();
      const scheduledForSql = `${scheduledFor.slice(0, 10)} ${scheduledFor.slice(11, 23)}000`;
      const runId = deterministicUuid(`${PREVENTION_DIFFERENTIAL_JOB}|${scheduledFor}`);
      try {
        await manager.query(
          `INSERT INTO prevention_scheduler_runs
           (id,jobType,scheduledFor,status,availableAt,dispatchComplete,enqueuedJobs,workKind)
           VALUES (?,?,?,'PROCESSING',UTC_TIMESTAMP(6),1,1,'ACTIVATION')`,
          [runId, PREVENTION_DIFFERENTIAL_JOB, scheduledForSql],
        );
      } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY' && attempt < 19) continue;
        throw error;
      }
      await manager.query(
        `INSERT INTO prevention_scheduler_checkpoints
         (id,runId,organizationId,status,processedReports,scanComplete,availableAt)
         VALUES (?,?,?,'PENDING',0,0,UTC_TIMESTAMP(6))`,
        [deterministicUuid(`${runId}|${organizationId}`), runId, organizationId],
      );
      await manager.query(
        'UPDATE organizations SET preventionEnabled=1 WHERE id=? AND isActive=1 AND preventionEnabled=0',
        [organizationId],
      );
      return { organizationId, runId, scheduledFor };
    }
    throw new Error('Unable to reserve a unique Prevention activation scan');
}

/** Persists an incremental tenant scan in the scheduler's recoverable run/checkpoint tables. */
export async function stagePreventionOrganizationActivation(
  dataSource: Pick<DataSource, 'transaction'>,
  organizationId: string,
  now = new Date(),
  forceScan = false,
): Promise<ActivationScan | null> {
  if (!UUID_PATTERN.test(organizationId)) throw new ConflictException('Organisation invalide');
  return dataSource.transaction(async (manager) => {
    return stageLockedActivation(manager, organizationId, now, forceScan);
  });
}

@Injectable()
export class PreventionOrganizationActivationService implements OnApplicationShutdown {
  private readonly logger = new Logger(PreventionOrganizationActivationService.name);
  private readonly queue: Queue;

  constructor(private readonly dataSource: DataSource, config: ConfigService) {
    this.queue = new Queue(PREVENTION_BULK_QUEUE_NAME, { connection: createPreventionRedisOptions(config) });
  }

  async activate(organizationId: string, forceScan = false): Promise<void> {
    const scan = await stagePreventionOrganizationActivation(this.dataSource, organizationId, new Date(), forceScan);
    if (!scan) return;
    await this.enqueueScan(scan);
  }

  async saveActivatedOrganization(organization: Organization): Promise<Organization> {
    let scan: ActivationScan | null = null;
    const saved = await this.dataSource.transaction(async (manager) => {
      const [current]: Array<{ isActive: number | boolean; preventionEnabled: number | boolean }> = await manager.query(
        'SELECT isActive,preventionEnabled FROM organizations WHERE id=? FOR UPDATE', [organization.id],
      );
      if (!current) throw new ConflictException('Organisation introuvable');
      const firstActivation = Number(current.isActive) !== 1;
      // A concurrent activation may already have enabled Prevention. Never undo it
      // by saving a stale entity loaded before that transaction committed.
      organization.preventionEnabled = Number(current.preventionEnabled) === 1;
      const result = await manager.getRepository(Organization).save(organization);
      if (firstActivation) scan = await stageLockedActivation(manager, organization.id, new Date(), true);
      return result;
    });
    if (scan) await this.enqueueScan(scan);
    if (scan) saved.preventionEnabled = true;
    return saved;
  }

  private async enqueueScan(scan: ActivationScan): Promise<void> {
    const { organizationId } = scan;
    const digest = createHash('sha256').update(
      `${PREVENTION_DIFFERENTIAL_JOB}|${scan.scheduledFor}|${organizationId}|FIRST|SCHEDULED`,
    ).digest('hex');
    try {
      await this.queue.add(PREVENTION_ORGANIZATION_SCAN_JOB, {
        parentJobType: PREVENTION_DIFFERENTIAL_JOB,
        organizationId,
        scheduledFor: scan.scheduledFor,
        reportCursor: null,
      }, {
        jobId: `prevention-scheduler-org-${digest}`,
        attempts: 4,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
    } catch (error) {
      // The checkpoint is committed first and will be replayed by scheduler recovery.
      this.logger.warn({ message: 'Prevention activation queue unavailable; checkpoint awaits recovery',
        context: PreventionOrganizationActivationService.name, event: 'PREVENTION_ACTIVATION_QUEUE_DEFERRED',
        organizationId, runId: scan.runId, errorName: error instanceof Error ? error.name : 'UNKNOWN' } as any);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
