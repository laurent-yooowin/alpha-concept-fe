import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../../user/user.entity';
import { PreventionQueryDto } from './prevention-api.dto';
import { PreventionRebuildQueueService } from './prevention-rebuild-queue.service';

type Period = { from: string; to: string; granularity: 'day' | 'week' | 'month' };

@Injectable()
export class PreventionApiService {
  constructor(private readonly db: DataSource, private readonly rebuilds: PreventionRebuildQueueService) {}

  private org(user: User): string {
    if (!user || user.role !== UserRole.ADMIN || !user.organizationId) {
      throw new ForbiddenException('Prévention accessible uniquement aux administrateurs d’organisation');
    }
    return user.organizationId;
  }

  private period(q: PreventionQueryDto, defaultPreset: PreventionQueryDto["preset"] = "LAST_30_DAYS"): Period {
    const explicitFrom = (q.from ?? q.startDate)?.slice(0, 10);
    const explicitTo = (q.to ?? q.endDate)?.slice(0, 10);
    const preset = q.preset ?? defaultPreset;
    if (preset === "CUSTOM" && (!explicitFrom || !explicitTo)) throw new BadRequestException("La période personnalisée exige from et to");
    const today = new Date();
    const end = explicitTo ? new Date(explicitTo + "T00:00:00.000Z") : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    let start = explicitFrom ? new Date(explicitFrom + "T00:00:00.000Z") : new Date(end);
    if (!explicitFrom) {
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
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), granularity: days <= 90 ? "day" : days <= 365 ? "week" : "month" };
  }

  private statFilters(q: PreventionQueryDto, alias: string, args: unknown[]): string {
    const clauses = [`${alias}.organizationId=?`, `${alias}.statDate BETWEEN ? AND ?`];
    if (q.missionType) { clauses.push(`${alias}.missionType=?`); args.push(q.missionType); }
    if (q.categoryId) { clauses.push(`${alias}.categoryId=?`); args.push(q.categoryId); }
    if (q.riskLevel) { clauses.push(`${alias}.riskLevel=?`); args.push(q.riskLevel); }
    return clauses.join(' AND ');
  }

  async dashboard(user: User, q: PreventionQueryDto) {
    const organizationId = this.org(user); const period = this.period(q);
    const detailedFilter = Boolean(q.missionId || q.chantierId || q.status || q.categoryId || q.riskLevel);
    if (detailedFilter) {
      const args: unknown[] = [organizationId, period.from, period.to];
      const where = ["f.organizationId=?", "f.businessDate BETWEEN ? AND ?"];
      if (q.missionType) { where.push("f.missionType=?"); args.push(q.missionType); }
      if (q.missionId || q.chantierId) { where.push("f.missionId=?"); args.push(q.missionId ?? q.chantierId); }
      if (q.categoryId) { where.push("f.categoryId=?"); args.push(q.categoryId); }
      if (q.riskLevel) { where.push("f.riskLevel=?"); args.push(q.riskLevel); }
      if (q.status) { where.push("r.status=?"); args.push(q.status); }
      const joins = " FROM prevention_findings f LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId WHERE " + where.join(" AND ");
      const [totals] = await this.db.query("SELECT COUNT(*) findings,COUNT(DISTINCT f.reportId) reports,COUNT(DISTINCT f.visitId) visits,COUNT(DISTINCT f.missionId) missions" + joins, args);
      const risks = await this.db.query("SELECT f.riskLevel,COUNT(*) count" + joins + " GROUP BY f.riskLevel ORDER BY count DESC", args);
      return { period, source: "FILTERED_FINDINGS", totals: { findings: Number(totals?.findings ?? 0), reports: Number(totals?.reports ?? 0), visits: Number(totals?.visits ?? 0), missions: Number(totals?.missions ?? 0) }, riskBreakdown: risks.map((row: any) => ({ riskLevel: row.riskLevel, count: Number(row.count) })) };
    }
    const statArgs: unknown[] = [organizationId, period.from, period.to];
    const statWhere = this.statFilters(q, "s", statArgs);
    const [findingTotals] = await this.db.query("SELECT COALESCE(SUM(s.findingCount),0) findings FROM prevention_daily_statistics s WHERE " + statWhere, statArgs);
    const risks = await this.db.query("SELECT s.riskLevel,COALESCE(SUM(s.findingCount),0) count FROM prevention_daily_statistics s WHERE " + statWhere + " GROUP BY s.riskLevel ORDER BY count DESC", statArgs);
    const snapshotArgs: unknown[] = [organizationId, period.from, period.to];
    let snapshotWhere = "organizationId=? AND businessDate BETWEEN ? AND ?";
    if (q.missionType) { snapshotWhere += " AND missionType=?"; snapshotArgs.push(q.missionType); }
    const [sources] = await this.db.query("SELECT COUNT(*) reports,COUNT(DISTINCT visitId) visits,COUNT(DISTINCT missionId) missions FROM prevention_report_snapshots WHERE " + snapshotWhere, snapshotArgs);
    return { period, source: "MATERIALIZED", totals: { findings: Number(findingTotals?.findings ?? 0), reports: Number(sources?.reports ?? 0), visits: Number(sources?.visits ?? 0), missions: Number(sources?.missions ?? 0) }, riskBreakdown: risks.map((row: any) => ({ riskLevel: row.riskLevel, count: Number(row.count) })) };
  }

  private async listFindings(user: User, q: PreventionQueryDto, type: 'OBSERVATION' | 'RECOMMENDATION') {
    const organizationId = this.org(user); const period = this.period(q);
    const args: unknown[] = [organizationId, period.from, period.to, type];
    const where: string[] = ['f.organizationId=?', 'f.businessDate BETWEEN ? AND ?', 'f.findingType=?'];
    if (q.missionType) { where.push('f.missionType=?'); args.push(q.missionType); }
    if (q.missionId || q.chantierId) { where.push('f.missionId=?'); args.push(q.missionId ?? q.chantierId); }
    if (q.categoryId) { where.push('f.categoryId=?'); args.push(q.categoryId); }
    if (q.riskLevel) { where.push('f.riskLevel=?'); args.push(q.riskLevel); }
    if (q.status) { where.push('r.status=?'); args.push(q.status); }
    const page = Math.min(q.page ?? 1, 1000); const limit = Math.min(q.limit ?? 25, 100);
    const sort: Record<string, string> = { businessDate: 'f.businessDate', riskLevel: 'f.riskLevel', findingCount: 'p.occurrenceCount', occurrenceCount: 'p.occurrenceCount', score: 'p.score' };
    const clause = where.join(' AND ');
    const [count] = await this.db.query(`SELECT COUNT(*) count FROM prevention_findings f LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId WHERE ${clause}`, args);
    const rows = await this.db.query('SELECT f.id,f.content,f.danger,f.risk,f.riskLevel,f.confidence,f.businessDate,f.missionType,f.categoryId,c.label categoryLabel,f.missionId,f.visitId,f.reportId,p.score,p.occurrenceCount,p.reportCount,p.visitCount FROM prevention_findings f LEFT JOIN prevention_categories c ON c.organizationId=f.organizationId AND c.id=f.categoryId LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId LEFT JOIN prevention_priority_scores p ON p.organizationId=f.organizationId AND p.patternKey=f.patternKey AND p.missionType=f.missionType AND p.categoryKey=COALESCE(f.categoryId,\'UNCATEGORIZED\') AND p.findingType=f.findingType WHERE ' + clause + ' ORDER BY ' + sort[q.sortBy ?? 'businessDate'] + ' ' + (q.sortOrder === 'asc' ? 'ASC' : 'DESC') + ',f.id ASC LIMIT ? OFFSET ?', [...args, limit, (page - 1) * limit]);
    return { items: rows, page, limit, total: Number(count?.count ?? 0), period };
  }

  async findings(user: User, q: PreventionQueryDto) { return this.listFindings(user, q, 'OBSERVATION'); }
  async recommendations(user: User, q: PreventionQueryDto) { return this.listFindings(user, q, 'RECOMMENDATION'); }

  async trends(user: User, q: PreventionQueryDto) {
    const organizationId = this.org(user); const period = this.period(q, "LAST_12_MONTHS");
    const detailedFilter = Boolean(q.missionId || q.chantierId || q.status || q.categoryId || q.riskLevel);
    const args: unknown[] = [organizationId, period.from, period.to];
    const alias = detailedFilter ? "f" : "s";
    const where = [alias + ".organizationId=?", (detailedFilter ? "f.businessDate" : "s.statDate") + " BETWEEN ? AND ?"];
    if (q.missionType) { where.push(alias + ".missionType=?"); args.push(q.missionType); }
    if (detailedFilter && (q.missionId || q.chantierId)) { where.push("f.missionId=?"); args.push(q.missionId ?? q.chantierId); }
    if (q.categoryId) { where.push(alias + ".categoryId=?"); args.push(q.categoryId); }
    if (q.riskLevel) { where.push(alias + ".riskLevel=?"); args.push(q.riskLevel); }
    if (detailedFilter && q.status) { where.push("r.status=?"); args.push(q.status); }
    const dateColumn = detailedFilter ? "f.businessDate" : "s.statDate";
    const bucket = period.granularity === "day" ? dateColumn : period.granularity === "week" ? "DATE_SUB(" + dateColumn + ",INTERVAL WEEKDAY(" + dateColumn + ") DAY)" : "DATE_FORMAT(" + dateColumn + ",'%Y-%m-01')";
    if (detailedFilter) {
      const items = await this.db.query("SELECT " + bucket + " bucket,COUNT(*) findingCount,COUNT(DISTINCT f.reportId) reportCount,COUNT(DISTINCT f.visitId) visitCount FROM prevention_findings f LEFT JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId WHERE " + where.join(" AND ") + " GROUP BY " + bucket + " ORDER BY bucket ASC", args);
      return { period, source: "FILTERED_FINDINGS", items: items.map((row: any) => ({ bucket: row.bucket, findingCount: Number(row.findingCount), reportCount: Number(row.reportCount), visitCount: Number(row.visitCount) })) };
    }

    // findingCount is additive in daily statistics. Reports and visits are not:
    // one source can occupy several category/risk/finding-type rows on the same day.
    const findingRows = await this.db.query("SELECT " + bucket + " bucket,SUM(s.findingCount) findingCount FROM prevention_daily_statistics s WHERE " + where.join(" AND ") + " GROUP BY " + bucket + " ORDER BY bucket ASC", args);
    const snapshotArgs: unknown[] = [organizationId, period.from, period.to];
    const snapshotWhere = ["p.organizationId=?", "p.businessDate BETWEEN ? AND ?"];
    if (q.missionType) { snapshotWhere.push("p.missionType=?"); snapshotArgs.push(q.missionType); }
    const snapshotDate = "p.businessDate";
    const snapshotBucket = period.granularity === "day" ? snapshotDate : period.granularity === "week" ? "DATE_SUB(" + snapshotDate + ",INTERVAL WEEKDAY(" + snapshotDate + ") DAY)" : "DATE_FORMAT(" + snapshotDate + ",'%Y-%m-01')";
    const sourceRows = await this.db.query("SELECT " + snapshotBucket + " bucket,COUNT(DISTINCT p.reportId) reportCount,COUNT(DISTINCT p.visitId) visitCount FROM prevention_report_snapshots p WHERE " + snapshotWhere.join(" AND ") + " GROUP BY " + snapshotBucket + " ORDER BY bucket ASC", snapshotArgs);
    const byBucket = new Map<string, { bucket: unknown; findingCount: number; reportCount: number; visitCount: number }>();
    for (const row of findingRows) byBucket.set(String(row.bucket), { bucket: row.bucket, findingCount: Number(row.findingCount), reportCount: 0, visitCount: 0 });
    for (const row of sourceRows) {
      const key = String(row.bucket); const item = byBucket.get(key) ?? { bucket: row.bucket, findingCount: 0, reportCount: 0, visitCount: 0 };
      item.reportCount = Number(row.reportCount); item.visitCount = Number(row.visitCount); byBucket.set(key, item);
    }
    return { period, source: "MATERIALIZED", items: [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))) };
  }

  async references(user: User, q: PreventionQueryDto) {
    const organizationId = this.org(user); const period = this.period(q);
    const args: unknown[] = [organizationId, period.from, period.to];
    const where = ["f.organizationId=?", "f.businessDate BETWEEN ? AND ?"];
    if (q.missionType) { where.push("f.missionType=?"); args.push(q.missionType); }
    if (q.categoryId) { where.push("f.categoryId=?"); args.push(q.categoryId); }
    if (q.riskLevel) { where.push("f.riskLevel=?"); args.push(q.riskLevel); }
    if (q.missionId || q.chantierId) { where.push("f.missionId=?"); args.push(q.missionId ?? q.chantierId); }
    if (q.status) { where.push("r.status=?"); args.push(q.status); }
    const joins = " FROM prevention_findings f JOIN reports r ON r.organizationId=f.organizationId AND r.id=f.reportId JOIN missions m ON m.organizationId=f.organizationId AND m.id=f.missionId WHERE " + where.join(" AND ");
    const [count] = await this.db.query("SELECT COUNT(DISTINCT f.reportId) count" + joins, args);
    const page = Math.min(q.page ?? 1, 1000); const limit = Math.min(q.limit ?? 25, 100);
    const rows = await this.db.query(
      "SELECT f.reportId,r.title,r.reportFileUrl,r.status,f.visitId,f.missionId,m.title chantierTitle,MIN(f.businessDate) businessDate,COUNT(*) findingCount" + joins +
      " GROUP BY f.reportId,r.title,r.reportFileUrl,r.status,f.visitId,f.missionId,m.title ORDER BY businessDate DESC,f.reportId ASC LIMIT ? OFFSET ?",
      [...args, limit, (page - 1) * limit],
    );
    return { period, page, limit, total: Number(count?.count ?? 0), items: rows.map((row: any) => ({ ...row, findingCount: Number(row.findingCount), reportRoute: "/reports/" + row.reportId })) };
  }

  async rebuild(user: User) { return this.rebuilds.enqueue(this.org(user)); }

  async job(user: User, id: string) {
    const organizationId = this.org(user);
    const [row] = await this.db.query(`SELECT r.id,r.status,r.createdAt,r.updatedAt,r.lastError,c.processedReports,c.scanComplete,c.failedJobs FROM prevention_scheduler_runs r JOIN prevention_scheduler_checkpoints c ON c.runId=r.id WHERE r.id=? AND c.organizationId=? AND r.jobType='MANUAL_REBUILD' LIMIT 1`, [id, organizationId]);
    if (!row) throw new NotFoundException('Job introuvable');
    return { id: row.id, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, progress: { processedReports: Number(row.processedReports ?? 0), scanComplete: Boolean(row.scanComplete), failedJobs: Number(row.failedJobs ?? 0) }, error: row.status === 'FAILED' ? row.lastError : null };
  }
}
