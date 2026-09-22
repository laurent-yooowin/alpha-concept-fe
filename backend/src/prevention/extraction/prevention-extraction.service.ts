import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { PreventionFinding } from '../entities/prevention-finding.entity';
import { PreventionReportSnapshot } from '../entities/prevention-report-snapshot.entity';
import {
  canonicalizePreventionSource,
  MAX_PREVENTION_SOURCE_BYTES,
  PreventionSourceValidationError,
  preventionSourceHash,
} from './prevention-canonicalizer';

export type PreventionExtractionResult = 'INDEXED' | 'UNCHANGED' | 'MISSING' | 'DELETED';

@Injectable()
export class PreventionExtractionService {
  private readonly logger = new Logger(PreventionExtractionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async indexReport(
    organizationId: string,
    reportId: string,
    referenceDate: string,
    forceRebuild = false,
  ): Promise<PreventionExtractionResult> {
    this.assertReferenceDate(referenceDate);
    return this.dataSource.transaction(async (manager) => {
      const [report]: Array<{
        reportId: string;
        visitId: string;
        missionId: string;
        status: string | null;
        updatedAt: Date;
      }> = await manager.query(
        `SELECT report.id AS reportId, report.visitId, report.missionId,
                report.status, report.updatedAt
         FROM reports report
         WHERE report.id = ? AND report.organizationId = ?
         FOR UPDATE`,
        [reportId, organizationId],
      );

      if (!report) {
        this.logger.warn(`Prevention report index skipped organization=${organizationId} report=${reportId}`);
        return 'MISSING';
      }

      const [visit]: Array<{
        visitId: string;
        missionId: string;
        visitDate: Date;
        photos: unknown;
        photosBytes: number;
      }> = await manager.query(
        `SELECT visit.id AS visitId, visit.missionId, visit.visitDate,
                CASE WHEN OCTET_LENGTH(visit.photos) <= ? THEN visit.photos ELSE NULL END AS photos,
                COALESCE(OCTET_LENGTH(visit.photos), 0) AS photosBytes
         FROM visits visit
         WHERE visit.id = ? AND visit.organizationId = ?
         FOR UPDATE`,
        [MAX_PREVENTION_SOURCE_BYTES, report.visitId, organizationId],
      );
      const [mission]: Array<{
        missionId: string;
        missionType: string;
      }> = await manager.query(
        `SELECT mission.id AS missionId, mission.type AS missionType
         FROM missions mission
         WHERE mission.id = ? AND mission.organizationId = ?
         FOR UPDATE`,
        [report.missionId, organizationId],
      );

      if (
        !visit ||
        !mission ||
        visit.missionId !== report.missionId
      ) {
        throw new PreventionSourceValidationError('Report relations are inconsistent');
      }
      if (Number(visit.photosBytes) > MAX_PREVENTION_SOURCE_BYTES) {
        throw new PreventionSourceValidationError('Visit analysis source exceeds size limit');
      }

      const source = canonicalizePreventionSource({
        reportId: report.reportId,
        visitId: visit.visitId,
        missionId: mission.missionId,
        sourceStatus: report.status,
        visitDate: visit.visitDate,
        missionType: mission.missionType,
        entries: this.parseEntries(visit.photos),
      });
      const sourceHash = preventionSourceHash(source);
      const snapshotRepository = manager.getRepository(PreventionReportSnapshot);
      let snapshot = await snapshotRepository.findOne({
        where: { organizationId, reportId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!forceRebuild && snapshot?.sourceHash === sourceHash) return 'UNCHANGED';

      if (!snapshot) {
        snapshot = snapshotRepository.create({ id: uuid(), organizationId, reportId });
      }
      const dirtyPartitions = await this.reportPartitions(manager, organizationId, reportId);
      Object.assign(snapshot, {
        visitId: source.visitId,
        missionId: source.missionId,
        sourceHash,
        sourceUpdatedAt: report.updatedAt,
        businessDate: source.businessDate,
        missionType: source.missionType,
        sourceStatus: source.sourceStatus,
        findingCount: source.findings.length,
        indexedAt: new Date(),
      });
      snapshot = await snapshotRepository.save(snapshot);

      const findingRepository = manager.getRepository(PreventionFinding);
      await findingRepository.delete({ organizationId, snapshotId: snapshot.id });
      if (source.findings.length) {
        snapshot.findingCount = source.findings.length;
        await snapshotRepository.save(snapshot);
        await findingRepository.save(
          source.findings.map((finding) =>
            findingRepository.create({
              id: uuid(),
              organizationId,
              snapshotId: snapshot.id,
              reportId: report.reportId,
              visitId: source.visitId,
              missionId: source.missionId,
              sourceGroupId: finding.sourceGroupId,
              sourceKind: finding.sourceKind,
              findingType: finding.findingType,
              categoryId: null,
              normalizedKey: finding.normalizedKey,
              patternKey: finding.patternKey,
              content: finding.content,
              danger: finding.danger,
              risk: finding.risk,
              riskLevel: finding.riskLevel,
              confidence: finding.confidence === null ? null : finding.confidence.toFixed(2),
              regulatoryReferences: finding.regulatoryReferences.length
                ? finding.regulatoryReferences
                : null,
              businessDate: source.businessDate,
              missionType: source.missionType,
            }),
          ),
        );
      }
      for (const finding of source.findings) dirtyPartitions.push({
        statDate: source.businessDate, missionType: source.missionType,
        categoryKey: 'UNCATEGORIZED', patternKey: finding.patternKey,
        findingType: finding.findingType,
      });
      await this.markPartitionsDirty(manager, organizationId, dirtyPartitions, referenceDate);
      return 'INDEXED';
    });
  }

  async deleteReport(
    organizationId: string,
    reportId: string,
    referenceDate: string,
  ): Promise<PreventionExtractionResult> {
    this.assertReferenceDate(referenceDate);
    await this.dataSource.transaction(async (manager) => {
      const dirtyPartitions = await this.reportPartitions(manager, organizationId, reportId);
      await manager.getRepository(PreventionReportSnapshot).delete({ organizationId, reportId });
      await this.markPartitionsDirty(manager, organizationId, dirtyPartitions, referenceDate);
    });
    return 'DELETED';
  }

  private async reportPartitions(
    manager: EntityManager,
    organizationId: string,
    reportId: string,
  ): Promise<Array<{ statDate: string; missionType: string; categoryKey: string;
    patternKey: string; findingType: string }>> {
    return manager.query(
      `SELECT DISTINCT businessDate AS statDate, missionType,
              COALESCE(categoryId, 'UNCATEGORIZED') AS categoryKey, patternKey, findingType
       FROM prevention_findings
       WHERE organizationId = ? AND reportId = ?`,
      [organizationId, reportId],
    );
  }

  private async markPartitionsDirty(
    manager: EntityManager,
    organizationId: string,
    partitions: Array<{ statDate: string; missionType: string; categoryKey: string;
      patternKey: string; findingType: string }>,
    referenceDate: string,
  ): Promise<void> {
    const unique = new Map(partitions.map((partition) => [
      `${partition.statDate}|${partition.missionType}|${partition.categoryKey}`,
      partition,
    ]));
    for (const partition of unique.values()) {
      await manager.query(
        `INSERT INTO prevention_statistics_partitions
         (id, organizationId, statDate, missionType, categoryKey, referenceDate,
          status, version, attempts, availableAt)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 1, 0, UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE status='PENDING', version=version+1, attempts=0,
           referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),
           availableAt=UTC_TIMESTAMP(6), claimedAt=NULL, claimToken=NULL, lastError=NULL`,
        [uuid(), organizationId, partition.statDate, partition.missionType, partition.categoryKey,
          referenceDate],
      );
    }
    const scoreUnique = new Map(partitions.map((partition) => [
      `${partition.patternKey}|${partition.missionType}|${partition.categoryKey}|${partition.findingType}`,
      partition,
    ]));
    for (const partition of scoreUnique.values()) {
      await manager.query(
        `INSERT INTO prevention_score_partitions
          (id,organizationId,patternKey,missionType,categoryKey,findingType,referenceDate,
           status,version,availableAt)
         VALUES (?,?,?,?,?,?,?,'PENDING',1,UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,
           referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),
           availableAt=UTC_TIMESTAMP(6),claimedAt=NULL,claimToken=NULL`,
        [uuid(), organizationId, partition.patternKey, partition.missionType,
          partition.categoryKey, partition.findingType, referenceDate],
      );
    }
  }

  private assertReferenceDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
      throw new PreventionSourceValidationError('Invalid prevention reference date');
    }
  }

  private parseEntries(value: unknown): any[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    if (typeof value !== 'string') {
      throw new PreventionSourceValidationError('Visit analysis source is invalid');
    }
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        throw new PreventionSourceValidationError('Visit analysis source must be an array');
      }
      return parsed;
    } catch {
      throw new PreventionSourceValidationError('Visit analysis source contains invalid JSON');
    }
  }
}
