import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../../user/user.entity';
import { PreventionQueryDto } from './prevention-api.dto';
import { PreventionRebuildQueueService } from './prevention-rebuild-queue.service';
import { PreventionActivationService } from '../prevention-activation.service';
import { PREVENTION_PHASE_LABELS } from '../prevention-phase';
import { PreventionRebuildConfirmDto } from './prevention-rebuild.dto';

type Period = { from: string | null; to: string | null; granularity: 'day' | 'week' | 'month'; all: boolean };

const MAX_REGULATORY_ROWS = 5000;
const MAX_REGULATORY_ITEMS = 100;
const MAX_REGULATORY_REPORTS = 25;
const CRITICAL_PRIORITY_SCORE = 80;
const MAX_TREND_BUCKETS = 1000;

function parseJsonArray(value: unknown, maxItems = 20, maxLength = 500): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function normalizeRegulatoryReference(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const references = new Set<string>();
  for (const match of normalized.matchAll(/\b([RLD])\.?\s*(\d{4})\s*-\s*(\d+(?:-\d+)?)\b/gi)) {
    references.add(`${match[1].toUpperCase()}.${match[2]}-${match[3]}`);
  }
  for (const match of normalized.matchAll(/\b(NF\s+[A-Z](?:\s+[A-Z])?\s*\d{1,5}(?:-\d+)+|EN\s+\d{2,5}(?:-\d+)+)\b/gi)) {
    references.add(match[1].replace(/\s+/g, ' ').toUpperCase());
  }
  for (const match of normalized.matchAll(/\b(?:décret|decret)\s+(?:n[°o]\s*)?(\d{2,4}-\d+)\b/gi)) {
    references.add(`Décret ${match[1]}`);
  }
  return references.size ? [...references] : [normalized.slice(0, 200)];
}

function parseRegulatoryReferences(value: unknown): string[] {
  return [...new Set(parseJsonArray(value)
    .flatMap((reference) => normalizeRegulatoryReference(reference)))]
    .slice(0, 50);
}

@Injectable()
export class PreventionApiService {
  constructor(
    private readonly db: DataSource,
    private readonly rebuilds: PreventionRebuildQueueService,
    @Optional() private readonly activation?: PreventionActivationService,
  ) {}

  private org(user: User): string {
    if (!user || user.role !== UserRole.ADMIN || !user.organizationId) {
      throw new ForbiddenException('Prévention accessible uniquement aux administrateurs d’organisation');
    }
    return user.organizationId;
  }

  private async enabledOrg(user: User): Promise<string> {
    const organizationId = this.org(user);
    if (this.activation) await this.activation.assertEnabled(organizationId);
    return organizationId;
  }

