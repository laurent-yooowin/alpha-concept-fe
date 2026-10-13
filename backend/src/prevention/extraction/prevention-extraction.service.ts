import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { PreventionFinding } from '../entities/prevention-finding.entity';
import { PreventionReportSnapshot } from '../entities/prevention-report-snapshot.entity';
import {
  canonicalizePreventionSource,
  MAX_PREVENTION_SOURCE_BYTES,
  PersistedGroupAssessment,
  PreventionSourceValidationError,
  preventionSourceHash,
} from './prevention-canonicalizer';
import {
  classifyPreventionFinding,
  PREVENTION_CATEGORY_CATALOG,
} from './prevention-category-classifier';

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
      // Budget publication takes an exclusive organization lock before linking
      // findings. Take the compatible shared lock before locking findings here,
      // otherwise the category/partition FK checks can invert that order.
      await manager.query(
        'SELECT id FROM organizations WHERE id=? FOR SHARE',
        [organizationId],
      );
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

      const assessments: Array<PersistedGroupAssessment & { sourceGroupId: string }> = await manager.query(
        `SELECT sourceGroupId,processingStatus,phaseStatus,proposedPhase,effectivePhase,confidence,
                justification,sourceKind,riskAssessments,recommendationOverrides,validatedBy,validatedAt,sourceHash,sourcePayload
         FROM prevention_group_processing_jobs
         WHERE organizationId=? AND visitId=? FOR UPDATE`,
        [organizationId, visit.visitId],
      );
      const source = canonicalizePreventionSource({
        reportId: report.reportId,
        visitId: visit.visitId,
        missionId: mission.missionId,
        sourceStatus: report.status,
        visitDate: visit.visitDate,
        missionType: mission.missionType,
        entries: this.parseEntries(visit.photos),
        assessments: Object.fromEntries(assessments.map((assessment) => [assessment.sourceGroupId, assessment])),
      });
      const sourceHash = preventionSourceHash(source);
      await this.upsertAnalysisGroups(manager, organizationId, source);
      const snapshotRepository = manager.getRepository(PreventionReportSnapshot);
      let snapshot = await snapshotRepository.findOne({
        where: { organizationId, reportId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!forceRebuild && snapshot?.sourceHash === sourceHash) {
        await manager.query(
          `UPDATE prevention_report_snapshots SET sourceUpdatedAt=?,indexedAt=UTC_TIMESTAMP(6)
           WHERE id=? AND organizationId=?`,
          [report.updatedAt, snapshot.id, organizationId],
        );
        return 'UNCHANGED';
      }

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
      const priorFindings: Array<{ id: string; normalizedKey: string; findingType: string }> = await manager.query(
        'SELECT id,normalizedKey,findingType FROM prevention_findings WHERE organizationId=? AND snapshotId=?',
        [organizationId, snapshot.id],
      );
      const priorFindingIds = new Map(priorFindings.map((finding) =>
        [`${finding.findingType}|${finding.normalizedKey}`, finding.id]));
      await findingRepository.delete({ organizationId, snapshotId: snapshot.id });
      const categoryIds = source.findings.length
        ? await this.ensurePreventionCategories(manager, organizationId)
        : new Map<string, string>();
      const categorizedFindings = source.findings.map((finding) => {
        const categoryCode = classifyPreventionFinding(finding);
        return { finding, categoryId: categoryCode ? categoryIds.get(categoryCode) ?? null : null };
      });
      if (source.findings.length) {
        snapshot.findingCount = source.findings.length;
        await snapshotRepository.save(snapshot);
        await findingRepository.save(
          categorizedFindings.map(({ finding, categoryId }) =>
            findingRepository.create({
              id: priorFindingIds.get(`${finding.findingType}|${finding.normalizedKey}`) ?? uuid(),
              organizationId,
              snapshotId: snapshot.id,
              reportId: report.reportId,
              visitId: source.visitId,
              missionId: source.missionId,
              sourceGroupId: finding.sourceGroupId,
              sourceKind: finding.sourceKind,
              findingType: finding.findingType,
              categoryId,
              normalizedKey: finding.normalizedKey,
              patternKey: finding.patternKey,
              content: finding.content,
              danger: finding.danger,
              risk: finding.risk,
              riskLevel: finding.riskLevel,
              confidence: finding.confidence === null ? null : finding.confidence.toFixed(2),
              actionType: finding.actionType,
              actionTypeConfidence: finding.actionTypeConfidence === null ? null : finding.actionTypeConfidence.toFixed(2),
              actionTypeVersion: finding.actionTypeVersion,
              actionMetric: finding.actionMetric,
              regulatoryReferences: finding.regulatoryReferences.length
                ? finding.regulatoryReferences
                : null,
              businessDate: source.businessDate,
              missionType: source.missionType,
            }),
          ),
        );
      }
      for (const { finding, categoryId } of categorizedFindings) dirtyPartitions.push({
        statDate: source.businessDate, missionType: source.missionType,
        categoryKey: categoryId ?? 'UNCATEGORIZED', patternKey: finding.patternKey,
        findingType: finding.findingType,
      });
      await this.markPartitionsDirty(manager, organizationId, dirtyPartitions, referenceDate);
      return 'INDEXED';
    });
  }

  private async upsertAnalysisGroups(
    manager: EntityManager,
    organizationId: string,
    source: import('./prevention-extraction.types').CanonicalPreventionSource,
  ): Promise<void> {
    const existing: Array<{ id: string; sourceGroupId: string; status: string }> = await manager.query(
      `SELECT id,sourceGroupId,status FROM prevention_analysis_groups
       WHERE organizationId=? AND visitId=? FOR UPDATE`,
      [organizationId, source.visitId],
    );
    const incoming = new Set(source.analysisGroups.map((group) => group.sourceGroupId));
    for (const group of source.analysisGroups) {
      const row = existing.find((item) => item.sourceGroupId === group.sourceGroupId);
      if (row?.status === 'VALIDATED') {
        await manager.query(
          `UPDATE prevention_analysis_groups
           SET missionId=?,reportId=?,sourceKind=?,proposedPhase=?,confidence=?,justification=?,source=?,modelVersion=?,sourceHash=?
           WHERE id=? AND organizationId=?`,
          [source.missionId, source.reportId, group.sourceKind, group.proposedPhase, group.confidence,
            group.justification, group.source, group.modelVersion, group.sourceHash, row.id, organizationId],
        );
        continue;
      }
      if (row) {
        await manager.query(
          `UPDATE prevention_analysis_groups
           SET missionId=?,reportId=?,sourceKind=?,proposedPhase=?,effectivePhase=?,status=?,confidence=?,
               justification=?,source=?,modelVersion=?,validatedBy=?,validatedAt=?,sourceHash=?
           WHERE id=? AND organizationId=?`,
          [source.missionId, source.reportId, group.sourceKind, group.proposedPhase, group.effectivePhase, group.status, group.confidence,
            group.justification, group.source, group.modelVersion, group.validatedBy,
            group.validatedAt, group.sourceHash, row.id, organizationId],
        );
      } else {
        await manager.query(
          `INSERT INTO prevention_analysis_groups
           (id,organizationId,visitId,missionId,reportId,sourceGroupId,sourceKind,
            proposedPhase,effectivePhase,status,confidence,justification,source,modelVersion,
            validatedBy,validatedAt,sourceHash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [uuid(), organizationId, source.visitId, source.missionId, source.reportId, group.sourceGroupId,
            group.sourceKind, group.proposedPhase, group.effectivePhase, group.status, group.confidence,
            group.justification, group.source, group.modelVersion, group.validatedBy,
            group.validatedAt, group.sourceHash],
        );
      }
    }
    const staleGroups = existing
      .filter((row) => !incoming.has(row.sourceGroupId))
      .map((row) => row.id);
    for (const id of staleGroups) {
      await manager.query(
        `DELETE FROM prevention_analysis_groups WHERE id=? AND organizationId=?`,
        [id, organizationId],
      );
    }
  }

  private async ensurePreventionCategories(
    manager: EntityManager,
    organizationId: string,
  ): Promise<Map<string, string>> {
    const select = () => manager.query(
      `SELECT id,code FROM prevention_categories WHERE organizationId=?`,
      [organizationId],
    ) as Promise<Array<{ id: string; code: string }>>;
    let rows = await select();
    let inserted = false;
    for (const category of PREVENTION_CATEGORY_CATALOG) {
      inserted = true;
      await manager.query(
        `INSERT INTO prevention_categories
          (id,organizationId,code,label,description,color,displayOrder,isActive)
         VALUES (?,?,?,?,?,?,?,1)
         ON DUPLICATE KEY UPDATE
          label=VALUES(label),description=VALUES(description),color=VALUES(color),displayOrder=VALUES(displayOrder)`,
        [
          uuid(), organizationId, category.code, category.label, category.description,
          category.color, category.displayOrder,
        ],
      );
    }
    if (inserted) rows = await select();
    return new Map(rows.map((row) => [row.code, row.id]));
  }

  async deleteReport(
    organizationId: string,
    reportId: string,
    referenceDate: string,
  ): Promise<PreventionExtractionResult> {
    this.assertReferenceDate(referenceDate);
    await this.dataSource.transaction(async (manager) => {
      // Snapshot deletion can cascade to findings before partition FK checks.
      // Keep the same organization-before-findings lock order as indexReport.
      await manager.query(
        'SELECT id FROM organizations WHERE id=? FOR SHARE',
        [organizationId],
      );
      const dirtyPartitions = await this.reportPartitions(manager, organizationId, reportId);
      await manager.getRepository(PreventionReportSnapshot).delete({ organizationId, reportId });
      await this.markPartitionsDirty(manager, organizationId, dirtyPartitions, referenceDate);
      // The report FK may have cascaded its findings before this independent
      // event arrived. Rebuild materialized dimensions whose count is stale.
      await this.markMaterializedDimensionsDirty(manager, organizationId, referenceDate);
    });
    return 'DELETED';
  }

  async reconcileDeletedReportEffects(organizationId: string, referenceDate: string): Promise<number> {
    this.assertReferenceDate(referenceDate);
    return this.dataSource.transaction((manager) =>
      this.markMaterializedDimensionsDirty(manager, organizationId, referenceDate));
  }

  private async markMaterializedDimensionsDirty(manager: EntityManager, organizationId: string, referenceDate: string): Promise<number> {
    const statisticsResult: any = await manager.query(
      `INSERT INTO prevention_statistics_partitions
       (id,organizationId,statDate,missionType,categoryKey,referenceDate,status,version,attempts,availableAt)
       SELECT UUID(),dimensions.organizationId,dimensions.statDate,dimensions.missionType,
         dimensions.categoryKey,?,'PENDING',1,0,UTC_TIMESTAMP(6)
       FROM (
         SELECT organizationId,businessDate AS statDate,missionType,
           COALESCE(categoryId,'UNCATEGORIZED') AS categoryKey,riskLevel,findingType
         FROM prevention_findings WHERE organizationId=?
         UNION
         SELECT organizationId,statDate,missionType,categoryKey,riskLevel,findingType
         FROM prevention_daily_statistics WHERE organizationId=?
       ) AS dimensions
       WHERE COALESCE((
         SELECT materialized.findingCount FROM prevention_daily_statistics AS materialized
         WHERE materialized.organizationId=dimensions.organizationId
           AND materialized.statDate=dimensions.statDate
           AND materialized.missionType=dimensions.missionType
           AND materialized.categoryKey=dimensions.categoryKey
           AND materialized.riskLevel=dimensions.riskLevel
           AND materialized.findingType=dimensions.findingType
         LIMIT 1
       ),0) <> (
         SELECT COUNT(*) FROM prevention_findings AS currentFinding
         WHERE currentFinding.organizationId=dimensions.organizationId
           AND currentFinding.businessDate=dimensions.statDate
           AND currentFinding.missionType=dimensions.missionType
           AND COALESCE(currentFinding.categoryId,'UNCATEGORIZED')=dimensions.categoryKey
           AND currentFinding.riskLevel=dimensions.riskLevel
           AND currentFinding.findingType=dimensions.findingType
       )
       GROUP BY dimensions.organizationId,dimensions.statDate,dimensions.missionType,dimensions.categoryKey
       ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,attempts=0,
         referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),availableAt=UTC_TIMESTAMP(6),
         claimedAt=NULL,claimToken=NULL,lastError=NULL`,
      [referenceDate, organizationId, organizationId],
    );
    const scoreResult: any = await manager.query(
      `INSERT INTO prevention_score_partitions
       (id,organizationId,patternKey,missionType,categoryKey,findingType,referenceDate,status,version,availableAt)
       SELECT UUID(),dimensions.organizationId,dimensions.patternKey,dimensions.missionType,
         dimensions.categoryKey,dimensions.findingType,?,'PENDING',1,UTC_TIMESTAMP(6)
       FROM (
         SELECT organizationId,patternKey,missionType,
           COALESCE(categoryId,'UNCATEGORIZED') AS categoryKey,findingType
         FROM prevention_findings WHERE organizationId=?
         UNION
         SELECT organizationId,patternKey,missionType,categoryKey,findingType
         FROM prevention_priority_scores WHERE organizationId=?
       ) AS dimensions
       WHERE COALESCE((
         SELECT materialized.occurrenceCount FROM prevention_priority_scores AS materialized
         WHERE materialized.organizationId=dimensions.organizationId
           AND materialized.patternKey=dimensions.patternKey
           AND materialized.missionType=dimensions.missionType
           AND materialized.categoryKey=dimensions.categoryKey
           AND materialized.findingType=dimensions.findingType
         LIMIT 1
       ),0) <> (
         SELECT COUNT(*) FROM prevention_findings AS currentFinding
         WHERE currentFinding.organizationId=dimensions.organizationId
           AND currentFinding.patternKey=dimensions.patternKey
           AND currentFinding.missionType=dimensions.missionType
           AND COALESCE(currentFinding.categoryId,'UNCATEGORIZED')=dimensions.categoryKey
           AND currentFinding.findingType=dimensions.findingType
       )
       GROUP BY dimensions.organizationId,dimensions.patternKey,dimensions.missionType,
         dimensions.categoryKey,dimensions.findingType
       ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,
         referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),availableAt=UTC_TIMESTAMP(6),
         claimedAt=NULL,claimToken=NULL`,
      [referenceDate, organizationId, organizationId],
    );
    return Number(statisticsResult?.affectedRows ?? 0) + Number(scoreResult?.affectedRows ?? 0);
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
