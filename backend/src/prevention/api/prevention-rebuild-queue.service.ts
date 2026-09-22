import { HttpException, HttpStatus, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PREVENTION_QUEUE_NAME } from '../outbox/prevention-outbox.types';
import { PREVENTION_MANUAL_REBUILD_JOB } from '../scheduler/prevention-scheduler.types';

const MANUAL_JOB_TYPE = 'MANUAL_REBUILD';
const ACTIVE_STATUSES = ['PENDING', 'PROCESSING'];
const deterministicId = (value: string): string => { const hash = createHash('sha256').update(value).digest('hex'); return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32); };

@Injectable()
export class PreventionRebuildQueueService implements OnApplicationShutdown {
  private readonly queue: Queue;
  private readonly cooldownSeconds: number;

  constructor(private readonly dataSource: DataSource, config: ConfigService) {
    this.queue = new Queue(PREVENTION_QUEUE_NAME, {
      connection: createPreventionRedisOptions(config),
    });
    const configuredCooldown = Number(config.get('PREVENTION_REBUILD_COOLDOWN_SECONDS', 3600));
    this.cooldownSeconds = Number.isInteger(configuredCooldown) && configuredCooldown >= 300 && configuredCooldown <= 86400 ? configuredCooldown : 3600;
  }

  async enqueue(organizationId: string): Promise<{ id: string; status: string }> {
    const runId = deterministicId(MANUAL_JOB_TYPE + "|" + organizationId + "|" + Math.floor(Date.now() / 300000));
    // The run table is intentionally global in P6. Tenant ownership is kept in
    // the manual job payload and checkpoint; the API only returns this opaque id.
    // Use a recent active checkpoint to deduplicate per tenant.
    const [tenantExisting] = await this.dataSource.query(
      `SELECT r.id,r.status FROM prevention_scheduler_runs r
       JOIN prevention_scheduler_checkpoints c ON c.runId=r.id
       WHERE r.jobType=? AND c.organizationId=? AND r.status IN (?,?)
       ORDER BY r.createdAt DESC LIMIT 1`,
      [MANUAL_JOB_TYPE, organizationId, ACTIVE_STATUSES[0], ACTIVE_STATUSES[1]],
    );
    if (tenantExisting) return tenantExisting;
    const [recent] = await this.dataSource.query(
      "SELECT r.id,r.status,TIMESTAMPDIFF(SECOND,r.createdAt,UTC_TIMESTAMP()) ageSeconds FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id WHERE r.jobType=? AND c.organizationId=? AND r.createdAt>DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND) ORDER BY r.createdAt DESC LIMIT 1",
      [MANUAL_JOB_TYPE, organizationId, this.cooldownSeconds],
    );
    if (recent) throw new HttpException({ message: "Une reconstruction a déjà été demandée récemment", retryAfterSeconds: Math.max(1, this.cooldownSeconds - Number(recent.ageSeconds ?? 0)), jobId: recent.id }, HttpStatus.TOO_MANY_REQUESTS);

    const scheduledFor = new Date().toISOString();
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        "INSERT IGNORE INTO prevention_scheduler_runs (id,jobType,scheduledFor,status,availableAt,dispatchComplete) VALUES (?,?,?,'PROCESSING',UTC_TIMESTAMP(6),1)",
        [runId, MANUAL_JOB_TYPE, scheduledFor],
      );
      await manager.query(
        "INSERT IGNORE INTO prevention_scheduler_checkpoints (id,runId,organizationId,status,processedReports,scanComplete) VALUES (?,?,?,'PENDING',0,0)",
        [deterministicId(runId + "|" + organizationId), runId, organizationId],
      );
    });
    const [current] = await this.dataSource.query(
      "SELECT r.id,r.status FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id WHERE r.id=? AND c.organizationId=? AND r.jobType=? LIMIT 1",
      [runId, organizationId, MANUAL_JOB_TYPE],
    );
    if (!current || current.status !== "PROCESSING") return current ?? { id: runId, status: "FAILED" };
    const jobId = `prevention-manual-rebuild-${createHash('sha256').update(`${organizationId}|${runId}`).digest('hex')}`;
    try {
      await this.queue.add(PREVENTION_MANUAL_REBUILD_JOB, { organizationId, runId, scheduledFor }, {
        jobId, attempts: 4, backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 1000, removeOnFail: 1000,
      });
    } catch (error) {
      await this.dataSource.query(
        `UPDATE prevention_scheduler_runs SET status='FAILED',lastError=? WHERE id=?`,
        ['QUEUE_ENQUEUE_FAILED', runId],
      );
      throw error;
    }
    return { id: runId, status: 'PROCESSING' };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