  private period(q: PreventionQueryDto, defaultPreset: PreventionQueryDto["preset"] = "LAST_30_DAYS"): Period {
    const explicitFrom = (q.from ?? q.startDate)?.slice(0, 10);
    const explicitTo = (q.to ?? q.endDate)?.slice(0, 10);
    const preset = q.preset ?? defaultPreset;
    if (preset === "CUSTOM" && (!explicitFrom || !explicitTo)) throw new BadRequestException("La période personnalisée exige from et to");
    const today = new Date();
    const all = preset === "ALL";
    const end = all
      ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      : explicitTo
        ? new Date(explicitTo + "T00:00:00.000Z")
        : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    let start = all ? new Date(end) : explicitFrom ? new Date(explicitFrom + "T00:00:00.000Z") : new Date(end);
    if (all) start.setUTCFullYear(start.getUTCFullYear() - 10);
    else if (!explicitFrom) {
      if (preset === "LAST_7_DAYS") start.setUTCDate(start.getUTCDate() - 6);
      else if (preset === "CURRENT_QUARTER") start = new Date(Date.UTC(end.getUTCFullYear(), Math.floor(end.getUTCMonth() / 3) * 3, 1));
      else if (preset === "LAST_6_MONTHS") start.setUTCMonth(start.getUTCMonth() - 6);
      else if (preset === "CURRENT_YEAR") start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
      else if (preset === "LAST_12_MONTHS") start.setUTCMonth(start.getUTCMonth() - 12);
      else start.setUTCDate(start.getUTCDate() - 29);
    }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new BadRequestException("Période invalide");
    const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days > 3660) throw new BadRequestException("Période maximale : 10 ans");
    const period: Period = {
      from: all ? null : start.toISOString().slice(0, 10),
      to: all ? null : end.toISOString().slice(0, 10),
      granularity: all ? "month" : days <= 90 ? "day" : days <= 365 ? "week" : "month",
      all,
    };
    // Keep the existing response shape; `all` is an internal query-planning flag.
    Object.defineProperty(period, 'all', { value: all, enumerable: false });
    return period;
  }

  private periodArgs(period: Period, organizationId: string): unknown[] {
    // Date parameters are appended by periodClause at the corresponding SQL
    // predicate, keeping ALL free of both date SQL and date arguments.
    return [organizationId];
  }

  private periodClause(period: Period, column: string, args: unknown[]): string | null {
    if (period.all) return null;
    args.push(period.from!, period.to!);
    return `${column} BETWEEN ? AND ?`;
  }

  private statFilters(q: PreventionQueryDto, period: Period, alias: string, args: unknown[]): string {
    const clauses = [`${alias}.organizationId=?`];
    const dateClause = this.periodClause(period, `${alias}.statDate`, args);
    if (dateClause) clauses.push(dateClause);
    if (q.missionType) { clauses.push(`${alias}.missionType=?`); args.push(q.missionType); }
    if (q.categoryId) { clauses.push(`${alias}.categoryId=?`); args.push(q.categoryId); }
    if (q.riskLevel) { clauses.push(`${alias}.riskLevel=?`); args.push(q.riskLevel); }
    return clauses.join(' AND ');
  }

  private severityFilter(
    severity: PreventionQueryDto['severity'],
    alias: string,
    args: unknown[],
  ): string | null {
    if (!severity) return null;
    if (severity === 'faible' || severity === 'moyen') {
      args.push(severity);
      return `${alias}.riskLevel=?`;
    }
    const score = `(SELECT MAX(ps.score) FROM prevention_priority_scores ps
      WHERE ps.organizationId=${alias}.organizationId
        AND ps.patternKey=${alias}.patternKey
        AND ps.missionType=${alias}.missionType
        AND ps.categoryKey=COALESCE(${alias}.categoryId,'UNCATEGORIZED')
        AND ps.findingType=${alias}.findingType)`;
    args.push(CRITICAL_PRIORITY_SCORE);
    return severity === 'critique'
      ? `${alias}.riskLevel='eleve' AND COALESCE(${score},0)>=?`
      : `${alias}.riskLevel='eleve' AND COALESCE(${score},0)<?`;
  }

  private findingFilters(
    q: PreventionQueryDto,
    period: Period,
    organizationId: string,
    args: unknown[] = [organizationId],
    alias = 'f',
  ): string[] {
    const where = [`${alias}.organizationId=?`];
    const dateClause = this.periodClause(period, `${alias}.businessDate`, args);
    if (dateClause) where.push(dateClause);
    if (q.missionType) { where.push(`${alias}.missionType=?`); args.push(q.missionType); }
    if (q.missionId || q.chantierId) { where.push(`${alias}.missionId=?`); args.push(q.missionId ?? q.chantierId); }
    if (q.categoryId) { where.push(`${alias}.categoryId=?`); args.push(q.categoryId); }
    if (q.riskLevel) { where.push(`${alias}.riskLevel=?`); args.push(q.riskLevel); }
    const severity = this.severityFilter(q.severity, alias, args);
    if (severity) where.push(severity);
    if (q.status) { where.push('r.status=?'); args.push(q.status); }
    return where;
  }

  private async dashboardDimensions(q: PreventionQueryDto, period: Period, organizationId: string) {
    const categoryArgs: unknown[] = this.periodArgs(period, organizationId);
    const categoryWhere = this.findingFilters(q, period, organizationId, categoryArgs);
    categoryWhere.push("f.findingType='OBSERVATION'");
    const priorityArgs: unknown[] = this.periodArgs(period, organizationId);
    const priorityWhere = this.findingFilters(q, period, organizationId, priorityArgs);
    priorityWhere.push("f.findingType='RECOMMENDATION'");
    const reportArgs: unknown[] = this.periodArgs(period, organizationId);
    const reportWhere = this.findingFilters(q, period, organizationId, reportArgs);
    const riskArgs: unknown[] = this.periodArgs(period, organizationId);
    const riskWhere = this.findingFilters(q, period, organizationId, riskArgs);
    riskWhere.push("f.findingType='OBSERVATION'");
    const phaseArgs: unknown[] = this.periodArgs(period, organizationId);
    const phaseWhere = ['g.organizationId=?'];
    const phaseDateClause = this.periodClause(period, 's.businessDate', phaseArgs);
    if (phaseDateClause) phaseWhere.push(phaseDateClause);
    if (q.missionType) { phaseWhere.push('s.missionType=?'); phaseArgs.push(q.missionType); }
    if (q.missionId || q.chantierId) { phaseWhere.push('s.missionId=?'); phaseArgs.push(q.missionId ?? q.chantierId); }
    if (q.status) { phaseWhere.push('r.status=?'); phaseArgs.push(q.status); }
    if (q.categoryId || q.riskLevel || q.severity) {
      const groupFindingWhere = [
        'f.organizationId=g.organizationId',
        'f.reportId=g.reportId',
        'f.visitId=g.visitId',
        'f.sourceGroupId=g.sourceGroupId',
        "f.findingType='OBSERVATION'",
      ];
      if (q.categoryId) { groupFindingWhere.push('f.categoryId=?'); phaseArgs.push(q.categoryId); }
      if (q.riskLevel) { groupFindingWhere.push('f.riskLevel=?'); phaseArgs.push(q.riskLevel); }
      const phaseSeverity = this.severityFilter(q.severity, 'f', phaseArgs);
      if (phaseSeverity) groupFindingWhere.push(phaseSeverity);
      phaseWhere.push(`EXISTS (SELECT 1 FROM prevention_findings f WHERE ${groupFindingWhere.join(' AND ')})`);
    }
    const [categoryRows, priorityRows, categoryRiskRows, scoreRows, missionTypeRows, conformityRows, missionRiskRows, topRiskRows, severityRows, missionCategoryRows, clientCategoryRows, phaseRows] = await Promise.all([
      this.db.query(
        `SELECT COALESCE(f.categoryId,'UNCATEGORIZED') categoryKey,f.categoryId,
          MAX(c.label) categoryLabel,COUNT(*) findingCount
         FROM prevention_findings f
         LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId
         LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
         WHERE ${categoryWhere.join(' AND ')}
         GROUP BY COALESCE(f.categoryId,'UNCATEGORIZED'),f.categoryId
         ORDER BY findingCount DESC,categoryKey ASC LIMIT 100`, categoryArgs,
      ),
      this.db.query(
        `SELECT id,content,reportId,reportTitle,categoryId,categoryLabel,riskLevel,severity,score,occurrenceCount,reportCount
         FROM (
           SELECT f.id,f.content,f.reportId,r.title reportTitle,f.categoryId,c.label categoryLabel,
             f.riskLevel,CASE WHEN f.riskLevel='eleve' AND p.score>=${CRITICAL_PRIORITY_SCORE}
               THEN 'critique' ELSE f.riskLevel END severity,
             p.score,p.occurrenceCount,p.reportCount,
             ROW_NUMBER() OVER (
               PARTITION BY f.patternKey,f.missionType,COALESCE(f.categoryId,'UNCATEGORIZED'),f.findingType
               ORDER BY f.businessDate DESC,f.id ASC
             ) priorityRank
           FROM prevention_findings f
           JOIN prevention_priority_scores p ON p.organizationId=f.organizationId
             AND p.patternKey=f.patternKey AND p.missionType=f.missionType
             AND p.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED') AND p.findingType=f.findingType
           LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId
           LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
           WHERE ${priorityWhere.join(' AND ')}
         ) ranked
         WHERE priorityRank=1
         ORDER BY score DESC,occurrenceCount DESC,reportCount DESC,id ASC
         LIMIT 5`, priorityArgs,
      ),
      this.db.query(
        `SELECT COALESCE(f.categoryId,'UNCATEGORIZED') categoryKey,f.categoryId,
          MAX(c.label) categoryLabel,
          SUM(f.riskLevel='faible') faibleCount,
          SUM(f.riskLevel='moyen') moyenCount,
          SUM(f.riskLevel='eleve') eleveCount
         FROM prevention_findings f
         LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId
         LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
         WHERE ${categoryWhere.join(' AND ')}
         GROUP BY COALESCE(f.categoryId,'UNCATEGORIZED'),f.categoryId
         ORDER BY eleveCount DESC,moyenCount DESC,categoryKey ASC LIMIT 20`, categoryArgs,
      ),
      this.db.query(
        `SELECT COUNT(*) prioritizedPatterns,COALESCE(ROUND(AVG(score),2),0) averageScore,COALESCE(MAX(score),0) maxScore
         FROM (
           SELECT DISTINCT p.patternKey,p.missionType,p.categoryKey,p.findingType,p.score
           FROM prevention_findings f
           JOIN prevention_priority_scores p ON p.organizationId=f.organizationId
             AND p.patternKey=f.patternKey AND p.missionType=f.missionType
             AND p.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED') AND p.findingType=f.findingType
           LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
           WHERE ${priorityWhere.join(' AND ')}
         ) scores`, priorityArgs,
      ),
      this.db.query(
        `SELECT f.missionType,COUNT(DISTINCT f.reportId) reportCount,COUNT(*) observationCount
         FROM prevention_findings f
         LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
         WHERE ${categoryWhere.join(' AND ')}
         GROUP BY f.missionType ORDER BY reportCount DESC,f.missionType ASC`, categoryArgs,
      ),
      this.db.query(
        `SELECT COUNT(NULLIF(conformityPercentage,0)) measuredReports,
          COALESCE(ROUND(AVG(NULLIF(conformityPercentage,0)),2),0) averageConformity
         FROM (
           SELECT DISTINCT r.id,r.conformityPercentage
           FROM prevention_findings f
           JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
           WHERE ${reportWhere.join(' AND ')}
         ) analyzedReports`, reportArgs,
      ),
      this.db.query(
        `SELECT f.missionId,MAX(m.title) missionTitle,
          SUM(f.riskLevel='faible') faibleCount,
          SUM(f.riskLevel='moyen') moyenCount,
          SUM(f.riskLevel='eleve') eleveCount
         FROM prevention_findings f
         JOIN missions m ON m.organizationId=f.organizationId AND m.id=f.missionId
         LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
         WHERE ${riskWhere.join(' AND ')}
         GROUP BY f.missionId
         ORDER BY eleveCount DESC,moyenCount DESC,missionTitle ASC LIMIT 20`, riskArgs,
      ),
      this.db.query(
        `SELECT id,content,danger,risk,reportId,reportTitle,riskLevel,severity,score,occurrenceCount,reportCount
         FROM (
           SELECT f.id,f.content,f.danger,f.risk,f.reportId,r.title reportTitle,
             f.riskLevel,CASE WHEN f.riskLevel='eleve' AND p.score>=${CRITICAL_PRIORITY_SCORE}
               THEN 'critique' ELSE f.riskLevel END severity,
             p.score,p.occurrenceCount,p.reportCount,
             ROW_NUMBER() OVER (
               PARTITION BY f.patternKey,f.missionType,COALESCE(f.categoryId,'UNCATEGORIZED'),f.findingType
               ORDER BY f.businessDate DESC,f.id ASC
             ) riskRank
           FROM prevention_findings f
           JOIN prevention_priority_scores p ON p.organizationId=f.organizationId
             AND p.patternKey=f.patternKey AND p.missionType=f.missionType
             AND p.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED') AND p.findingType=f.findingType
           LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
           WHERE ${riskWhere.join(' AND ')}
         ) rankedRisks
         WHERE riskRank=1
         ORDER BY score DESC,occurrenceCount DESC,reportCount DESC,id ASC
         LIMIT 5`, riskArgs,
      ),
      this.db.query(
        `SELECT severityCounts.riskLevel,severityCounts.count
         FROM (
           SELECT CASE WHEN f.riskLevel='eleve' AND COALESCE(p.score,0)>=${CRITICAL_PRIORITY_SCORE}
               THEN 'critique' ELSE f.riskLevel END riskLevel,COUNT(*) count
           FROM prevention_findings f
           LEFT JOIN prevention_priority_scores p ON p.organizationId=f.organizationId
             AND p.patternKey=f.patternKey AND p.missionType=f.missionType
             AND p.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED') AND p.findingType=f.findingType
           LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
           WHERE ${riskWhere.join(' AND ')}
           GROUP BY CASE WHEN f.riskLevel='eleve' AND COALESCE(p.score,0)>=${CRITICAL_PRIORITY_SCORE}
              THEN 'critique' ELSE f.riskLevel END
         ) severityCounts
         ORDER BY FIELD(severityCounts.riskLevel,'critique','eleve','moyen','faible')`, riskArgs,
      ),
      this.db.query(
        `SELECT f.missionId,MAX(m.title) missionTitle,f.categoryId,MAX(c.code) categoryCode,
          MAX(c.label) categoryLabel,COUNT(*) observationCount
         FROM prevention_findings f
         JOIN missions m ON m.organizationId=f.organizationId AND m.id=f.missionId
         LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId
         LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
         WHERE ${riskWhere.join(' AND ')}
         GROUP BY f.missionId,f.categoryId
         ORDER BY missionTitle ASC,categoryLabel ASC`, riskArgs,
      ),
      this.db.query(
        `SELECT COALESCE(NULLIF(TRIM(m.client),''),'Client non renseigné') client,
          f.categoryId,MAX(c.code) categoryCode,MAX(c.label) categoryLabel,COUNT(*) observationCount
         FROM prevention_findings f
         JOIN missions m ON m.organizationId=f.organizationId AND m.id=f.missionId
         LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId
         LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
         WHERE ${riskWhere.join(' AND ')}
         GROUP BY COALESCE(NULLIF(TRIM(m.client),''),'Client non renseigné'),f.categoryId
         ORDER BY client ASC,categoryLabel ASC`, riskArgs,
      ),
      this.db.query(
        `SELECT g.effectivePhase,COUNT(DISTINCT g.reportId) reportCount
         FROM prevention_analysis_groups g
         JOIN prevention_report_snapshots s ON s.organizationId=g.organizationId AND s.reportId=g.reportId
         JOIN reports r ON r.organizationId=g.organizationId AND r.id=g.reportId
         WHERE ${phaseWhere.join(' AND ')}
         GROUP BY g.effectivePhase
         ORDER BY FIELD(g.effectivePhase,'GROS_OEUVRE','STRUCTURE_CLOS_COUVERT','SECOND_OEUVRE','INSTALLATIONS_FINITIONS','INSTALLATION_ELECTRIQUE','FINITIONS_INTERIEURES','FINITIONS_EXTERIEURES')`, phaseArgs,
      ),
    ]);
    const scoreSummary = (scoreRows as any[])[0] ?? {};
    const conformitySummary = (conformityRows as any[])[0] ?? {};
    return {
      categoryBreakdown: (categoryRows as any[]).map((row) => ({
        categoryKey: row.categoryKey,
        categoryId: row.categoryId ?? null,
        categoryLabel: row.categoryLabel ?? null,
        findingCount: Number(row.findingCount ?? 0),
      })),
      topPriorities: (priorityRows as any[]).slice(0, 5).map((row) => ({
        id: row.id,
        content: row.content,
        categoryId: row.categoryId ?? null,
        categoryLabel: row.categoryLabel ?? null,
        riskLevel: row.riskLevel,
        severity: row.severity ?? row.riskLevel,
        score: Number(row.score ?? 0),
        occurrenceCount: Number(row.occurrenceCount ?? 0),
        reportCount: Number(row.reportCount ?? 0),
        reportId: row.reportId,
        reportTitle: row.reportTitle ?? null,
      })),
      categoryRiskMatrix: (categoryRiskRows as any[]).map((row) => ({
        categoryKey: row.categoryKey,
        categoryId: row.categoryId ?? null,
        categoryLabel: row.categoryLabel ?? null,
        faible: Number(row.faibleCount ?? 0),
        moyen: Number(row.moyenCount ?? 0),
        eleve: Number(row.eleveCount ?? 0),
      })),
      scoreSummary: {
        prioritizedPatterns: Number(scoreSummary.prioritizedPatterns ?? 0),
        averageScore: Number(scoreSummary.averageScore ?? 0),
        maxScore: Number(scoreSummary.maxScore ?? 0),
      },
      missionTypeBreakdown: (missionTypeRows as any[]).map((row) => ({
        missionType: row.missionType,
        reportCount: Number(row.reportCount ?? 0),
        observationCount: Number(row.observationCount ?? 0),
      })),
      conformitySummary: {
        measuredReports: Number(conformitySummary.measuredReports ?? 0),
        averageConformity: Number(conformitySummary.averageConformity ?? 0),
      },
      missionRiskMatrix: (missionRiskRows as any[]).map((row) => ({
        missionId: row.missionId,
        missionTitle: row.missionTitle ?? null,
        faible: Number(row.faibleCount ?? 0),
        moyen: Number(row.moyenCount ?? 0),
        eleve: Number(row.eleveCount ?? 0),
      })),
      missionCategoryMatrix: (missionCategoryRows as any[]).map((row) => ({
        missionId: row.missionId,
        missionTitle: row.missionTitle ?? null,
        categoryId: row.categoryId ?? null,
        categoryCode: row.categoryCode ?? null,
        categoryLabel: row.categoryLabel ?? null,
        observationCount: Number(row.observationCount ?? 0),
      })),
      clientCategoryMatrix: (clientCategoryRows as any[]).map((row) => ({
        client: row.client ?? 'Client non renseigné',
        categoryId: row.categoryId ?? null,
        categoryCode: row.categoryCode ?? null,
        categoryLabel: row.categoryLabel ?? null,
        observationCount: Number(row.observationCount ?? 0),
      })),
      phaseBreakdown: (phaseRows as any[]).map((row) => ({
        phase: row.effectivePhase,
        label: PREVENTION_PHASE_LABELS[row.effectivePhase as keyof typeof PREVENTION_PHASE_LABELS],
        reportCount: Number(row.reportCount ?? 0),
      })),
      riskBreakdown: (severityRows as any[]).map((row) => ({
        riskLevel: row.riskLevel,
        count: Number(row.count ?? 0),
      })),
      topRisks: (topRiskRows as any[]).map((row) => ({
        id: row.id,
        content: row.content,
        danger: row.danger ?? null,
        risk: row.risk ?? null,
        riskLevel: row.riskLevel,
        severity: row.severity ?? row.riskLevel,
        score: Number(row.score ?? 0),
        occurrenceCount: Number(row.occurrenceCount ?? 0),
        reportCount: Number(row.reportCount ?? 0),
        reportId: row.reportId,
        reportTitle: row.reportTitle ?? null,
      })),
    };
  }

  async dashboard(user: User, q: PreventionQueryDto) {
    const organizationId = await this.enabledOrg(user); const period = this.period(q);
    const dimensions = await this.dashboardDimensions(q, period, organizationId);
    const detailedFilter = Boolean(q.missionId || q.chantierId || q.status || q.categoryId || q.riskLevel || q.severity);
    if (detailedFilter) {
      const args: unknown[] = this.periodArgs(period, organizationId);
      const where = this.findingFilters(q, period, organizationId, args);
      const joins = " FROM prevention_findings f LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId WHERE " + where.join(" AND ");
      const [totals] = await this.db.query("SELECT COUNT(*) findings,SUM(f.findingType='OBSERVATION') observations,SUM(f.findingType='RECOMMENDATION') recommendations,COUNT(DISTINCT f.reportId) reports,COUNT(DISTINCT f.visitId) visits,COUNT(DISTINCT f.missionId) missions" + joins, args);
      return { period, source: "FILTERED_FINDINGS", totals: { findings: Number(totals?.findings ?? 0), observations: Number(totals?.observations ?? 0), recommendations: Number(totals?.recommendations ?? 0), reports: Number(totals?.reports ?? 0), visits: Number(totals?.visits ?? 0), missions: Number(totals?.missions ?? 0) }, ...dimensions };
    }
    const statArgs: unknown[] = this.periodArgs(period, organizationId);
    const statWhere = this.statFilters(q, period, "s", statArgs);
    const [findingTotals] = await this.db.query("SELECT COALESCE(SUM(s.findingCount),0) findings,COALESCE(SUM(CASE WHEN s.findingType='OBSERVATION' THEN s.findingCount ELSE 0 END),0) observations,COALESCE(SUM(CASE WHEN s.findingType='RECOMMENDATION' THEN s.findingCount ELSE 0 END),0) recommendations FROM prevention_daily_statistics s WHERE " + statWhere, statArgs);
    const snapshotArgs: unknown[] = this.periodArgs(period, organizationId);
    let snapshotWhere = "organizationId=?";
    const snapshotDateClause = this.periodClause(period, 'businessDate', snapshotArgs);
    if (snapshotDateClause) snapshotWhere += ` AND ${snapshotDateClause}`;
    if (q.missionType) { snapshotWhere += " AND missionType=?"; snapshotArgs.push(q.missionType); }
    const [sources] = await this.db.query("SELECT COUNT(*) reports,COUNT(DISTINCT visitId) visits,COUNT(DISTINCT missionId) missions FROM prevention_report_snapshots WHERE " + snapshotWhere, snapshotArgs);
    return { period, source: "MATERIALIZED", totals: { findings: Number(findingTotals?.findings ?? 0), observations: Number(findingTotals?.observations ?? 0), recommendations: Number(findingTotals?.recommendations ?? 0), reports: Number(sources?.reports ?? 0), visits: Number(sources?.visits ?? 0), missions: Number(sources?.missions ?? 0) }, ...dimensions };
  }

  private async listFindings(user: User, q: PreventionQueryDto, type: 'OBSERVATION' | 'RECOMMENDATION') {
    const organizationId = await this.enabledOrg(user); const period = this.period(q);
    const args: unknown[] = this.periodArgs(period, organizationId);
    const where: string[] = ['f.organizationId=?'];
    const dateClause = this.periodClause(period, 'f.businessDate', args);
    if (dateClause) where.push(dateClause);
    where.push('f.findingType=?');
    args.push(type);
    if (q.missionType) { where.push('f.missionType=?'); args.push(q.missionType); }
    if (q.missionId || q.chantierId) { where.push('f.missionId=?'); args.push(q.missionId ?? q.chantierId); }
    if (q.categoryId) { where.push('f.categoryId=?'); args.push(q.categoryId); }
    if (q.riskLevel) { where.push('f.riskLevel=?'); args.push(q.riskLevel); }
    const severityFilter = this.severityFilter(q.severity, 'f', args);
    if (severityFilter) where.push(severityFilter);
    if (q.status) { where.push('r.status=?'); args.push(q.status); }
    const page = Math.min(q.page ?? 1, 1000); const limit = Math.min(q.limit ?? 25, 100);
    const sort: Record<string, string> = { businessDate: 'f.businessDate', riskLevel: 'f.riskLevel', findingCount: 'p.occurrenceCount', occurrenceCount: 'p.occurrenceCount', score: 'p.score' };
    const clause = where.join(' AND ');
    if (type === 'RECOMMENDATION') {
      const [count] = await this.db.query(
        `SELECT COUNT(*) count FROM (
           SELECT f.patternKey,f.missionType,COALESCE(f.categoryId,'UNCATEGORIZED') categoryKey
           FROM prevention_findings f
           LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
           WHERE ${clause}
           GROUP BY f.patternKey,f.missionType,COALESCE(f.categoryId,'UNCATEGORIZED')
         ) recommendationPatterns`, args,
      );
      const outerSort: Record<string, string> = {
        businessDate: 'businessDate', riskLevel: 'riskLevel', findingCount: 'occurrenceCount',
        occurrenceCount: 'occurrenceCount', score: 'score',
      };
      const rows = await this.db.query(
        `SELECT id,content,danger,risk,riskLevel,severity,confidence,regulatoryReferences,businessDate,
          missionType,categoryId,categoryLabel,missionId,missionTitle,visitId,reportId,reportTitle,
          score,occurrenceCount,reportCount,visitCount
         FROM (
           SELECT f.id,f.content,f.danger,f.risk,f.riskLevel,
             CASE WHEN f.riskLevel='eleve' AND COALESCE(p.score,0)>=${CRITICAL_PRIORITY_SCORE}
               THEN 'critique' ELSE f.riskLevel END severity,
             f.confidence,f.regulatoryReferences,
             DATE_FORMAT(f.businessDate,'%Y-%m-%d') businessDate,f.missionType,f.categoryId,c.label categoryLabel,f.missionId,
             m.title missionTitle,f.visitId,f.reportId,r.title reportTitle,p.score,
             p.occurrenceCount,p.reportCount,p.visitCount,
             ROW_NUMBER() OVER (
               PARTITION BY f.patternKey,f.missionType,COALESCE(f.categoryId,'UNCATEGORIZED')
               ORDER BY f.businessDate DESC,f.id ASC
             ) patternRank
           FROM prevention_findings f
           LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId
           LEFT JOIN missions m ON m.organizationId=f.organizationId AND m.id=f.missionId
           LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
           LEFT JOIN prevention_priority_scores p ON p.organizationId=f.organizationId
             AND p.patternKey=f.patternKey AND p.missionType=f.missionType
             AND p.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED') AND p.findingType=f.findingType
           WHERE ${clause}
         ) rankedRecommendations
         WHERE patternRank=1
         ORDER BY ${outerSort[q.sortBy ?? 'businessDate']} ${q.sortOrder === 'asc' ? 'ASC' : 'DESC'},id ASC
         LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit],
      );
      return {
        items: rows.map((row: any) => ({ ...row, regulatoryReferences: parseRegulatoryReferences(row.regulatoryReferences) })),
        page, limit, total: Number(count?.count ?? 0), period,
      };
    }
    const [count] = await this.db.query(`SELECT COUNT(*) count FROM prevention_findings f LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId WHERE ${clause}`, args);
    const rows = await this.db.query(`SELECT f.id,f.content,f.danger,f.risk,f.riskLevel,
      CASE WHEN f.riskLevel='eleve' AND COALESCE(p.score,0)>=${CRITICAL_PRIORITY_SCORE}
        THEN 'critique' ELSE f.riskLevel END severity,
      f.confidence,f.regulatoryReferences,DATE_FORMAT(f.businessDate,'%Y-%m-%d') businessDate,f.missionType,f.categoryId,c.label categoryLabel,
      f.missionId,m.title missionTitle,f.visitId,f.reportId,r.title reportTitle,p.score,p.occurrenceCount,
      p.reportCount,p.visitCount
      FROM prevention_findings f
      LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId
      LEFT JOIN missions m ON m.organizationId=f.organizationId AND m.id=f.missionId
      LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId
      LEFT JOIN prevention_priority_scores p ON p.organizationId=f.organizationId
        AND p.patternKey=f.patternKey AND p.missionType=f.missionType
        AND p.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED') AND p.findingType=f.findingType
      WHERE ${clause}
      ORDER BY ${sort[q.sortBy ?? 'businessDate']} ${q.sortOrder === 'asc' ? 'ASC' : 'DESC'},f.id ASC
      LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);
    return { items: rows.map((row: any) => ({ ...row, regulatoryReferences: parseRegulatoryReferences(row.regulatoryReferences) })), page, limit, total: Number(count?.count ?? 0), period };
  }

  async findings(user: User, q: PreventionQueryDto) { return this.listFindings(user, q, 'OBSERVATION'); }
  async recommendations(user: User, q: PreventionQueryDto) { return this.listFindings(user, q, 'RECOMMENDATION'); }

  async categories(user: User) {
    const organizationId = await this.enabledOrg(user);
    const rows = await this.db.query(
      'SELECT id,code,label,color,displayOrder FROM prevention_categories WHERE organizationId=? AND isActive=1 ORDER BY displayOrder ASC,label ASC,id ASC',
      [organizationId],
    );
    return { items: rows.map((row: any) => ({ ...row, displayOrder: Number(row.displayOrder ?? 0) })) };
  }

  async trends(user: User, q: PreventionQueryDto) {
    const organizationId = await this.enabledOrg(user); const period = this.period(q, "LAST_12_MONTHS");
    const detailedFilter = Boolean(q.missionId || q.chantierId || q.status || q.categoryId || q.riskLevel || q.severity);
    const args: unknown[] = this.periodArgs(period, organizationId);
    const alias = detailedFilter ? "f" : "s";
    const where = [alias + ".organizationId=?"];
    const dateClause = this.periodClause(period, detailedFilter ? "f.businessDate" : "s.statDate", args);
    if (dateClause) where.push(dateClause);
    if (q.missionType) { where.push(alias + ".missionType=?"); args.push(q.missionType); }
    if (detailedFilter && (q.missionId || q.chantierId)) { where.push("f.missionId=?"); args.push(q.missionId ?? q.chantierId); }
    if (q.categoryId) { where.push(alias + ".categoryId=?"); args.push(q.categoryId); }
    if (q.riskLevel) { where.push(alias + ".riskLevel=?"); args.push(q.riskLevel); }
    if (detailedFilter) {
      const severityFilter = this.severityFilter(q.severity, 'f', args);
      if (severityFilter) where.push(severityFilter);
    }
    if (detailedFilter && q.status) { where.push("r.status=?"); args.push(q.status); }
    const dateColumn = detailedFilter ? "f.businessDate" : "s.statDate";
    const bucket = period.granularity === "day" ? "DATE_FORMAT(" + dateColumn + ",'%Y-%m-%d')" : period.granularity === "week" ? "DATE_FORMAT(DATE_SUB(" + dateColumn + ",INTERVAL WEEKDAY(" + dateColumn + ") DAY),'%Y-%m-%d')" : "DATE_FORMAT(" + dateColumn + ",'%Y-%m-01')";
    if (detailedFilter) {
      const items = await this.db.query("SELECT " + bucket + " bucket,COUNT(*) findingCount,SUM(f.findingType='OBSERVATION') observationCount,COUNT(DISTINCT f.reportId) reportCount,COUNT(DISTINCT f.visitId) visitCount FROM prevention_findings f LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId WHERE " + where.join(" AND ") + " GROUP BY " + bucket + " ORDER BY bucket ASC LIMIT " + MAX_TREND_BUCKETS, args);
      return { period, source: "FILTERED_FINDINGS", items: items.map((row: any) => ({ bucket: row.bucket, findingCount: Number(row.findingCount), observationCount: Number(row.observationCount), reportCount: Number(row.reportCount), visitCount: Number(row.visitCount) })) };
    }

    // findingCount is additive in daily statistics. Reports and visits are not:
    // one source can occupy several category/risk/finding-type rows on the same day.
    const findingRows = await this.db.query("SELECT " + bucket + " bucket,SUM(s.findingCount) findingCount,SUM(CASE WHEN s.findingType='OBSERVATION' THEN s.findingCount ELSE 0 END) observationCount FROM prevention_daily_statistics s WHERE " + where.join(" AND ") + " GROUP BY " + bucket + " ORDER BY bucket ASC LIMIT " + MAX_TREND_BUCKETS, args);
    const snapshotArgs: unknown[] = this.periodArgs(period, organizationId);
    const snapshotWhere = ["p.organizationId=?"];
    const snapshotDateClause = this.periodClause(period, "p.businessDate", snapshotArgs);
    if (snapshotDateClause) snapshotWhere.push(snapshotDateClause);
    if (q.missionType) { snapshotWhere.push("p.missionType=?"); snapshotArgs.push(q.missionType); }
    const snapshotDate = "p.businessDate";
    const snapshotBucket = period.granularity === "day" ? "DATE_FORMAT(" + snapshotDate + ",'%Y-%m-%d')" : period.granularity === "week" ? "DATE_FORMAT(DATE_SUB(" + snapshotDate + ",INTERVAL WEEKDAY(" + snapshotDate + ") DAY),'%Y-%m-%d')" : "DATE_FORMAT(" + snapshotDate + ",'%Y-%m-01')";
    const sourceRows = await this.db.query("SELECT " + snapshotBucket + " bucket,COUNT(DISTINCT p.reportId) reportCount,COUNT(DISTINCT p.visitId) visitCount FROM prevention_report_snapshots p WHERE " + snapshotWhere.join(" AND ") + " GROUP BY " + snapshotBucket + " ORDER BY bucket ASC LIMIT " + MAX_TREND_BUCKETS, snapshotArgs);
    const byBucket = new Map<string, { bucket: unknown; findingCount: number; observationCount: number; reportCount: number; visitCount: number }>();
    for (const row of findingRows) byBucket.set(String(row.bucket), { bucket: row.bucket, findingCount: Number(row.findingCount), observationCount: Number(row.observationCount), reportCount: 0, visitCount: 0 });
    for (const row of sourceRows) {
      const key = String(row.bucket); const item = byBucket.get(key) ?? { bucket: row.bucket, findingCount: 0, observationCount: 0, reportCount: 0, visitCount: 0 };
      item.reportCount = Number(row.reportCount); item.visitCount = Number(row.visitCount); byBucket.set(key, item);
    }
    return { period, source: "MATERIALIZED", items: [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))).slice(0, MAX_TREND_BUCKETS) };
  }

  async references(user: User, q: PreventionQueryDto) {
    const organizationId = await this.enabledOrg(user); const period = this.period(q);
    const args: unknown[] = this.periodArgs(period, organizationId);
    const where = ["f.organizationId=?"];
    const dateClause = this.periodClause(period, "f.businessDate", args);
    if (dateClause) where.push(dateClause);
    if (q.missionType) { where.push("f.missionType=?"); args.push(q.missionType); }
    if (q.categoryId) { where.push("f.categoryId=?"); args.push(q.categoryId); }
    if (q.riskLevel) { where.push("f.riskLevel=?"); args.push(q.riskLevel); }
    const severityFilter = this.severityFilter(q.severity, 'f', args);
    if (severityFilter) where.push(severityFilter);
    if (q.missionId || q.chantierId) { where.push("f.missionId=?"); args.push(q.missionId ?? q.chantierId); }
    if (q.status) { where.push("r.status=?"); args.push(q.status); }
    const joins = " FROM prevention_findings f JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId JOIN missions m ON m.organizationId=f.organizationId AND m.id=f.missionId LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId WHERE " + where.join(" AND ");
    const [count] = await this.db.query("SELECT COUNT(DISTINCT f.reportId) count" + joins, args);
    const page = Math.min(q.page ?? 1, 1000); const limit = Math.min(q.limit ?? 25, 100);
    const rows = await this.db.query(
      "SELECT f.reportId,r.title,r.reportFileUrl,r.status,f.visitId,f.missionId,m.title chantierTitle,DATE_FORMAT(MIN(f.businessDate),'%Y-%m-%d') businessDate,COUNT(*) findingCount" + joins +
      " GROUP BY f.reportId,r.title,r.reportFileUrl,r.status,f.visitId,f.missionId,m.title ORDER BY businessDate DESC,f.reportId ASC LIMIT ? OFFSET ?",
      [...args, limit, (page - 1) * limit],
    );
    const regulatoryRows = await this.db.query(
      `SELECT f.reportId,r.title reportTitle,r.reportFileUrl,f.regulatoryReferences,c.label categoryLabel,
        CASE WHEN f.riskLevel='eleve' AND COALESCE((SELECT MAX(ps.score)
          FROM prevention_priority_scores ps
          WHERE ps.organizationId=f.organizationId AND ps.patternKey=f.patternKey
            AND ps.missionType=f.missionType AND ps.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED')
            AND ps.findingType=f.findingType),0)>=${CRITICAL_PRIORITY_SCORE}
          THEN 'critique' ELSE f.riskLevel END severity` + joins + " ORDER BY f.reportId ASC LIMIT ?",
      [...args, MAX_REGULATORY_ROWS],
    );
    const regulatoryMap = new Map<string, { reference: string; citationCount: number; reportIds: Set<string>; domains: Set<string>; riskLevels: Set<string>; reports: Map<string, { id: string; title: string | null }> }>();
    for (const row of regulatoryRows as any[]) {
      for (const reference of parseRegulatoryReferences(row.regulatoryReferences)) {
        if (!regulatoryMap.has(reference)) {
          if (regulatoryMap.size >= MAX_REGULATORY_ITEMS) continue;
          regulatoryMap.set(reference, { reference, citationCount: 0, reportIds: new Set(), domains: new Set(), riskLevels: new Set(), reports: new Map() });
        }
        const item = regulatoryMap.get(reference)!;
        item.citationCount += 1;
        if (row.reportId) item.reportIds.add(String(row.reportId));
        if (row.categoryLabel) item.domains.add(String(row.categoryLabel));
        if (row.severity) item.riskLevels.add(String(row.severity));
        if (row.reportId && item.reports.size < MAX_REGULATORY_REPORTS) {
          item.reports.set(String(row.reportId), { id: String(row.reportId), title: row.reportTitle ?? null });
        }
      }
    }
    const regulatoryItems = [...regulatoryMap.values()]
      .map((item) => ({
        reference: item.reference,
        citationCount: item.citationCount,
        reportCount: item.reportIds.size,
        domains: [...item.domains].slice(0, 10),
        riskLevels: [...item.riskLevels]
          .sort((left, right) => ['critique', 'eleve', 'moyen', 'faible'].indexOf(left) - ['critique', 'eleve', 'moyen', 'faible'].indexOf(right))
          .slice(0, 4),
        reports: [...item.reports.values()],
      }))
      .sort((left, right) => right.citationCount - left.citationCount || left.reference.localeCompare(right.reference));
    return { period, page, limit, total: Number(count?.count ?? 0), items: rows.map((row: any) => ({ ...row, findingCount: Number(row.findingCount), reportRoute: "/reports/" + row.reportId })), regulatoryItems };
  }

  async rebuildPreview(user: User) { return this.rebuilds.preview(await this.enabledOrg(user)); }

  async rebuild(user: User, dto: PreventionRebuildConfirmDto) {
    if (!dto?.previewToken) throw new BadRequestException('Confirmez la prévisualisation de reconstruction');
    return this.rebuilds.admit(await this.enabledOrg(user), dto.previewToken);
  }

  async job(user: User, id: string) {
    const organizationId = await this.enabledOrg(user);
    const [row] = await this.db.query(`SELECT r.id,r.status,r.createdAt,r.updatedAt,r.lastError,r.scheduledFor,r.availableAt,
      r.reportCount,r.findingCount,r.immediateLimit,r.executionMode,
      c.processedReports,c.pendingJobs,c.scanComplete,c.failedJobs
      FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id
      WHERE r.id=? AND c.organizationId=? AND r.jobType='MANUAL_REBUILD' LIMIT 1`, [id, organizationId]);
    if (!row) throw new NotFoundException('Job introuvable');
    return {
      id: row.id, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
      scheduledFor: row.scheduledFor, availableAt: row.availableAt,
      reportCount: Number(row.reportCount ?? 0), findingCount: Number(row.findingCount ?? 0),
      immediateLimit: Number(row.immediateLimit ?? 0), executionMode: row.executionMode,
      progress: { processedReports: Number(row.processedReports ?? 0), pendingJobs: Number(row.pendingJobs ?? 0), scanComplete: Boolean(row.scanComplete), failedJobs: Number(row.failedJobs ?? 0) },
      error: row.status === 'FAILED' ? row.lastError : null,
    };
  }
}
