import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { PreventionActivationService } from '../prevention-activation.service';
import {
  PreventionBulkAdmissionHook,
  PreventionBulkAdmissionRequest,
  PreventionBulkAdmissionResult,
  PreventionBulkLease,
} from './prevention-bulk-admission.types';
import { isWithinPreventionBulkWindow, loadPreventionBulkConfiguration, nextPreventionBulkWindowStart, PreventionBulkConfiguration } from './prevention-bulk.config';

const LEASE_ROW_ID = 1;
const AUTOMATIC_JOB_TYPES = [
  'prevention.scheduler.differential',
  'prevention.scheduler.consolidation',
  'prevention.scheduler.weekly-audit',
  'prevention.scheduler.monthly-audit',
];

@Injectable()
export class PreventionBulkAdmissionService implements PreventionBulkAdmissionHook {
  private readonly logger = new Logger(PreventionBulkAdmissionService.name);
  private readonly configuration: PreventionBulkConfiguration;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
    @Optional() private readonly activation?: PreventionActivationService,
  ) {
    this.configuration = loadPreventionBulkConfiguration(config);
  }

  get settings() { return this.configuration; }

  immediateLimit(workKind: 'RECONSTRUCTION' | 'BUDGET'): number {
    return workKind === 'BUDGET'
      ? this.configuration.immediateBudgetCeiling
      : this.configuration.immediateRebuildCeiling;
  }

  async admit(request: PreventionBulkAdmissionRequest): Promise<PreventionBulkAdmissionResult> {
    if (this.activation && !(await this.activation.isEnabled(request.organizationId))) {
      return { admitted: false, availableAt: null, reason: 'DISABLED' };
    }
    const now = new Date();
    const nextWindow = nextPreventionBulkWindowStart(now, this.configuration);
    const windowOpen = isWithinPreventionBulkWindow(now, this.configuration);
    const scheduledAdminWork = request.workKind !== 'AUTOMATIC' &&
      (request.executionMode === 'SCHEDULED' || (request.workKind === 'BUDGET' && !request.executionMode));
    if ((!windowOpen && request.workKind === 'AUTOMATIC') || (!windowOpen && scheduledAdminWork)) {
      return { admitted: false, availableAt: nextWindow.toISOString(), reason: 'OUTSIDE_WINDOW' };
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO prevention_scheduler_bulk_admission
           (id,organizationId,runId,workKind,leaseToken,leaseExpiresAt,availableAt,lastError)
         VALUES (?,NULL,NULL,NULL,NULL,NULL,UTC_TIMESTAMP(6),NULL)
         ON DUPLICATE KEY UPDATE id=id`, [LEASE_ROW_ID],
      );
      const [current]: Array<any> = await manager.query(
        `SELECT organizationId,runId,workKind,leaseToken,leaseExpiresAt,availableAt
         FROM prevention_scheduler_bulk_admission WHERE id=? FOR UPDATE`, [LEASE_ROW_ID],
      );
      const active = current?.leaseToken && current.leaseExpiresAt && new Date(current.leaseExpiresAt).getTime() > now.getTime();
      if (active && (current.organizationId !== request.organizationId || current.runId !== request.runId)) {
        return {
          admitted: false,
          availableAt: new Date(current.leaseExpiresAt).toISOString(),
          reason: 'ORGANIZATION_BUSY',
        };
      }
      if (active && current.organizationId === request.organizationId && current.runId === request.runId) {
        return {
          admitted: true,
          availableAt: new Date(current.leaseExpiresAt).toISOString(),
          reason: 'ADMITTED',
          lease: {
            organizationId: request.organizationId,
            runId: request.runId,
            workKind: request.workKind,
            leaseToken: String(current.leaseToken),
          },
        };
      }
      if (request.workKind !== 'AUTOMATIC') {
        const [due]: Array<{ id: string }> = await manager.query(
          `SELECT r.id FROM prevention_scheduler_runs r
           WHERE r.jobType IN (?,?,?,?) AND r.status IN ('PENDING','PROCESSING')
             AND r.scheduledFor<=UTC_TIMESTAMP(6)
             AND ((r.dispatchComplete=0 AND EXISTS (
               SELECT 1 FROM organizations o WHERE o.isActive=1 AND o.preventionEnabled=1
                 AND (r.organizationCursor IS NULL OR o.id>r.organizationCursor)
             )) OR EXISTS (
               SELECT 1 FROM prevention_scheduler_checkpoints c
               JOIN organizations o ON o.id=c.organizationId AND o.isActive=1 AND o.preventionEnabled=1
               WHERE c.runId=r.id
                 AND c.status IN ('PENDING','PROCESSING')
                 AND (c.scanComplete=0 OR c.pendingJobs>0)
             )) LIMIT 1`, AUTOMATIC_JOB_TYPES,
        );
        if (due) {
          const availableAt = new Date(now.getTime() + this.configuration.retryDelaySeconds * 1000);
          return { admitted: false, availableAt: availableAt.toISOString(), reason: 'AUTOMATIC_WORK_DUE' };
        }
      }
      if ((!windowOpen && request.workKind === 'AUTOMATIC') || (!windowOpen && scheduledAdminWork)) {
        return { admitted: false, availableAt: nextWindow.toISOString(), reason: 'OUTSIDE_WINDOW' };
      }
      const leaseToken = randomUUID();
      const expiresAt = new Date(now.getTime() + this.configuration.leaseSeconds * 1000);
      await manager.query(
        `UPDATE prevention_scheduler_bulk_admission
         SET organizationId=?,runId=?,workKind=?,leaseToken=?,leaseExpiresAt=?,availableAt=NULL,lastError=NULL
         WHERE id=?`,
        [request.organizationId, request.runId, request.workKind, leaseToken, expiresAt, LEASE_ROW_ID],
      );
      this.logger.log({
        event: 'PREVENTION_BULK_ADMITTED', organizationId: request.organizationId,
        runId: request.runId, workKind: request.workKind,
      } as any);
      return {
        admitted: true,
        availableAt: expiresAt.toISOString(),
        reason: 'ADMITTED',
        lease: { organizationId: request.organizationId, runId: request.runId, workKind: request.workKind, leaseToken },
      };
    });
  }

  async assertLease(lease: PreventionBulkLease): Promise<void> {
    const result: any = await this.dataSource.query(
      `UPDATE prevention_scheduler_bulk_admission
       SET leaseExpiresAt=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ? SECOND)
       WHERE id=? AND organizationId=? AND runId=? AND workKind=? AND leaseToken=?
         AND leaseExpiresAt>UTC_TIMESTAMP(6)`,
      [this.configuration.leaseSeconds, LEASE_ROW_ID, lease.organizationId, lease.runId, lease.workKind, lease.leaseToken],
    );
    if (!result?.affectedRows) throw new Error('Prevention bulk admission fence was lost');
  }

  async renew(lease: PreventionBulkLease): Promise<void> { await this.assertLease(lease); }

  async withLease<T>(lease: PreventionBulkLease, operation: () => Promise<T>): Promise<T> {
    await this.assertLease(lease);
    let lost = false;
    const heartbeat = setInterval(() => {
      void this.renew(lease).catch(() => { lost = true; });
    }, Math.max(1_000, Math.floor(this.configuration.leaseSeconds * 500)));
    heartbeat.unref();
    try {
      const result = await operation();
      if (lost) throw new Error('Prevention bulk admission fence was lost');
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async release(lease: PreventionBulkLease): Promise<void> {
    await this.dataSource.query(
      `UPDATE prevention_scheduler_bulk_admission
       SET organizationId=NULL,runId=NULL,workKind=NULL,leaseToken=NULL,leaseExpiresAt=NULL,
           availableAt=UTC_TIMESTAMP(6)
       WHERE id=? AND organizationId=? AND runId=? AND workKind=? AND leaseToken=?`,
      [LEASE_ROW_ID, lease.organizationId, lease.runId, lease.workKind, lease.leaseToken],
    );
    this.logger.log({ event: 'PREVENTION_BULK_RELEASED', organizationId: lease.organizationId, runId: lease.runId } as any);
  }
}
