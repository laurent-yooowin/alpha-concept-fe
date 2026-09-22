import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { calculatePreventionScore } from './prevention-score.calculator';
import { PreventionScoreConfigurationService } from './prevention-score-configuration.service';

type DirtyPartition = {
  id: string; statDate: string; missionType: string; categoryKey: string;
  referenceDate: string; version: string;
};
type DirtyScorePartition = Omit<DirtyPartition, 'statDate'> & {
  patternKey: string; findingType: string;
};

function dateOnly(value: Date | string): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid prevention database date');
  return parsed.toISOString().slice(0, 10);
}

@Injectable()
export class PreventionStatisticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configurations: PreventionScoreConfigurationService,
  ) {}

  async refreshOrganization(organizationId: string, requestedReferenceDate: string): Promise<number> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedReferenceDate)) {
      throw new Error('Invalid statistics reference date');
    }
    const effective = await this.configurations.effectiveFor(organizationId);
    return this.dataSource.transaction(async (manager) => {
    const partitions: DirtyPartition[] = await manager.query(
      `SELECT id, statDate, missionType, categoryKey, referenceDate, version
       FROM prevention_statistics_partitions
       WHERE organizationId=? AND status='PENDING' AND availableAt<=UTC_TIMESTAMP(6)
       ORDER BY statDate, missionType, categoryKey LIMIT 100 FOR UPDATE`,
      [organizationId],
    );
    let refreshed = 0;
    for (const partition of partitions) {
        await manager.query(
          `UPDATE prevention_statistics_partitions SET status='PROCESSING', claimedAt=UTC_TIMESTAMP(6),
             claimToken=? WHERE id=?`,
          [uuid(), partition.id],
        );
        await manager.query(
          `DELETE FROM prevention_daily_statistics
           WHERE organizationId=? AND statDate=? AND missionType=? AND categoryKey=?`,
          [organizationId, partition.statDate, partition.missionType, partition.categoryKey],
        );
        await manager.query(
          `INSERT INTO prevention_daily_statistics
            (id,organizationId,statDate,missionType,categoryId,categoryKey,riskLevel,findingType,
             findingCount,reportCount,visitCount,missionCount,calculatedAt)
           SELECT UUID(),organizationId,businessDate,missionType,categoryId,
             COALESCE(categoryId,'UNCATEGORIZED'),riskLevel,findingType,
             COUNT(*),COUNT(DISTINCT reportId),COUNT(DISTINCT visitId),COUNT(DISTINCT missionId),UTC_TIMESTAMP(6)
           FROM prevention_findings
           WHERE organizationId=? AND businessDate=? AND missionType=?
             AND COALESCE(categoryId,'UNCATEGORIZED')=?
           GROUP BY organizationId,businessDate,missionType,categoryId,riskLevel,findingType`,
          [organizationId, partition.statDate, partition.missionType, partition.categoryKey],
        );

        await manager.query(
          `DELETE FROM prevention_statistics_partitions
           WHERE id=? AND organizationId=? AND status='PROCESSING' AND version=?`,
          [partition.id, organizationId, partition.version],
        );
        refreshed += 1;
    }

    const scorePartitions: DirtyScorePartition[] = await manager.query(
      `SELECT id,patternKey,missionType,categoryKey,findingType,referenceDate,version
       FROM prevention_score_partitions
       WHERE organizationId=? AND status='PENDING' AND availableAt<=UTC_TIMESTAMP(6)
       ORDER BY patternKey,missionType,categoryKey,findingType LIMIT 200 FOR UPDATE`,
      [organizationId],
    );
    for (const partition of scorePartitions) {
        await manager.query(
          `UPDATE prevention_score_partitions SET status='PROCESSING',claimedAt=UTC_TIMESTAMP(6),
             claimToken=? WHERE id=?`,
          [uuid(), partition.id],
        );
        const referenceDate = dateOnly(partition.referenceDate);
        const [existing]: Array<{ referenceDate: Date | string }> = await manager.query(
          `SELECT referenceDate FROM prevention_priority_scores WHERE organizationId=? AND patternKey=?
             AND missionType=? AND categoryKey=? AND findingType=? FOR UPDATE`,
          [organizationId, partition.patternKey, partition.missionType, partition.categoryKey,
            partition.findingType],
        );
        if (existing && dateOnly(existing.referenceDate) > referenceDate) {
          await manager.query(
            `DELETE FROM prevention_score_partitions WHERE id=? AND organizationId=? AND version=?`,
            [partition.id, organizationId, partition.version],
          );
          continue;
        }
        await manager.query(
          `DELETE FROM prevention_priority_scores WHERE organizationId=? AND patternKey=?
             AND missionType=? AND categoryKey=? AND findingType=?
             AND referenceDate<=?`,
          [organizationId, partition.patternKey, partition.missionType, partition.categoryKey,
            partition.findingType, referenceDate],
        );
        const [row]: Array<any> = await manager.query(
          `SELECT patternKey,missionType,categoryId,COALESCE(categoryId,'UNCATEGORIZED') categoryKey,
             findingType,
             CASE MAX(CASE riskLevel WHEN 'faible' THEN 1 WHEN 'moyen' THEN 2 ELSE 3 END)
               WHEN 1 THEN 'faible' WHEN 2 THEN 'moyen' ELSE 'eleve' END riskLevel,
             MIN(businessDate) firstOccurrence,MAX(businessDate) lastOccurrence,
             COUNT(*) occurrenceCount,COUNT(DISTINCT reportId) reportCount,
             COUNT(DISTINCT visitId) visitCount,COUNT(DISTINCT missionId) missionCount,
             COUNT(DISTINCT businessDate) distinctDayCount,
             SUM(businessDate>DATE_SUB(?,INTERVAL ? DAY)) recentWindowCount,
             SUM(businessDate<=DATE_SUB(?,INTERVAL ? DAY) AND businessDate>DATE_SUB(?,INTERVAL ? DAY)) previousWindowCount
           FROM prevention_findings
           WHERE organizationId=? AND patternKey=? AND missionType=?
             AND COALESCE(categoryId,'UNCATEGORIZED')=? AND findingType=?
           GROUP BY patternKey,missionType,categoryId,findingType`,
          [referenceDate, effective.value.trendWindowDays, referenceDate,
            effective.value.trendWindowDays, referenceDate, effective.value.trendWindowDays * 2,
            organizationId, partition.patternKey, partition.missionType, partition.categoryKey,
            partition.findingType],
        );
        if (row) {
          const result = calculatePreventionScore({
            riskLevel: row.riskLevel,
            occurrenceCount: Number(row.occurrenceCount), missionCount: Number(row.missionCount),
            distinctDayCount: Number(row.distinctDayCount),
            firstOccurrence: dateOnly(row.firstOccurrence),
            lastOccurrence: dateOnly(row.lastOccurrence),
            recentWindowCount: Number(row.recentWindowCount),
            previousWindowCount: Number(row.previousWindowCount), referenceDate,
          }, effective.value);
          await manager.query(
            `INSERT INTO prevention_priority_scores
              (id,organizationId,patternKey,missionType,categoryId,categoryKey,findingType,riskLevel,
               score,components,referenceDate,periodStartDate,periodEndDate,firstOccurrenceDate,
               lastOccurrenceDate,occurrenceCount,reportCount,visitCount,missionCount,occurrenceDayCount,
               trendCurrentOccurrenceCount,trendPreviousOccurrenceCount,configurationSource,
               configurationId,configurationVersion,configurationFingerprint,calculatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`,
            [uuid(), organizationId, row.patternKey, row.missionType, row.categoryId, row.categoryKey,
              row.findingType, row.riskLevel, result.score, JSON.stringify(result.components), referenceDate,
              row.firstOccurrence, referenceDate, row.firstOccurrence, row.lastOccurrence,
              Number(row.occurrenceCount), Number(row.reportCount), Number(row.visitCount),
              Number(row.missionCount), Number(row.distinctDayCount), Number(row.recentWindowCount),
              Number(row.previousWindowCount), effective.source, effective.id, effective.version,
              effective.fingerprint],
          );
        }
        await manager.query(
          `DELETE FROM prevention_score_partitions
           WHERE id=? AND organizationId=? AND status='PROCESSING' AND version=?`,
          [partition.id, organizationId, partition.version],
        );
        refreshed += 1;
    }
    return refreshed;
    });
  }
}
