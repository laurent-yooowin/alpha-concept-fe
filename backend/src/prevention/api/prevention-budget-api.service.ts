import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { User, UserRole } from '../../user/user.entity';
import { loadPreventionBudgetSourceVersion, PreventionBudgetService, preventionBudgetAnnualScenarioKey as canonicalPreventionBudgetAnnualScenarioKey, preventionBudgetScopeKey as canonicalPreventionBudgetScopeKey, preventionBudgetSourceKey, preventionBudgetStableRecommendationKey } from '../budget/prevention-budget.service';
import { budgetActionGroup } from '../budget/prevention-budget-grouping';
import { PreventionActivationService } from '../prevention-activation.service';
import { PreventionBulkAdmissionService } from '../scheduler/prevention-bulk-admission.service';
import { isWithinPreventionBulkWindow, loadPreventionBulkConfiguration, nextPreventionBulkWindowStart, preventionBulkWindowKey } from '../scheduler/prevention-bulk.config';
import { budgetClientActionKey, budgetClientIdentity, parseBudgetClientKeys, storedBudgetClientKeys } from '../budget/prevention-budget-client';
import { formatCents, parseCents } from '../budget/prevention-budget.calculator';
import { consolidateMaterializedBudgetRows, excludeSupersededUnpricedBudgetRows, materializedActionScopeKey, sumAvailableMaterializedBudgetRows } from '../budget/prevention-budget-materialized';
import {
  PreventionBudgetCreateDto, PreventionBudgetItemPatchDto, PreventionBudgetListQueryDto,
  PreventionBudgetItemRecalculateDto, PreventionBudgetPatchDto, PreventionBudgetRecalculateDto, PreventionBudgetScopeDto, PreventionBudgetSourceDto,
  PreventionCostCatalogCreateDto, PreventionCostCatalogStatusDto,
  PreventionBudgetCommandDto, PreventionBudgetExecutionModeDto, PreventionBudgetPreviewDto,
} from './prevention-budget.dto';

const MONEY = /^\d{1,16}(?:\.\d{1,2})?$/;
const QUANTITY = /^\d{1,14}(?:\.\d{1,4})?$/;
const LOCKED = new Set(['VALIDE', 'ENGAGE', 'REALISE']);
const LEGACY_BUDGET_CALCULATION_MESSAGE = 'Ce calcul doit passer par la prévisualisation et la commande budgétaires';

type Db = DataSource | { query: (sql: string, args?: unknown[]) => Promise<any[]> };

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function storedScopeArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('Invalid stored Prevention budget scope');
  }
  return [...new Set(parsed.map((item: string) => item.trim()))];
}
function deterministicUuid(value: string): string {
  const hex = digest(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function todayKey(): string { return new Date().toISOString(); }

function budgetLineTotal(quantity: string, unitCostHt: string | null): string {
  if (unitCostHt === null) return '0.00';
  const [whole, fraction = ''] = quantity.split('.');
  const units = BigInt(whole) * 10_000n + BigInt((fraction + '0000').slice(0, 4));
  return formatCents((units * parseCents(unitCostHt) + 5_000n) / 10_000n);
}

function currentParisYear(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric' }).format(now));
}

function currentParisDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function budgetSeverityPreviewPredicate(value: string): { sql: string; args: unknown[] } {
  if (value === 'faible' || value === 'moyen') return { sql: 'AND f.riskLevel=?', args: [value] };
  const score = `(SELECT MAX(ps.score) FROM prevention_priority_scores ps
    WHERE ps.organizationId=f.organizationId AND ps.patternKey=f.patternKey
      AND ps.missionType=f.missionType AND ps.categoryKey=COALESCE(f.categoryId,'UNCATEGORIZED')
      AND ps.findingType=f.findingType)`;
  return { sql: `AND f.riskLevel='eleve' AND COALESCE(${score},0)${value === 'critique' ? '>=' : '<'}?`, args: [80] };
}

function budgetSeverityPreviewPredicates(values: string[] | undefined): { sql: string; args: unknown[] } {
  const selected = [...new Set(values ?? [])];
  if (!selected.length) return { sql: '', args: [] };
  const parts = selected.map((value) => budgetSeverityPreviewPredicate(value).sql.replace(/^AND\s+/, ''));
  const args = selected.flatMap((value) => budgetSeverityPreviewPredicate(value).args);
  return { sql: `AND (${parts.join(' OR ')})`, args };
}

function actionSeverityPredicate(values: string[]): { sql: string; args: unknown[] } {
  return budgetSeverityPreviewPredicates(values);
}

/**
 * Shared recommendation scope predicate for budget counters and workload
 * previews. The denominator shown beside materialized lines must describe
 * the same recommendation/report population as the preview (not every report
 * in the selected tenant or chantier).
 */
function budgetRecommendationScopePredicate(
  period: { start: string | null; end: string | null; periodMode: PreventionBudgetPeriodMode },
  categoryIds: string[],
  severities: string[],
  missionIds: string[],
  clientPredicate: { sql: string; args: unknown[] },
): { sql: string; args: unknown[] } {
  const date = period.periodMode === 'BOUNDED'
    ? (() => {
      const exclusiveEnd = new Date(`${period.end}T00:00:00.000Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      return { sql: 'AND f.businessDate>=? AND f.businessDate<?', args: [period.start, exclusiveEnd.toISOString().slice(0, 10)] };
    })()
    : { sql: '', args: [] as unknown[] };
  const severity = budgetSeverityPreviewPredicates(severities);
  return {
    sql: `${date.sql} ${categoryIds.length ? 'AND f.categoryId IN (?)' : ''} ${severity.sql} ${missionIds.length ? 'AND f.missionId IN (?)' : ''} ${clientPredicate.sql}`,
    args: [
      ...date.args,
      ...(categoryIds.length ? [categoryIds] : []),
      ...severity.args,
      ...(missionIds.length ? [missionIds] : []),
      ...clientPredicate.args,
    ],
  };
}

// MySQL DATE is a calendar day, not an instant. mysql2 may return a Date at
// local midnight; JSON serialization would otherwise shift it to the prior
// UTC day for Europe/Paris and similar timezones.
export function budgetCalendarDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid budget calendar date');
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

export function resolveBudgetScopePeriod(dto: PreventionBudgetScopeDto, now = new Date()): { start: string; end: string } {
  if (dto.preset === 'CUSTOM' && (!dto.from || !dto.to)) throw new BadRequestException('La période personnalisée exige from et to');
  const end = dto.preset === 'CUSTOM' ? new Date(`${dto.to!.slice(0, 10)}T00:00:00.000Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start = dto.preset === 'CUSTOM' ? new Date(`${dto.from!.slice(0, 10)}T00:00:00.000Z`) : new Date(end);
  if (dto.preset === 'ALL') start.setUTCFullYear(start.getUTCFullYear() - 10);
  else if (dto.preset === 'LAST_7_DAYS') start.setUTCDate(start.getUTCDate() - 6);
  else if (dto.preset === 'CURRENT_QUARTER') start = new Date(Date.UTC(end.getUTCFullYear(), Math.floor(end.getUTCMonth() / 3) * 3, 1));
  else if (dto.preset === 'LAST_6_MONTHS') start.setUTCMonth(start.getUTCMonth() - 6);
  else if (dto.preset === 'CURRENT_YEAR') start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  else if (dto.preset === 'LAST_12_MONTHS') start.setUTCMonth(start.getUTCMonth() - 12);
  else if (dto.preset === 'LAST_30_DAYS') start.setUTCDate(start.getUTCDate() - 29);
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 3661) throw new BadRequestException('Période budgétaire invalide');
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export type PreventionBudgetPeriodMode = 'BOUNDED' | 'ALL';

export function resolveBudgetPeriod(dto: PreventionBudgetScopeDto | PreventionBudgetPreviewDto, now = new Date()): {
  start: string | null; end: string | null; periodMode: PreventionBudgetPeriodMode;
} {
  if ('mode' in dto) {
    if (dto.mode === PreventionBudgetExecutionModeDto.GLOBAL_YEARLY) {
      if (dto.preset && dto.preset !== 'ALL') throw new BadRequestException('GLOBAL_YEARLY exige le périmètre ALL');
      return { start: null, end: null, periodMode: 'ALL' };
    }
    if (dto.mode === PreventionBudgetExecutionModeDto.FILTERED) {
      if (!dto.preset || dto.preset === 'ALL') throw new BadRequestException('FILTERED exige une période bornée');
      return { ...resolveBudgetScopePeriod(dto as PreventionBudgetScopeDto, now), periodMode: 'BOUNDED' };
    }
    if (dto.preset && dto.preset !== 'CURRENT_YEAR') throw new BadRequestException('CURRENT_YEAR exige le périmètre CURRENT_YEAR');
    const end = currentParisDate(now);
    return { start: `${currentParisYear(now)}-01-01`, end, periodMode: 'BOUNDED' };
  }
  if (dto.preset === 'ALL') return { start: null, end: null, periodMode: 'ALL' };
  return { ...resolveBudgetScopePeriod(dto, now), periodMode: 'BOUNDED' };
}

export function preventionBudgetScopeKey(
  organizationId: string,
  periodMode: PreventionBudgetPeriodMode,
  period: { start: string | null; end: string | null },
  categoryId: string | null,
  severity: string | null,
  clientKeys: string[],
  missionId: string | null = null,
  categoryIds: string[] = [],
  severities: string[] = [],
  missionIds: string[] = [],
): string {
  return canonicalPreventionBudgetScopeKey(organizationId, periodMode, period, categoryId, severity, clientKeys, missionId, categoryIds, severities, missionIds);
}

export function preventionBudgetAnnualScenarioKey(runId: string, globalScopeKey: string, year: number): string {
  return canonicalPreventionBudgetAnnualScenarioKey(runId, globalScopeKey, year);
}

@Injectable()
export class PreventionBudgetApiService {
  private readonly previewSigningKey: Buffer;
  constructor(
    private readonly db: DataSource,
    private readonly budget: PreventionBudgetService,
    @Optional() private readonly activation?: PreventionActivationService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly bulkAdmission?: PreventionBulkAdmissionService,
  ) {
    const configured = config?.get<string>('PREVENTION_BUDGET_PREVIEW_SECRET') || config?.get<string>('JWT_SECRET');
    if (configured && configured.length >= 32) this.previewSigningKey = Buffer.from(configured);
    else if (process.env.NODE_ENV === 'production') throw new Error('A strong Budget preview signing secret is required');
    else this.previewSigningKey = randomBytes(32);
  }

  private signPreview(digestValue: string, organizationId: string): string {
    const body = Buffer.from(JSON.stringify({ v: 1, organizationId, digest: digestValue, issuedAt: Date.now() })).toString('base64url');
    const signature = createHmac('sha256', this.previewSigningKey).update(`prevention-budget-preview-v1|${body}`).digest('base64url');
    return `${body}.${signature}`;
  }

  private assertPreviewConfirmation(token: string | undefined, preview: { organizationId: string; confirmationDigest: string }): void {
    if (!token || token.length > 1024) throw new BadRequestException('Une prévisualisation budgétaire est requise');
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      throw new ConflictException({ message: 'Prévisualisation budgétaire invalide', preview });
    }
    const expected = createHmac('sha256', this.previewSigningKey)
      .update(`prevention-budget-preview-v1|${parts[0]}`).digest();
    const signature = Buffer.from(parts[1], 'base64url');
    let supplied: any;
    try { supplied = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { supplied = null; }
    const issuedAt = Number(supplied?.issuedAt);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected) ||
        supplied?.v !== 1 || supplied?.organizationId !== preview.organizationId ||
        supplied?.digest !== preview.confirmationDigest || !Number.isSafeInteger(issuedAt) ||
        issuedAt > Date.now() + 5_000 || Date.now() - issuedAt > 15 * 60_000) {
      throw new ConflictException({ message: 'Le périmètre budgétaire a changé : confirmez la nouvelle prévisualisation', preview });
    }
  }

  private org(user: User): string {
    if (!user || user.role !== UserRole.ADMIN || !user.organizationId) {
      throw new ForbiddenException('Budget accessible uniquement aux administrateurs d’organisation');
    }
    return user.organizationId;
  }

  private async enabledOrg(user: User): Promise<string> {
    const organizationId = this.org(user);
    if (this.activation) await this.activation.assertEnabled(organizationId);
    return organizationId;
  }

  private assertMoney(value: string | null | undefined, field = 'Montant'): void {
    if (value !== null && value !== undefined && (!MONEY.test(value) || Number(value) < 0)) {
      throw new BadRequestException(`${field} invalide`);
    }
  }

  private async assertNewScopeQuota(organizationId: string): Promise<void> {
    const [recent] = await this.db.query(
      `SELECT COUNT(DISTINCT scenarioKey) count FROM prevention_budget_scenarios
       WHERE organizationId=? AND createdAt >= UTC_TIMESTAMP() - INTERVAL 1 DAY`,
      [organizationId],
    );
    if (Number(recent?.count ?? 0) >= 20) {
      throw new ConflictException('Limite quotidienne de nouveaux périmètres budgétaires atteinte');
    }
  }

  private async latestForId(organizationId: string, id: string, includeDraft = true, db: Db = this.db): Promise<any> {
    const [requested] = await db.query(
      `SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1`, [id, organizationId],
    );
    if (!requested) throw new NotFoundException('Scénario budgétaire introuvable');
    const [current] = await db.query(
      `SELECT * FROM prevention_budget_scenarios
       WHERE organizationId=? AND scenarioKey=? ${includeDraft ? "AND (status<>'DRAFT' OR failedAt IS NULL)" : "AND status<>'DRAFT'"}
       ORDER BY version DESC LIMIT 1`, [organizationId, requested.scenarioKey],
    );
    return current ?? requested;
  }

  private async latestAny(organizationId: string, id: string, db: Db = this.db): Promise<any> {
    const [requested] = await db.query(
      `SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1`, [id, organizationId],
    );
    if (!requested) throw new NotFoundException('Scénario budgétaire introuvable');
    const [current] = await db.query(
      `SELECT * FROM prevention_budget_scenarios
       WHERE organizationId=? AND scenarioKey=? AND (status<>'DRAFT' OR failedAt IS NULL)
       ORDER BY version DESC LIMIT 1
       FOR UPDATE`, [organizationId, requested.scenarioKey],
    );
    return current ?? requested;
  }

  private serializeScenario(row: any, pending = false): Record<string, unknown> {
    const periodMode = row.periodMode === 'ALL' ? 'ALL' : 'BOUNDED';
    return {
      id: row.id, scenarioKey: row.scenarioKey, version: Number(row.version), sourceVersion: row.sourceVersion,
      periodMode, periodStart: periodMode === 'ALL' ? null : budgetCalendarDate(row.periodStart),
      periodEnd: periodMode === 'ALL' ? null : budgetCalendarDate(row.periodEnd), status: row.status,
      failedAt: row.failedAt ?? null,
      missionId: row.missionId ?? null, chantierId: row.missionId ?? null, categoryId: row.categoryId ?? null, severity: row.severity ?? null,
      missionIds: storedScopeArray(row.missionIds), categoryIds: storedScopeArray(row.categoryIds), severities: storedScopeArray(row.severities),
      clientKeys: storedBudgetClientKeys(row.clientKeys), adminPrompt: row.adminPrompt ?? null,
      contingencyRatePercent: String(row.contingencyRatePercent), retainedBudgetHt: String(row.retainedBudgetHt),
      estimatedBudgetHt: String(row.estimatedBudgetHt), validatedBudgetHt: String(row.validatedBudgetHt),
      contingencyAmountHt: String(row.contingencyAmountHt), totalBudgetHt: String(row.totalBudgetHt),
      pending,
    };
  }

  async list(user: User, query: PreventionBudgetListQueryDto) {
    const organizationId = await this.enabledOrg(user);
    const page = Math.min(query.page ?? 1, 1000); const limit = Math.min(query.limit ?? 25, 100);
    const args: unknown[] = [organizationId]; const where = ['s.organizationId=?'];
    if (query.status) { where.push('s.status=?'); args.push(query.status); }
    const selectedVersion = `(
      (s.status<>'DRAFT' AND NOT EXISTS (
        SELECT 1 FROM prevention_budget_scenarios newer
        WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey
          AND newer.version>s.version AND newer.status<>'DRAFT'
      ))
      OR
      (s.status='DRAFT' AND s.failedAt IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM prevention_budget_scenarios valid
         WHERE valid.organizationId=s.organizationId AND valid.scenarioKey=s.scenarioKey AND valid.status<>'DRAFT'
       )
       AND NOT EXISTS (
         SELECT 1 FROM prevention_budget_scenarios newerDraft
         WHERE newerDraft.organizationId=s.organizationId AND newerDraft.scenarioKey=s.scenarioKey
           AND newerDraft.version>s.version AND newerDraft.status='DRAFT' AND newerDraft.failedAt IS NULL
       ))
    )`;
    const [count] = await this.db.query(`SELECT COUNT(*) count FROM prevention_budget_scenarios s WHERE ${where.join(' AND ')} AND ${selectedVersion}`, args);
    const rows = await this.db.query(`SELECT s.*,
      EXISTS(SELECT 1 FROM prevention_budget_scenarios pending WHERE pending.organizationId=s.organizationId AND pending.scenarioKey=s.scenarioKey AND pending.status='DRAFT' AND pending.failedAt IS NULL AND pending.version>s.version) pending
      FROM prevention_budget_scenarios s WHERE ${where.join(' AND ')} AND ${selectedVersion} ORDER BY s.createdAt DESC,s.id ASC LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);
    return { items: rows.map((row: any) => this.serializeScenario(row, Boolean(row.pending))), page, limit, total: Number(count?.count ?? 0) };
  }

  async clients(user: User): Promise<{ items: Array<{ key: string; label: string }> }> {
    const organizationId = await this.enabledOrg(user);
    const rows: Array<{ client: string | null }> = await this.db.query(
      'SELECT client FROM missions WHERE organizationId=? ORDER BY id LIMIT 10001', [organizationId]);
    if (rows.length > 10000) throw new BadRequestException('Liste des chantiers trop volumineuse');
    const clients = new Map<string, { key: string; label: string }>();
    for (const row of rows) {
      const client = budgetClientIdentity(row.client);
      if (!clients.has(client.key)) clients.set(client.key, client);
    }
    return { items: [...clients.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr')) };
  }

  private previewLimit(name: string, fallback: number): number {
    const value = Number(this.config?.get(name, fallback) ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private async previewFilters(user: User, dto: PreventionBudgetPreviewDto): Promise<{
    organizationId: string; clientKeys: string[]; categoryId: string | null; severity: string | null; missionId: string | null;
    categoryIds: string[]; severities: string[]; missionIds: string[];
  }> {
    const organizationId = await this.enabledOrg(user);
    let clientKeys: string[];
    try { clientKeys = parseBudgetClientKeys(dto.clientKeys); }
    catch { throw new BadRequestException('Sélection de clients invalide'); }
    const clients = await this.clients(user);
    const known = new Map(clients.items.map((client) => [client.key, client]));
    if (clientKeys.some((key) => !known.has(key))) throw new BadRequestException('Client introuvable dans l’organisation');
    const categoryIds = [...new Set([...(dto.categoryIds ?? []), ...(dto.categoryId ? [dto.categoryId] : [])])].sort();
    if (categoryIds.length) {
      const categories = await this.db.query('SELECT id FROM prevention_categories WHERE organizationId=? AND id IN (?)', [organizationId, categoryIds]);
      if (categories.length !== categoryIds.length) throw new BadRequestException('Catégorie introuvable dans l’organisation');
    }
    const missionIds = [...new Set([...(dto.missionIds ?? []), ...(dto.missionId ? [dto.missionId] : [])])].sort();
    if (missionIds.length) {
      const missions = await this.db.query('SELECT id FROM missions WHERE organizationId=? AND id IN (?)', [organizationId, missionIds]);
      if (missions.length !== missionIds.length) throw new BadRequestException('Chantier introuvable dans l’organisation');
    }
    const severities = [...new Set([...(dto.severities ?? []), ...(dto.severity ? [dto.severity] : [])])].sort();
    return { organizationId, clientKeys, categoryId: dto.categoryId ?? null, severity: dto.severity ?? null, missionId: dto.missionId ?? null, categoryIds, severities, missionIds };
  }

  private previewClientPredicate(clientKeys: string[], clients: Array<{ key: string; label: string }>): { sql: string; args: unknown[] } {
    if (!clientKeys.length) return { sql: '', args: [] };
    const labels = new Map(clients.map((client) => [client.key, client.label]));
    const selectedLabels = clientKeys.filter((key) => key !== 'unassigned').map((key) => labels.get(key)).filter(Boolean) as string[];
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (clientKeys.includes('unassigned')) clauses.push("(m.client IS NULL OR TRIM(m.client)='')");
    if (selectedLabels.length) {
      clauses.push(`LOWER(TRIM(m.client)) IN (${selectedLabels.map(() => '?').join(',')})`);
      args.push(...selectedLabels.map((label) => label.toLocaleLowerCase('fr-FR')));
    }
    return { sql: `AND (${clauses.join(' OR ')})`, args };
  }

  private previewDecision(_mode: PreventionBudgetExecutionModeDto, totals: { reportCount: number; recommendationCount: number; estimationWorkloadCount: number }) {
    const ceilings = {
      immediateReports: this.previewLimit('PREVENTION_BUDGET_IMMEDIATE_REPORT_CEILING', 250),
      immediateRecommendations: this.previewLimit('PREVENTION_BUDGET_IMMEDIATE_RECOMMENDATION_CEILING', 2_500),
      immediateEstimations: this.previewLimit('PREVENTION_BUDGET_IMMEDIATE_ESTIMATION_CEILING', 250),
      hardReports: this.previewLimit('PREVENTION_BUDGET_HARD_REPORT_CEILING', 10_000),
      hardRecommendations: this.previewLimit('PREVENTION_BUDGET_HARD_RECOMMENDATION_CEILING', 100_000),
      hardEstimations: this.previewLimit('PREVENTION_BUDGET_HARD_ESTIMATION_CEILING', 10_000),
    };
    const exceedsHard = totals.reportCount > ceilings.hardReports || totals.recommendationCount > ceilings.hardRecommendations || totals.estimationWorkloadCount > ceilings.hardEstimations;
    if (exceedsHard) return { decision: 'REJECTED' as const, reason: 'FILTERED_VOLUME_EXCEEDS_HARD_CEILING', ceilings };
    if (totals.reportCount > ceilings.immediateReports || totals.recommendationCount > ceilings.immediateRecommendations || totals.estimationWorkloadCount > ceilings.immediateEstimations) {
      return { decision: 'NIGHT_ONLY' as const, reason: 'FILTERED_VOLUME_REQUIRES_NIGHT_ADMISSION', ceilings };
    }
    return { decision: 'IMMEDIATE' as const, reason: 'FILTERED_VOLUME_WITHIN_IMMEDIATE_CEILING', ceilings };
  }

  async preview(user: User, dto: PreventionBudgetPreviewDto) {
    const filters = await this.previewFilters(user, dto);
    const period = resolveBudgetPeriod(dto);
    const clients = await this.clients(user);
    const clientPredicate = this.previewClientPredicate(filters.clientKeys, clients.items);
    const categoryIds = filters.categoryIds;
    const missionIds = filters.missionIds;
    const recommendationScope = budgetRecommendationScopePredicate(period, categoryIds, filters.severities, missionIds, clientPredicate);
    const groupBy = 'GROUP BY YEAR(f.businessDate)';
    const rows: Array<any> = await this.db.query(
      `SELECT YEAR(f.businessDate) year,
         COUNT(DISTINCT f.reportId) reportCount, COUNT(f.id) recommendationCount,
         COUNT(DISTINCT CONCAT(COALESCE(NULLIF(TRIM(m.client),''),'__UNASSIGNED__'),'|',COALESCE(f.actionType,f.normalizedKey,'UNKNOWN'),'|',COALESCE(f.categoryId,'UNCATEGORIZED'))) estimationWorkloadCount
       FROM prevention_findings f LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
       WHERE f.organizationId=? AND f.findingType='RECOMMENDATION' AND f.businessDate IS NOT NULL
         ${recommendationScope.sql} ${groupBy}`,
      [filters.organizationId, ...recommendationScope.args],
    );
    const years = rows.map((row) => ({ year: Number(row.year), reportCount: Number(row.reportCount ?? 0), recommendationCount: Number(row.recommendationCount ?? 0), estimationWorkloadCount: Number(row.estimationWorkloadCount ?? 0) }))
      .sort((a, b) => a.year - b.year);
    if (!years.length && dto.mode === PreventionBudgetExecutionModeDto.CURRENT_YEAR) years.push({ year: currentParisYear(), reportCount: 0, recommendationCount: 0, estimationWorkloadCount: 0 });
    const totals = years.reduce((sum, row) => ({ reportCount: sum.reportCount + row.reportCount, recommendationCount: sum.recommendationCount + row.recommendationCount, estimationWorkloadCount: sum.estimationWorkloadCount + row.estimationWorkloadCount }), { reportCount: 0, recommendationCount: 0, estimationWorkloadCount: 0 });
    const threshold = this.previewDecision(dto.mode, totals);
    const scenarioKey = preventionBudgetScopeKey(filters.organizationId, period.periodMode, period, filters.categoryId, filters.severity, filters.clientKeys, filters.missionId, categoryIds, filters.severities, missionIds);
    const sourceVersion = await loadPreventionBudgetSourceVersion(this.db, filters.organizationId);
    const bulkSettings = this.bulkAdmission?.settings ?? loadPreventionBulkConfiguration(this.config ?? new ConfigService());
    const scheduledFor = threshold.decision === 'NIGHT_ONLY'
      ? nextPreventionBulkWindowStart(new Date(), bulkSettings).toISOString() : null;
    const windowKey = scheduledFor ? preventionBulkWindowKey(new Date(scheduledFor), bulkSettings) : null;
    const confirmationDigest = digest(JSON.stringify({ organizationId: filters.organizationId, mode: dto.mode,
      period, filters: { clientKeys: filters.clientKeys, categoryId: filters.categoryId, categoryIds, severity: filters.severity, severities: filters.severities, missionId: filters.missionId, missionIds },
      years, totals, threshold, scenarioKey, sourceVersion, windowKey }));
    return {
      organizationId: filters.organizationId,
      mode: dto.mode, periodMode: period.periodMode, period: { start: period.start, end: period.end },
      filters: { clientKeys: filters.clientKeys, categoryId: filters.categoryId, categoryIds, severity: filters.severity, severities: filters.severities, missionId: filters.missionId, missionIds }, years, totals,
      threshold, scenarioKey, sourceVersion, scheduledFor, windowKey, confirmationDigest,
      confirmationToken: this.signPreview(confirmationDigest, filters.organizationId),
    };
  }

  async command(user: User, dto: PreventionBudgetCommandDto) {
    const preview = await this.preview(user, dto);
    this.assertPreviewConfirmation(dto.confirmationToken, preview);
    const confirmedSourceVersion = await loadPreventionBudgetSourceVersion(this.db, preview.organizationId);
    if (confirmedSourceVersion !== preview.sourceVersion) {
      throw new ConflictException({
        message: 'Les sources prévention ont changé : confirmez la nouvelle prévisualisation',
        preview: await this.preview(user, dto),
      });
    }
    if (preview.threshold.decision === 'REJECTED') {
      throw new ConflictException({ message: 'Le volume budgétaire dépasse le plafond autorisé', preview });
    }
    if (dto.mode !== PreventionBudgetExecutionModeDto.GLOBAL_YEARLY) {
      const preset = dto.preset ?? 'CURRENT_YEAR';
      const runId = deterministicUuid(`prevention-budget-bounded-run-v1|${preview.scenarioKey}`);
      const executionMode = preview.threshold.decision === 'IMMEDIATE' ? 'IMMEDIATE' as const : 'SCHEDULED' as const;
      const admissionService = this.bulkAdmission;
      const delayMs = executionMode === 'SCHEDULED' && admissionService && !isWithinPreventionBulkWindow(new Date(), admissionService.settings)
        ? Math.max(1000, nextPreventionBulkWindowStart(new Date(), admissionService.settings).getTime() - Date.now()) : 0;
      const result = await this.scope(user, {
        preset, from: dto.from, to: dto.to, clientKeys: preview.filters.clientKeys,
        categoryId: preview.filters.categoryId ?? undefined, categoryIds: preview.filters.categoryIds,
        severity: preview.filters.severity ?? undefined, severities: preview.filters.severities,
        missionId: preview.filters.missionId ?? undefined, missionIds: preview.filters.missionIds,
        adminPrompt: dto.adminPrompt,
      }, true, { runId, executionMode, delayMs });
      return { mode: dto.mode, admission: { status: 'QUEUED', executionMode, reason: preview.threshold.reason, scheduledFor: preview.scheduledFor }, preview, result, job: result.job };
    }
    const organizationId = await this.enabledOrg(user);
    const stableRunId = deterministicUuid(`prevention-budget-global-run-v1|${organizationId}|${preview.scenarioKey}`);
    const sourceVersion = confirmedSourceVersion;
    const [activeRun] = await this.db.query(`SELECT id,sourceVersion FROM prevention_budget_global_runs WHERE organizationId=? AND scenarioKey=? AND status IN ('PENDING','PROCESSING','SUSPENDED') ORDER BY createdAt DESC LIMIT 1`, [organizationId, preview.scenarioKey]);
    if (activeRun && activeRun.sourceVersion !== sourceVersion) {
      throw new ConflictException('Les sources prévention ont changé; veuillez relancer la prévisualisation globale');
    }
    let runId = activeRun?.id ?? stableRunId;
    if (!activeRun) {
      const [previousRun] = await this.db.query(`SELECT status FROM prevention_budget_global_runs WHERE id=? AND organizationId=? LIMIT 1`, [stableRunId, organizationId]);
      if (previousRun) runId = randomUUID();
    }
    const years = preview.years.length ? preview.years.map((row) => row.year).sort((a, b) => a - b) : [currentParisYear()];
    await this.db.transaction(async (manager) => {
      const [existing] = await manager.query('SELECT id,status FROM prevention_budget_global_runs WHERE id=? AND organizationId=? FOR UPDATE', [runId, organizationId]);
      if (!existing) {
        const rate = '0.00';
        await manager.query(`INSERT INTO prevention_budget_global_runs
          (id,organizationId,scenarioKey,sourceVersion,status,mode,executionMode,filters,adminPrompt)
          VALUES (?,?,?,?, 'PENDING','GLOBAL_YEARLY',?,?,?)`, [runId, organizationId, preview.scenarioKey, sourceVersion,
          preview.threshold.decision === 'IMMEDIATE' ? 'IMMEDIATE' : 'SCHEDULED', JSON.stringify({ ...preview.filters, contingencyRatePercent: rate }), dto.adminPrompt?.trim() || null]);
      }
      for (const year of years) {
        const scenarioId = deterministicUuid(`prevention-budget-global-year-scenario-v1|${runId}|${year}`);
        const scenarioKey = preventionBudgetAnnualScenarioKey(runId, preview.scenarioKey, year);
        const yearSource = digest(`${sourceVersion}|YEAR|${year}`);
        await manager.query(`INSERT IGNORE INTO prevention_budget_scenarios
          (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,missionIds,categoryId,categoryIds,severity,severities,clientKeys,adminPrompt,adminPromptActorId,status,contingencyRatePercent)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?, ?,NULL,'DRAFT',?)`, [scenarioId, organizationId, scenarioKey, 1, yearSource, `${year}-01-01`, `${year}-12-31`, 'BOUNDED',
          preview.filters.missionId, JSON.stringify(preview.filters.missionIds ?? []), preview.filters.categoryId, JSON.stringify(preview.filters.categoryIds ?? []), preview.filters.severity, JSON.stringify(preview.filters.severities ?? []), JSON.stringify(preview.filters.clientKeys), dto.adminPrompt?.trim() || null,
          '0.00']);
        await manager.query(`INSERT IGNORE INTO prevention_budget_global_years (id,runId,organizationId,year,status,scenarioId)
          VALUES (?,?,?,?, 'PENDING',?)`, [deterministicUuid(`prevention-budget-global-year-v1|${runId}|${year}`), runId, organizationId, year, scenarioId]);
      }
    });
    const [run] = await this.db.query('SELECT * FROM prevention_budget_global_runs WHERE id=? AND organizationId=? LIMIT 1', [runId, organizationId]);
    if (run.status === 'PUBLISHED') {
      const job = await this.budget.globalRunStatus(organizationId, runId);
      return { mode: dto.mode, preview, runId, status: 'COMPLETED', dbStatus: run.status, scenarioId: run.finalScenarioId ?? null, admission: { status: 'ALREADY_PUBLISHED', scheduledFor: null }, job };
    }
    if (!this.bulkAdmission) throw new ConflictException('Admission globale indisponible');
    const admission = await this.bulkAdmission.admit({ organizationId, runId, workKind: 'BUDGET', executionMode: run.executionMode === 'IMMEDIATE' ? 'IMMEDIATE' : 'SCHEDULED' });
    if (!admission.admitted || !admission.lease) {
      const [next] = await this.db.query(`SELECT y.year,s.id scenarioId,s.version FROM prevention_budget_global_years y
        JOIN prevention_budget_scenarios s ON s.id=y.scenarioId AND s.organizationId=y.organizationId
        WHERE y.runId=? AND y.organizationId=? AND y.status IN ('PENDING','SUSPENDED') ORDER BY y.year ASC LIMIT 1`, [runId, organizationId]);
      const delayMs = admission.availableAt ? Math.max(1000, new Date(admission.availableAt).getTime() - Date.now()) : 60_000;
      const queueJob = next ? await this.budget.enqueueGlobalYear({ organizationId, scenarioId: next.scenarioId, scenarioVersion: Number(next.version), runId, year: Number(next.year) }, delayMs) : null;
      const job = await this.budget.globalRunStatus(organizationId, runId);
      return { mode: dto.mode, preview, runId, status: 'DEFERRED', admission: { ...admission, scheduledFor: admission.availableAt ?? preview.scheduledFor }, job, queueJobId: queueJob?.id ?? null };
    }
    try {
      const [next] = await this.db.query(`SELECT y.id,y.year,s.id scenarioId,s.version FROM prevention_budget_global_years y
        JOIN prevention_budget_scenarios s ON s.id=y.scenarioId AND s.organizationId=y.organizationId
        WHERE y.runId=? AND y.organizationId=? AND y.status IN ('PENDING','SUSPENDED') ORDER BY y.year ASC LIMIT 1`, [runId, organizationId]);
      if (!next) return { mode: dto.mode, preview, runId, status: 'PROCESSING', admission: { ...admission, scheduledFor: preview.scheduledFor }, job: await this.budget.globalRunStatus(organizationId, runId) };
      const queueJob = await this.budget.enqueueGlobalYear({ organizationId, scenarioId: next.scenarioId, scenarioVersion: Number(next.version), runId, year: Number(next.year) });
      const job = await this.budget.globalRunStatus(organizationId, runId);
      return { mode: dto.mode, preview, runId, status: 'QUEUED', admission: { ...admission, scheduledFor: preview.scheduledFor }, job, queueJobId: queueJob.id };
    } finally {
      await this.bulkAdmission.release(admission.lease).catch(() => undefined);
    }
  }

  async scope(user: User, dto: PreventionBudgetScopeDto, startCalculation = false, queueOptions?: { runId: string; executionMode: 'IMMEDIATE' | 'SCHEDULED'; delayMs?: number }) {
    const organizationId = await this.enabledOrg(user);
    if (startCalculation && !queueOptions) throw new ConflictException(LEGACY_BUDGET_CALCULATION_MESSAGE);
    const period = resolveBudgetPeriod(dto);
    if (startCalculation && period.periodMode === 'ALL') {
      throw new ConflictException('Le calcul GLOBAL_YEARLY doit être admis par le traitement annuel durable');
    }
    let clientKeys: string[];
    try { clientKeys = parseBudgetClientKeys(dto.clientKeys); }
    catch { throw new BadRequestException('Sélection de clients invalide'); }
    if (clientKeys.length) {
      const known = new Set((await this.clients(user)).items.map((client) => client.key));
      if (clientKeys.some((key) => !known.has(key))) throw new BadRequestException('Client introuvable dans l’organisation');
    }
    const categoryIds = [...new Set([...(dto.categoryIds ?? []), ...(dto.categoryId ? [dto.categoryId] : [])])];
    const categoryRows = categoryIds.length ? await this.db.query('SELECT id FROM prevention_categories WHERE organizationId=? AND id IN (?)', [organizationId, categoryIds]) : [];
    if (categoryRows.length !== categoryIds.length) throw new BadRequestException('Catégorie introuvable dans l’organisation');
    const missionIds = [...new Set([...(dto.missionIds ?? []), ...(dto.missionId ? [dto.missionId] : [])])];
    const missionRows = missionIds.length ? await this.db.query('SELECT id FROM missions WHERE organizationId=? AND id IN (?) LIMIT 101', [organizationId, missionIds]) : [];
    if (missionRows.length !== missionIds.length) throw new BadRequestException('Chantier introuvable dans l’organisation');
    const severities = [...new Set([...(dto.severities ?? []), ...(dto.severity ? [dto.severity] : [])])];
    const scenarioKey = preventionBudgetScopeKey(organizationId, period.periodMode, period, dto.categoryId ?? null, dto.severity ?? null, clientKeys, dto.missionId ?? null, categoryIds, severities, missionIds);
    const scopeClients = clientKeys.length
      ? this.previewClientPredicate(clientKeys, (await this.clients(user)).items)
      : { sql: '', args: [] as unknown[] };
    const recommendationScope = budgetRecommendationScopePredicate(period, categoryIds, severities, missionIds, scopeClients);
    const [total] = await this.db.query(
      `SELECT COUNT(DISTINCT r.id) totalReports
       FROM reports r
       JOIN prevention_findings f ON f.organizationId=r.organizationId AND f.reportId=r.id
       LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
       WHERE r.organizationId=? AND f.findingType='RECOMMENDATION' AND f.businessDate IS NOT NULL
       ${recommendationScope.sql}`,
      [organizationId, ...recommendationScope.args],
    );
    let [scenario] = await this.db.query(
      `SELECT * FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=?
       AND periodMode=?
       ${startCalculation ? "AND (status<>'DRAFT' OR failedAt IS NULL)" : "AND status<>'DRAFT'"} ORDER BY version DESC LIMIT 1`,
      [organizationId, scenarioKey, period.periodMode],
    );
    // A client selection is a read-only view until the administrator explicitly
    // launches a calculation. Reuse the materialized all-client scope so the
    // filter is immediately useful and never creates/enqueues work on GET.
    if (!scenario && clientKeys.length && !missionIds.length && !startCalculation) {
      const allScenarioKey = preventionBudgetScopeKey(organizationId, period.periodMode, period, dto.categoryId ?? null, dto.severity ?? null, [], null, categoryIds, severities, []);
      [scenario] = await this.db.query(
        'SELECT * FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? AND periodMode=? AND status<>\'DRAFT\' ORDER BY version DESC LIMIT 1',
        [organizationId, allScenarioKey, period.periodMode],
      );
    }
    let job = null;
    if (startCalculation) {
      let createdNow = false;
      if (!scenario) {
        await this.assertNewScopeQuota(organizationId);
        const id = randomUUID();
        const sourceVersion = digest(`budget-scope-build|${scenarioKey}`);
        await this.db.query(
          `INSERT IGNORE INTO prevention_budget_scenarios
            (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,missionId,missionIds,categoryId,categoryIds,severity,severities,clientKeys,adminPrompt,adminPromptActorId,status,contingencyRatePercent,periodMode)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 0, ?)`,
          [id, organizationId, scenarioKey, sourceVersion, period.start, period.end, dto.missionId ?? null, JSON.stringify(missionIds), dto.categoryId ?? null, JSON.stringify(categoryIds), dto.severity ?? null, JSON.stringify(severities),
            JSON.stringify(clientKeys), dto.adminPrompt?.trim() || null, dto.adminPrompt?.trim() ? user.id : null, period.periodMode],
        );
        [scenario] = await this.db.query(
          'SELECT * FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? AND periodMode=? ORDER BY version DESC LIMIT 1',
          [organizationId, scenarioKey, period.periodMode],
        );
        createdNow = true;
      }
      if (scenario.status === 'ARCHIVED') throw new BadRequestException('Un budget archivé ne peut pas être recalculé');
      const recalculateExisting = !createdNow;
      if (recalculateExisting) {
        scenario = await this.db.transaction((manager) => this.cloneScenario(manager, organizationId, scenario, user.id, {
          status: 'DRAFT', action: 'RECALCULATE', note: 'Recalcul du périmètre budgétaire',
          adminPrompt: dto.adminPrompt?.trim() || null,
        }));
      }
      const enqueueRequest = queueOptions ? { organizationId, scenarioId: scenario.id, ...queueOptions } : { organizationId, scenarioId: scenario.id };
      job = recalculateExisting
        ? await this.budget.enqueueRecalculate(enqueueRequest)
        : await this.budget.enqueueBuild(enqueueRequest);
    }
    return { period: { start: period.start, end: period.end }, periodMode: period.periodMode, totalReports: Number(total?.totalReports ?? 0), scenario: scenario ? this.serializeScenario(scenario, scenario.status === 'DRAFT') : null, job };
  }

  /** Existing estimates are a read-only projection, never a completed ALL
   * scenario. In particular, opening this view must not enqueue LLM work. */
  async materialized(user: User, dto: PreventionBudgetScopeDto) {
    const organizationId = await this.enabledOrg(user);
    const period = resolveBudgetPeriod(dto);
    let clientKeys: string[];
    try { clientKeys = parseBudgetClientKeys(dto.clientKeys); }
    catch { throw new BadRequestException('Sélection de clients invalide'); }
    if (clientKeys.length) {
      const known = new Set((await this.clients(user)).items.map((client) => client.key));
      if (clientKeys.some((key) => !known.has(key))) throw new BadRequestException('Client introuvable dans l’organisation');
    }
    const categoryIds = [...new Set([...(dto.categoryIds ?? []), ...(dto.categoryId ? [dto.categoryId] : [])])];
    if (categoryIds.length && (await this.db.query('SELECT id FROM prevention_categories WHERE organizationId=? AND id IN (?)', [organizationId, categoryIds])).length !== categoryIds.length) throw new BadRequestException('Catégorie introuvable dans l’organisation');
    const missionIds = [...new Set([...(dto.missionIds ?? []), ...(dto.missionId ? [dto.missionId] : [])])];
    if (missionIds.length && (await this.db.query('SELECT id FROM missions WHERE organizationId=? AND id IN (?)', [organizationId, missionIds])).length !== missionIds.length) throw new BadRequestException('Chantier introuvable dans l’organisation');
    const selectedClients = clientKeys.length
      ? this.previewClientPredicate(clientKeys, (await this.clients(user)).items)
      : { sql: '', args: [] as unknown[] };
    const severities = [...new Set([...(dto.severities ?? []), ...(dto.severity ? [dto.severity] : [])])];
    const recommendationScope = budgetRecommendationScopePredicate(period, categoryIds, severities, missionIds, selectedClients);
    const rows: Array<any> = await this.db.query(
      `SELECT i.*,s.scenarioKey,s.missionId originMissionId,s.missionIds originMissionIds,
              s.categoryId originCategoryId,s.categoryIds originCategoryIds,
              s.severity originSeverity,s.severities originSeverities,
              s.clientKeys originClientKeys,s.periodMode originPeriodMode,
              s.periodStart originPeriodStart,s.periodEnd originPeriodEnd,
              s.version originVersion,s.createdAt scenarioCreatedAt FROM prevention_budget_items i
       JOIN prevention_budget_scenarios s ON s.organizationId=i.organizationId AND s.id=i.scenarioId
       WHERE i.organizationId=? AND s.status IN ('CALCULATED','VALIDATED')
         AND NOT EXISTS (SELECT 1 FROM prevention_budget_scenarios newer
           WHERE newer.organizationId=s.organizationId AND newer.scenarioKey=s.scenarioKey
             AND newer.version>s.version AND newer.status<>'DRAFT')
         ${clientKeys.length ? 'AND i.clientKey IN (?)' : ''}
         ${missionIds.length ? `AND EXISTS (SELECT 1 FROM prevention_budget_item_sources scopeSource
           JOIN prevention_findings scopeFinding ON scopeFinding.organizationId=scopeSource.organizationId
             AND scopeFinding.id=scopeSource.findingId
           WHERE scopeSource.organizationId=i.organizationId AND scopeSource.itemId=i.id
             AND scopeFinding.missionId IN (?))` : ''}
       ORDER BY s.createdAt DESC,i.id ASC LIMIT 10001`,
      [organizationId, ...(clientKeys.length ? [clientKeys] : []), ...(missionIds.length ? [missionIds] : [])],
    );
    if (rows.length > 10000) return { items: [], partial: true, tooLarge: true, totalReports: 0, availableTotalHt: null };
    const [total] = await this.db.query(
      `SELECT COUNT(DISTINCT r.id) totalReports
       FROM reports r
       JOIN prevention_findings f ON f.organizationId=r.organizationId AND f.reportId=r.id
       LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
       WHERE r.organizationId=? AND f.findingType='RECOMMENDATION' AND f.businessDate IS NOT NULL
       ${recommendationScope.sql}`,
      [organizationId, ...recommendationScope.args],
    );
    if (!rows.length) return { items: [], partial: true, tooLarge: false, totalReports: Number(total?.totalReports ?? 0), availableTotalHt: '0.00' };
    const periodSql = period.periodMode === 'ALL' ? '' : 'AND f.businessDate BETWEEN ? AND ?';
    const severity = budgetSeverityPreviewPredicates(severities);
    const sourceRows: Array<any> = await this.db.query(
      `SELECT src.*,r.title reportTitle,r.reportFileUrl reportFileUrl,
              f.content recommendationContent,f.regulatoryReferences regulatoryReferences
       FROM prevention_budget_item_sources src
       JOIN prevention_findings f ON f.organizationId=src.organizationId AND f.id=src.findingId
         AND f.findingType='RECOMMENDATION'
       LEFT JOIN reports r ON r.organizationId=src.organizationId AND r.id=src.reportId
       WHERE src.organizationId=? AND src.itemId IN (?) AND src.sourceKind='RECOMMENDATION'
         ${periodSql}
         ${categoryIds.length ? 'AND f.categoryId IN (?)' : ''}
         ${severity.sql}
         ${missionIds.length ? 'AND f.missionId IN (?)' : ''}
       ORDER BY src.itemId,src.id LIMIT 50001`,
      [organizationId, rows.map((row) => row.id),
        ...(period.periodMode === 'ALL' ? [] : [period.start, period.end]),
        ...(categoryIds.length ? [categoryIds] : []), ...severity.args, ...(missionIds.length ? [missionIds] : [])],
    );
    if (sourceRows.length > 50000) return { items: [], partial: true, tooLarge: true, totalReports: Number(total?.totalReports ?? 0), availableTotalHt: null };
    const visibleIds = new Set(sourceRows.map((source) => String(source.itemId)));
    const visibleRows = rows.filter((row) => {
      const rowMissionIds = storedScopeArray(row.originMissionIds);
      const matchesMission = missionIds.includes(String(row.originMissionId ?? '')) || rowMissionIds.some((id) => missionIds.includes(id));
      return visibleIds.has(String(row.id)) &&
        (!missionIds.length || !(Number(row.lockedManual) === 1 || ['VALIDE', 'ENGAGE', 'REALISE'].includes(String(row.status))) || matchesMission);
    });
    const selectedMissionIds = new Set(missionIds.map(String));
    const hasCategoryScope = categoryIds.length > 0;
    const hasSeverityScope = severities.length > 0;
    const materializedRows = visibleRows.map((row) => {
      const rowMissionIds = storedScopeArray(row.originMissionIds);
      const preferred = selectedMissionIds.has(String(row.originMissionId ?? '')) || rowMissionIds.some((id) => selectedMissionIds.has(id));
      const actionResult = selectedMissionIds.size
        ? row.scenarioKey === materializedActionScopeKey(organizationId, row.itemKey, null, {
          missionIds: [...selectedMissionIds], categoryIds, severities,
          periodMode: period.periodMode, periodStart: period.start, periodEnd: period.end,
        }) || [...selectedMissionIds].some((missionId) => row.scenarioKey === materializedActionScopeKey(organizationId, row.itemKey, missionId))
        : row.scenarioKey === materializedActionScopeKey(organizationId, row.itemKey, null, {
          categoryIds, severities, periodMode: period.periodMode, periodStart: period.start, periodEnd: period.end,
        }) || row.scenarioKey === materializedActionScopeKey(organizationId, row.itemKey, row.originMissionId ?? null);
      return { ...row, scopePreferred: preferred, actionResult };
    });
    const items = excludeSupersededUnpricedBudgetRows(consolidateMaterializedBudgetRows(materializedRows, sourceRows,
      period.periodMode !== 'ALL' || hasCategoryScope || hasSeverityScope || selectedMissionIds.size > 0), materializedRows, sourceRows);
    return {
      items, partial: true, tooLarge: false, totalReports: Number(total?.totalReports ?? 0),
      availableTotalHt: sumAvailableMaterializedBudgetRows(items),
    };
  }

  async create(user: User, _dto: PreventionBudgetCreateDto) {
    await this.enabledOrg(user);
    throw new ConflictException(LEGACY_BUDGET_CALCULATION_MESSAGE);
  }

  async detail(user: User, id: string, selectedClientKeys?: unknown) {
    const organizationId = await this.enabledOrg(user);
    const current = await this.latestForId(organizationId, id, false);
    let clientKeys: string[] = [];
    if (selectedClientKeys !== undefined) {
      try { clientKeys = parseBudgetClientKeys(selectedClientKeys); } catch { throw new BadRequestException('Sélection de clients invalide'); }
      if (clientKeys.length) {
        const known = new Set((await this.clients(user)).items.map((client) => client.key));
        if (clientKeys.some((key) => !known.has(key))) throw new BadRequestException('Client introuvable dans l’organisation');
      }
    }
    const [latest] = await this.db.query(
      `SELECT version,status FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? ORDER BY version DESC LIMIT 1`, [organizationId, current.scenarioKey],
    );
    const clientSql = clientKeys.length ? ' AND i.clientKey IN (?)' : '';
    const items = await this.db.query(
      `SELECT i.*,c.label categoryLabel FROM prevention_budget_items i
       LEFT JOIN prevention_categories c ON c.organizationId=i.organizationId AND c.id=i.categoryId
       WHERE i.organizationId=? AND i.scenarioId=?${clientSql} ORDER BY i.priority DESC,i.title ASC,i.id ASC`, [organizationId, current.id, ...(clientKeys.length ? [clientKeys] : [])],
    );
    const sources = items.length ? await this.db.query(
      `SELECT s.*,r.title reportTitle,r.reportFileUrl reportFileUrl,
              f.findingType,f.content observationContent,f.danger observationDanger,f.risk observationRisk,
              f.regulatoryReferences regulatoryReferences
       FROM prevention_budget_item_sources s
       INNER JOIN prevention_budget_items i ON i.organizationId=s.organizationId AND i.id=s.itemId
       LEFT JOIN reports r ON r.organizationId=s.organizationId AND r.id=s.reportId
       LEFT JOIN prevention_findings f ON f.organizationId=s.organizationId AND f.id=s.findingId
       WHERE s.organizationId=? AND i.scenarioId=? AND i.id IN (?) ORDER BY s.createdAt ASC,s.id ASC`, [organizationId, current.id, items.map((item: any) => item.id)],
    ) : [];
    const sourceByItem = new Map<string, any[]>();
    for (const source of sources) sourceByItem.set(source.itemId, [...(sourceByItem.get(source.itemId) ?? []), source]);
    const parseReferences = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.map(String).filter(Boolean);
      if (typeof value !== 'string') return [];
      try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [value]; } catch { return value ? [value] : []; }
    };
    const scenario = this.serializeScenario(current, Boolean(latest && Number(latest.version) > Number(current.version)));
    if (clientKeys.length) Object.assign(scenario, summarizeBudgetItems(items, String(current.contingencyRatePercent)), { filteredClientKeys: clientKeys });
    return {
      scenario,
      items: items.map((item: any) => {
        const itemSources = sourceByItem.get(item.id) ?? [];
        const reports = [...new Map(itemSources.filter((source) => source.reportId).map((source) => [source.reportId, { id: source.reportId, title: source.reportTitle ?? null, url: source.reportFileUrl ?? null }])).values()];
        const aiEstimateDetails = parseJsonObject(item.aiEstimateDetails);
        const linkedObservations = itemSources.filter((source) => source.findingId && source.findingType === 'OBSERVATION' && source.observationContent).map((source) => ({
          id: source.findingId, content: source.observationContent, danger: source.observationDanger ?? null, risk: source.observationRisk ?? null,
        }));
        const observations = linkedObservations.length ? linkedObservations :
          (Array.isArray(aiEstimateDetails?.sourceObservations) ? aiEstimateDetails.sourceObservations : []).map((content, index) => ({ id: `ai-observation-${index}`, content: String(content), danger: null, risk: null }));
        const linkedRecommendations = itemSources.filter((source) => source.findingType === 'RECOMMENDATION' && source.observationContent)
          .map((source) => String(source.observationContent));
        const recommendations = linkedRecommendations.length ? [...new Set(linkedRecommendations)]
          : Array.isArray(aiEstimateDetails?.sourceRecommendations) ? aiEstimateDetails.sourceRecommendations.map(String) : [];
        const regulatoryReferences = [...new Set(itemSources.flatMap((source) => parseReferences(source.regulatoryReferences)))];
        const quantity = String(item.quantity); const unitCostHt = item.unitCostHt === null ? null : String(item.unitCostHt); const totalHt = String(item.totalHt);
        return {
          ...item, quantity, unitCostHt, totalHt, aiEstimateDetails, lockedManual: Boolean(item.lockedManual), sources: itemSources,
          justificationDetails: {
            context: item.justification ?? null,
            observations, recommendations, baseReglementaire: regulatoryReferences, regulatoryReferences,
            costBreakdown: { quantity, unit: item.unit, unitCostHt, totalHt, priceSource: item.priceSource ?? null },
            aiEstimate: aiEstimateDetails,
            reports,
          },
        };
      }),
    };
  }

  async recalculate(user: User, _id: string, _dto: PreventionBudgetRecalculateDto) {
    await this.enabledOrg(user);
    throw new ConflictException(LEGACY_BUDGET_CALCULATION_MESSAGE);
  }

  private async ensureMaterializedActionScope(user: User, scenarioId: string, itemId: string, expectedVersion: number, forRecalculation = false) {
    const organizationId = await this.enabledOrg(user);
    return this.db.transaction(async (manager) => {
      // Serialize lazy action-scope creation per tenant. The action scope is a
      // one-line internal version chain; it is never the completed global ALL.
      const [organization] = await manager.query('SELECT id FROM organizations WHERE id=? FOR UPDATE', [organizationId]);
      if (!organization) throw new NotFoundException('Organisation introuvable');
      const [origin] = await manager.query(
        `SELECT i.*,s.scenarioKey,s.missionId originMissionId,s.missionIds originMissionIds,
                s.categoryId originCategoryId,s.categoryIds originCategoryIds,s.severity originSeverity,s.severities originSeverities,
                s.clientKeys originClientKeys,
                s.periodMode originPeriodMode,s.periodStart originPeriodStart,s.periodEnd originPeriodEnd,
                s.version originVersion,s.status scenarioStatus
         FROM prevention_budget_items i JOIN prevention_budget_scenarios s
           ON s.organizationId=i.organizationId AND s.id=i.scenarioId
         WHERE i.organizationId=? AND i.scenarioId=? AND i.id=? LIMIT 1`,
        [organizationId, scenarioId, itemId],
      );
      if (!origin) throw new NotFoundException('Poste budgétaire introuvable');
      this.assertVersion({ version: origin.originVersion }, expectedVersion);
      if (origin.scenarioStatus === 'DRAFT' || origin.scenarioStatus === 'ARCHIVED') throw new ConflictException('Poste budgétaire non disponible');
      if (forRecalculation && (Boolean(origin.lockedManual) || LOCKED.has(origin.status))) {
        throw new ConflictException('Un poste validé ou verrouillé ne peut pas être recalculé par IA');
      }
      if (!origin.clientKey || !/^[0-9a-f]{64}$|^unassigned$/.test(String(origin.clientKey))) {
        throw new ConflictException('Ce poste historique ne possède pas d’identité client fiable');
      }
      // Lock the same scenario chain used by normal budget writers. A plain
      // non-DRAFT read could accept an origin that was superseded concurrently.
      const latestOrigin = await this.latestAny(organizationId, origin.scenarioId, manager);
      if (latestOrigin.id !== origin.scenarioId || Number(latestOrigin.version) !== Number(origin.originVersion)) {
        throw new ConflictException('La version du poste a changé ; rechargez les résultats');
      }
      const originMissionId = origin.originMissionId ?? null;
      const scopeMissionIds = storedScopeArray(origin.originMissionIds);
      if (!scopeMissionIds.length && originMissionId) scopeMissionIds.push(String(originMissionId));
      const scopeCategoryIds = storedScopeArray(origin.originCategoryIds);
      if (!scopeCategoryIds.length && origin.originCategoryId) scopeCategoryIds.push(String(origin.originCategoryId));
      const scopeSeverities = storedScopeArray(origin.originSeverities);
      if (!scopeSeverities.length && origin.originSeverity) scopeSeverities.push(String(origin.originSeverity));
      const actionScope = {
        missionIds: scopeMissionIds,
        categoryIds: scopeCategoryIds,
        severities: scopeSeverities,
        periodMode: origin.originPeriodMode ?? 'ALL',
        periodStart: origin.originPeriodStart ?? null,
        periodEnd: origin.originPeriodEnd ?? null,
      };
      const actionKey = materializedActionScopeKey(organizationId, origin.itemKey, originMissionId, actionScope);
      const [existing] = await manager.query(
        `SELECT s.id,s.version,i.id itemId FROM prevention_budget_scenarios s
         JOIN prevention_budget_items i ON i.organizationId=s.organizationId AND i.scenarioId=s.id AND i.itemKey=?
         WHERE s.organizationId=? AND s.scenarioKey=? AND s.status<>'DRAFT'
         ORDER BY s.version DESC LIMIT 1`, [origin.itemKey, organizationId, actionKey],
      );
      if (existing) return { organizationId, scenarioId: String(existing.id), itemId: String(existing.itemId), version: Number(existing.version) };
      const [source] = await manager.query(
        `SELECT f.actionType FROM prevention_budget_item_sources src
         JOIN prevention_findings f ON f.organizationId=src.organizationId AND f.id=src.findingId
           AND f.findingType='RECOMMENDATION'
         WHERE src.organizationId=? AND src.itemId=? AND src.sourceKind='RECOMMENDATION'
         ORDER BY src.id LIMIT 1`, [organizationId, origin.id],
      );
      if (!source?.actionType) throw new ConflictException('Aucun type de recommandation fiable pour ce poste');
      const periodSql = actionScope.periodMode === 'ALL' ? '' : 'AND f.businessDate BETWEEN ? AND ?';
      const severity = actionSeverityPredicate(scopeSeverities);
      const legacyCandidateScope = !scopeCategoryIds.length && !scopeSeverities.length && (actionScope.periodMode ?? 'ALL') === 'ALL' && scopeMissionIds.length <= 1;
      const candidates = await manager.query(
        `SELECT f.id,f.reportId,f.sourceGroupId,f.normalizedKey,f.patternKey,f.content,f.actionType,
                m.client,COALESCE(c.code,'UNCATEGORIZED') categoryKey
         FROM prevention_findings f
         LEFT JOIN missions m ON m.id=f.missionId AND m.organizationId=f.organizationId
         LEFT JOIN prevention_categories c ON c.id=f.categoryId AND c.organizationId=f.organizationId
         WHERE f.organizationId=? AND f.findingType='RECOMMENDATION' AND f.actionType=?
           ${periodSql}
           ${scopeMissionIds.length ? (legacyCandidateScope ? 'AND f.missionId=?' : 'AND f.missionId IN (?)') : ''}
           ${scopeCategoryIds.length ? 'AND f.categoryId IN (?)' : ''}
           ${severity.sql.replace(/^AND\s+/, 'AND ')} ORDER BY f.id LIMIT 5001`,
        [organizationId, source.actionType,
          ...(actionScope.periodMode === 'ALL' ? [] : [actionScope.periodStart, actionScope.periodEnd]),
          ...(scopeMissionIds.length ? [legacyCandidateScope ? scopeMissionIds[0] : scopeMissionIds] : []),
          ...(scopeCategoryIds.length ? [scopeCategoryIds] : []), ...severity.args],
      );
      if (candidates.length > 5000) throw new ConflictException('Trop de recommandations pour un traitement ciblé ; réduisez le périmètre du calcul');
      const related = candidates.filter((finding: any) => budgetClientActionKey(
        budgetClientIdentity(finding.client).key, budgetActionGroup(finding).itemKey,
      ) === origin.itemKey);
      if (!related.length) throw new ConflictException('Les recommandations sources de ce poste ont changé');
      const newScenarioId = randomUUID(); const newItemId = randomUUID();
      const amount = String(origin.totalHt);
      const legacyActionScope = !scopeCategoryIds.length && !scopeSeverities.length && (actionScope.periodMode ?? 'ALL') === 'ALL' && scopeMissionIds.length <= 1;
      if (legacyActionScope) {
        await manager.query(
          `INSERT INTO prevention_budget_scenarios
           (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,status,executionStatus,
            contingencyRatePercent,retainedBudgetHt,estimatedBudgetHt,validatedBudgetHt,contingencyAmountHt,totalBudgetHt,clientKeys,missionId)
           VALUES (?,?,?,1,'action-bootstrap-v1',NULL,NULL,'ALL','CALCULATED','COMPLETED',0,?,?,?,0,?,?,?)`,
          [newScenarioId, organizationId, actionKey, amount,
            origin.status === 'ESTIME' ? amount : '0.00', LOCKED.has(origin.status) ? amount : '0.00', amount,
            JSON.stringify([origin.clientKey]), originMissionId],
        );
      } else {
        await manager.query(
          `INSERT INTO prevention_budget_scenarios
           (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,missionIds,categoryId,categoryIds,severity,severities,status,executionStatus,
            contingencyRatePercent,retainedBudgetHt,estimatedBudgetHt,validatedBudgetHt,contingencyAmountHt,totalBudgetHt,clientKeys)
           VALUES (?,?,?,1,'action-bootstrap-v2',?,?,?,?,?,?,?,?,?,'CALCULATED','COMPLETED',0,?,?,?,0,?,?)`,
          [newScenarioId, organizationId, actionKey, actionScope.periodStart ?? null, actionScope.periodEnd ?? null, actionScope.periodMode ?? 'ALL',
            originMissionId, JSON.stringify(scopeMissionIds), origin.originCategoryId ?? null, JSON.stringify(scopeCategoryIds), origin.originSeverity ?? null, JSON.stringify(scopeSeverities), amount,
            origin.status === 'ESTIME' ? amount : '0.00', LOCKED.has(origin.status) ? amount : '0.00', amount,
            JSON.stringify([origin.clientKey])],
        );
      }
      await manager.query(
        `INSERT INTO prevention_budget_items
         (id,organizationId,scenarioId,itemKey,catalogId,categoryId,categoryKey,clientKey,clientLabel,title,priority,
          quantity,unit,unitCostHt,totalHt,status,justification,aiEstimateDetails,priceSource,lockedManual)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [newItemId, organizationId, newScenarioId, origin.itemKey, origin.catalogId ?? null, origin.categoryId ?? null,
          origin.categoryKey, origin.clientKey, origin.clientLabel ?? null, origin.title, origin.priority,
          origin.quantity, origin.unit, origin.unitCostHt, amount, origin.status, origin.justification ?? null,
          origin.aiEstimateDetails == null ? null : typeof origin.aiEstimateDetails === 'string' ? origin.aiEstimateDetails : JSON.stringify(origin.aiEstimateDetails),
          origin.priceSource ?? null, origin.lockedManual ? 1 : 0],
      );
      for (const finding of related) await manager.query(
        `INSERT INTO prevention_budget_item_sources
         (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId)
         VALUES (?,?,?,'RECOMMENDATION',?,?,?)`,
        [randomUUID(), organizationId, newItemId, preventionBudgetStableRecommendationKey(finding), finding.id, finding.reportId],
      );
      return { organizationId, scenarioId: newScenarioId, itemId: newItemId, version: 1 };
    });
  }

  async recalculateMaterializedItem(user: User, scenarioId: string, itemId: string, dto: PreventionBudgetItemRecalculateDto) {
    if (!dto.adminPrompt?.trim()) throw new BadRequestException('Une consigne IA est obligatoire pour ce recalcul ciblé');
    const action = await this.ensureMaterializedActionScope(user, scenarioId, itemId, dto.expectedVersion, true);
    return this.recalculateItem(user, action.scenarioId, action.itemId, { ...dto, expectedVersion: action.version });
  }

  async patchMaterializedItem(user: User, scenarioId: string, itemId: string, dto: PreventionBudgetItemPatchDto) {
    const action = await this.ensureMaterializedActionScope(user, scenarioId, itemId, dto.expectedVersion);
    return this.patchItem(user, action.scenarioId, action.itemId, { ...dto, expectedVersion: action.version });
  }

  async recalculateItem(user: User, scenarioId: string, itemId: string, dto: PreventionBudgetItemRecalculateDto) {
    const organizationId = await this.enabledOrg(user);
    const result = await this.db.transaction(async (manager) => {
      const [requested] = await manager.query(
        'SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1', [scenarioId, organizationId],
      );
      const base = await this.latestAny(organizationId, scenarioId, manager);
      const retryingFailedDraft = Boolean(requested?.failedAt)
        && requested.id !== base.id
        && base.status !== 'DRAFT'
        && Number(requested.version) > Number(base.version);
      if (retryingFailedDraft) this.assertVersion(requested, dto.expectedVersion);
      else this.assertVersion(base, dto.expectedVersion);
      if (base.status === 'ARCHIVED') throw new BadRequestException('Un scénario archivé ne peut pas être recalculé');
      // A full-scope rebuild still requires GLOBAL_YEARLY admission. Editing
      // one existing client/action is a separate, versioned targeted job.
      const [requestedItem] = requested && requested.id !== base.id
        ? await manager.query('SELECT * FROM prevention_budget_items WHERE id=? AND organizationId=? AND scenarioId=? LIMIT 1', [itemId, organizationId, requested.id])
        : [null];
      const [item] = await manager.query('SELECT * FROM prevention_budget_items WHERE id=? AND organizationId=? AND scenarioId=? LIMIT 1', [itemId, organizationId, base.id]);
      const [resolvedItem] = item ? [item] : requestedItem?.itemKey
        ? await manager.query('SELECT * FROM prevention_budget_items WHERE itemKey=? AND organizationId=? AND scenarioId=? LIMIT 1', [requestedItem.itemKey, organizationId, base.id])
        : [null];
      if (!resolvedItem) throw new NotFoundException('Poste budgétaire introuvable');
      if (Boolean(resolvedItem.lockedManual) || LOCKED.has(resolvedItem.status)) throw new ConflictException('Un poste validé ou verrouillé ne peut pas être recalculé par IA');
      const cloned = await this.cloneScenario(manager, organizationId, base, user.id, { status: 'DRAFT', action: 'RECALCULATE_ITEM', note: `Recalcul IA du poste ${itemId}` });
      const [copy] = await manager.query('SELECT id FROM prevention_budget_items WHERE organizationId=? AND scenarioId=? AND itemKey=? LIMIT 1', [organizationId, cloned.id, resolvedItem.itemKey]);
      if (!copy) throw new NotFoundException('Poste budgétaire introuvable dans la nouvelle version');
      const inheritedPrompt = requestedItem && requested?.failedAt ? requestedItem.adminPrompt : resolvedItem.adminPrompt;
      const prompt = dto.adminPrompt === undefined ? (inheritedPrompt?.trim() || null) : (dto.adminPrompt.trim() || null);
      await manager.query('UPDATE prevention_budget_items SET adminPrompt=?,adminPromptActorId=? WHERE id=? AND organizationId=? AND scenarioId=?', [prompt, prompt ? user.id : null, copy.id, organizationId, cloned.id]);
      const [updated] = await manager.query('SELECT * FROM prevention_budget_items WHERE id=? AND organizationId=?', [copy.id, organizationId]);
      return { scenario: cloned, item: updated };
    });
    try {
      const job = await this.budget.enqueueRecalculateItem({ organizationId, scenarioId: result.scenario.id, itemId: result.item.id });
      return { scenario: this.serializeScenario(result.scenario, true), item: result.item, job };
    } catch (error) {
      await this.markScenarioFailed(result.scenario.id, organizationId);
      throw error;
    }
  }

  private async markScenarioFailed(scenarioId: string, organizationId: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE prevention_budget_scenarios
         SET failedAt=COALESCE(failedAt,UTC_TIMESTAMP(6))
         WHERE id=? AND organizationId=? AND status='DRAFT' AND failedAt IS NULL`,
        [scenarioId, organizationId],
      );
    } catch {
      // Preserve the enqueue failure for the caller; the next reconciliation
      // or operator retry must not be hidden by marker bookkeeping.
    }
  }

  async patchScenario(user: User, _id: string, _dto: PreventionBudgetPatchDto) {
    await this.enabledOrg(user);
    throw new ConflictException(LEGACY_BUDGET_CALCULATION_MESSAGE);
  }

  async patchItem(user: User, scenarioId: string, itemId: string, dto: PreventionBudgetItemPatchDto) {
    const organizationId = await this.enabledOrg(user);
    const result = await this.db.transaction(async (manager) => {
      const base = await this.latestAny(organizationId, scenarioId, manager);
      this.assertVersion(base, dto.expectedVersion);
      if (base.status === 'ARCHIVED') throw new BadRequestException('Un scénario archivé ne peut pas être modifié');
      // Human validation of one line remains possible after global publication;
      // it never launches a new full-scope AI calculation.
      const [target] = await manager.query('SELECT * FROM prevention_budget_items WHERE id=? AND organizationId=? AND scenarioId=? LIMIT 1', [itemId, organizationId, base.id]);
      if (!target) throw new NotFoundException('Poste budgétaire introuvable');
      if (dto.categoryId !== undefined) {
        const [category] = await manager.query(
          'SELECT id FROM prevention_categories WHERE id=? AND organizationId=? LIMIT 1',
          [dto.categoryId, organizationId],
        );
        if (!category) throw new BadRequestException('Catégorie introuvable dans l’organisation');
      }
      const next = {
        title: dto.title ?? target.title, categoryId: dto.categoryId ?? target.categoryId, categoryKey: dto.categoryKey ?? target.categoryKey,
        quantity: dto.quantity ?? String(target.quantity), unit: dto.unit ?? target.unit, unitCostHt: dto.unitCostHt === undefined ? target.unitCostHt : dto.unitCostHt,
        priceSource: dto.priceSource === undefined ? target.priceSource : dto.priceSource, status: dto.status ?? target.status,
        priority: dto.priority ?? target.priority, justification: dto.justification === undefined ? target.justification : dto.justification,
      };
      this.validateLine(next);
      const lockedManual = dto.lockedManual === undefined ? Boolean(target.lockedManual) : dto.lockedManual;
      if (LOCKED.has(next.status) && !lockedManual) throw new BadRequestException('Un statut engagé ou validé exige une valeur manuelle verrouillée');
      if (next.status === 'A_CHIFFRER' && lockedManual) throw new BadRequestException('Un poste à chiffrer ne peut pas être verrouillé');
      const totalHt = budgetLineTotal(String(next.quantity), next.unitCostHt == null ? null : String(next.unitCostHt));
      const priorItems: Array<{ id: string; totalHt: string; status: string }> = await manager.query(
        'SELECT id,totalHt,status FROM prevention_budget_items WHERE organizationId=? AND scenarioId=?', [organizationId, base.id],
      );
      if (!priorItems.some((row) => row.id === target.id)) throw new ConflictException('Le poste budgétaire a changé pendant sa validation');
      const totals = summarizeBudgetItems(priorItems.map((row) => row.id === target.id
        ? { ...row, totalHt, status: next.status } : row), String(base.contingencyRatePercent));
      const cloned = await this.cloneScenario(manager, organizationId, base, user.id, {
        status: 'CALCULATED', action: 'RECALCULATE', note: `Modification manuelle du poste ${itemId}`, totals,
      });
      const [copy] = await manager.query('SELECT * FROM prevention_budget_items WHERE organizationId=? AND scenarioId=? AND itemKey=? LIMIT 1', [organizationId, cloned.id, target.itemKey]);
      if (!copy) throw new NotFoundException('Poste budgétaire introuvable dans la nouvelle version');
      await manager.query(`UPDATE prevention_budget_items SET title=?,categoryId=?,categoryKey=?,quantity=?,unit=?,unitCostHt=?,totalHt=?,priceSource=?,status=?,priority=?,justification=?,lockedManual=? WHERE id=? AND organizationId=? AND scenarioId=?`, [
        next.title, next.categoryId, next.categoryKey, next.quantity, next.unit, next.unitCostHt, totalHt,
        next.priceSource, next.status, next.priority, next.justification,
        lockedManual ? 1 : 0, copy.id, organizationId, cloned.id,
      ]);
      if (dto.sources !== undefined) await this.replaceSources(manager, organizationId, copy.id, dto.sources);
      const [updated] = await manager.query('SELECT * FROM prevention_budget_items WHERE id=? AND organizationId=?', [copy.id, organizationId]);
      await manager.query(
        `INSERT INTO prevention_budget_audit
          (id,organizationId,scenarioId,scenarioVersion,action,actorType,actorId,beforeState,afterState)
         VALUES (?,?,?,?,?,'ADMIN',?,?,?)`,
        [randomUUID(), organizationId, cloned.id, Number(cloned.version), 'RECALCULATE', user.id,
          JSON.stringify({ itemId: target.id, quantity: target.quantity, unit: target.unit, unitCostHt: target.unitCostHt, status: target.status, lockedManual: Boolean(target.lockedManual), priceSource: target.priceSource, priority: target.priority, justification: target.justification }),
          JSON.stringify({ kind: 'ITEM_UPDATED', itemId: updated.id, quantity: updated.quantity, unit: updated.unit, unitCostHt: updated.unitCostHt, totalHt: updated.totalHt, status: updated.status, lockedManual: Boolean(updated.lockedManual), priceSource: updated.priceSource, priority: updated.priority, justification: updated.justification })],
      );
      return { scenario: cloned, item: updated };
    });
    return { scenario: this.serializeScenario(result.scenario), item: result.item, job: null };
  }

  async catalog(user: User) {
    const organizationId = await this.enabledOrg(user);
    return this.db.query('SELECT id,version,matchingKey,categoryId,categoryKey,label,unit,unitCostHt,priceSource,validFrom,validTo,isActive,createdAt FROM prevention_cost_catalog WHERE organizationId=? ORDER BY version DESC,id ASC', [organizationId]);
  }

  async createCatalog(user: User, _dto: PreventionCostCatalogCreateDto) {
    await this.enabledOrg(user);
    throw new ConflictException('Le catalogue tarifaire hérité ne peut plus déclencher de recalcul automatique');
  }

  async setCatalogStatus(user: User, _id: string, _dto: PreventionCostCatalogStatusDto) {
    await this.enabledOrg(user);
    throw new ConflictException('Le catalogue tarifaire hérité ne peut plus déclencher de recalcul automatique');
  }

  async job(user: User, id: string) {
    const organizationId = await this.enabledOrg(user);
    const result = await this.budget.jobStatus(organizationId, id) ?? await this.budget.globalRunStatus(organizationId, id);
    if (!result) throw new NotFoundException('Job Budget introuvable');
    return result;
  }

  private assertVersion(row: any, expected: number): void {
    if (Number(row.version) !== Number(expected)) throw new ConflictException({ message: 'Version budgétaire obsolète', currentVersion: Number(row.version) });
  }

  private validateLine(line: any): void {
    if (!line.title?.trim() || !line.unit?.trim() || !QUANTITY.test(String(line.quantity)) || Number(line.quantity) <= 0) throw new BadRequestException('Poste budgétaire invalide');
    this.assertMoney(line.unitCostHt, 'Coût unitaire');
    if (line.unitCostHt !== null && line.unitCostHt !== undefined && !String(line.priceSource ?? '').trim()) throw new BadRequestException('La source tarifaire est obligatoire dès qu’un montant est renseigné');
    if (line.priceSource !== null && line.priceSource !== undefined && String(line.priceSource).trim() && (line.unitCostHt === null || line.unitCostHt === undefined)) throw new BadRequestException('Un coût unitaire est obligatoire avec une source tarifaire');
    if (line.status === 'A_CHIFFRER' && (line.unitCostHt !== null || line.priceSource !== null)) throw new BadRequestException('Un poste à chiffrer ne peut pas conserver un montant');
    if (line.status !== 'A_CHIFFRER' && (line.unitCostHt === null || !String(line.priceSource ?? '').trim())) throw new BadRequestException('Le statut choisi exige un prix sourcé');
  }

  private async cloneScenario(manager: any, organizationId: string, base: any, actorId: string, options: { contingencyRatePercent?: string; status: string; action: string; note: string; adminPrompt?: string | null; totals?: ReturnType<typeof summarizeBudgetItems> }): Promise<any> {
    const [latest] = await manager.query('SELECT version FROM prevention_budget_scenarios WHERE organizationId=? AND scenarioKey=? ORDER BY version DESC LIMIT 1 FOR UPDATE', [organizationId, base.scenarioKey]);
    const version = Number(latest?.version ?? base.version) + 1;
    const id = randomUUID(); const sourceVersion = digest(`admin|${organizationId}|${base.scenarioKey}|${version}|${actorId}|${todayKey()}|${randomUUID()}`);
    const adminPrompt = options.adminPrompt === undefined ? base.adminPrompt ?? null : options.adminPrompt;
    const adminPromptActorId = options.adminPrompt === undefined ? base.adminPromptActorId ?? null : adminPrompt ? actorId : null;
    await manager.query(`INSERT INTO prevention_budget_scenarios (id,organizationId,scenarioKey,version,sourceVersion,periodStart,periodEnd,periodMode,missionId,missionIds,categoryId,categoryIds,severity,severities,clientKeys,adminPrompt,adminPromptActorId,status,executionStatus,contingencyRatePercent,retainedBudgetHt,estimatedBudgetHt,validatedBudgetHt,contingencyAmountHt,totalBudgetHt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?)`, [
      id, organizationId, base.scenarioKey, version, sourceVersion, base.periodStart ?? null, base.periodEnd ?? null, base.periodMode ?? 'BOUNDED', base.missionId ?? null, JSON.stringify(storedScopeArray(base.missionIds)), base.categoryId ?? null, JSON.stringify(storedScopeArray(base.categoryIds)), base.severity ?? null, JSON.stringify(storedScopeArray(base.severities)),
      JSON.stringify(storedBudgetClientKeys(base.clientKeys)), adminPrompt, adminPromptActorId,
      options.status, options.status === 'CALCULATED' ? 'COMPLETED' : 'PENDING',
      '0.00',
      options.totals?.retainedBudgetHt ?? base.retainedBudgetHt,
      options.totals?.estimatedBudgetHt ?? base.estimatedBudgetHt,
      options.totals?.validatedBudgetHt ?? base.validatedBudgetHt,
      '0.00',
      options.totals?.retainedBudgetHt ?? base.retainedBudgetHt,
    ]);
    const items = await manager.query('SELECT * FROM prevention_budget_items WHERE organizationId=? AND scenarioId=? ORDER BY id ASC', [organizationId, base.id]);
    const itemMap = new Map<string, string>();
    for (const item of items) {
      const copyId = randomUUID(); itemMap.set(item.id, copyId);
      await manager.query(`INSERT INTO prevention_budget_items (id,organizationId,scenarioId,itemKey,catalogId,categoryId,categoryKey,clientKey,clientLabel,title,priority,quantity,unit,unitCostHt,totalHt,status,justification,aiEstimateDetails,adminPrompt,adminPromptActorId,priceSource,lockedManual) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        copyId, organizationId, id, item.itemKey, item.catalogId, item.categoryId, item.categoryKey, item.clientKey ?? null, item.clientLabel ?? null,
        item.title, item.priority, item.quantity, item.unit, item.unitCostHt, item.totalHt, item.status, item.justification,
        item.aiEstimateDetails == null ? null : typeof item.aiEstimateDetails === 'string' ? item.aiEstimateDetails : JSON.stringify(item.aiEstimateDetails),
        item.adminPrompt ?? null, item.adminPromptActorId ?? null, item.priceSource, item.lockedManual,
      ]);
    }
    const sources = items.length
      ? await manager.query('SELECT * FROM prevention_budget_item_sources WHERE organizationId=? AND itemId IN (?)', [organizationId, items.map((item: any) => item.id)])
      : [];
    for (const source of sources) await manager.query('INSERT INTO prevention_budget_item_sources (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId) VALUES (?,?,?,?,?,?,?)', [randomUUID(), organizationId, itemMap.get(source.itemId), source.sourceKind, source.sourceKey, source.findingId, source.reportId]);
    const auditId = randomUUID();
    await manager.query(`INSERT INTO prevention_budget_audit (id,organizationId,scenarioId,scenarioVersion,action,actorType,actorId,beforeState,afterState) VALUES (?,?,?,?,?,'ADMIN',?,?,?)`, [auditId, organizationId, id, version, options.action, actorId,
      JSON.stringify({ scenarioId: base.id, version: base.version, promptHash: base.adminPrompt ? digest(base.adminPrompt) : null }),
      JSON.stringify({ note: options.note, sourceScenarioId: base.id, promptHash: adminPrompt ? digest(adminPrompt) : null })]);
    return { ...base, id, version, sourceVersion, status: options.status, adminPrompt, adminPromptActorId,
      ...options.totals, contingencyRatePercent: '0.00', contingencyAmountHt: '0.00', totalBudgetHt: options.totals?.retainedBudgetHt ?? base.retainedBudgetHt, auditId };
  }

  private async replaceSources(manager: any, organizationId: string, itemId: string, sources: PreventionBudgetSourceDto[]): Promise<void> {
    await manager.query('DELETE FROM prevention_budget_item_sources WHERE organizationId=? AND itemId=?', [organizationId, itemId]);
    for (const source of sources) {
      if (!source.reportId || (source.sourceKind !== 'REPORT' && !source.findingId)) throw new BadRequestException('Une source doit référencer un rapport et, si nécessaire, un constat');
      const [report] = await manager.query('SELECT id FROM reports WHERE organizationId=? AND id=? LIMIT 1', [organizationId, source.reportId]);
      if (!report) throw new BadRequestException('Rapport source introuvable dans l’organisation');
      let finding: any;
      if (source.sourceKind !== 'REPORT') {
        [finding] = await manager.query('SELECT id,reportId,findingType,sourceGroupId,normalizedKey FROM prevention_findings WHERE organizationId=? AND id=? LIMIT 1', [organizationId, source.findingId]);
        if (!finding || finding.reportId !== source.reportId || (source.sourceKind === 'RECOMMENDATION' && finding.findingType !== 'RECOMMENDATION')) throw new BadRequestException('Constat source introuvable ou incohérent');
      }
      const sourceKey = source.sourceKind === 'RECOMMENDATION'
        ? preventionBudgetStableRecommendationKey(finding)
        : preventionBudgetSourceKey(source.sourceKind, source.findingId ?? null, source.reportId);
      await manager.query('INSERT INTO prevention_budget_item_sources (id,organizationId,itemId,sourceKind,sourceKey,findingId,reportId) VALUES (?,?,?,?,?,?,?)', [randomUUID(), organizationId, itemId, source.sourceKind, sourceKey, source.findingId ?? null, source.reportId]);
    }
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function summarizeBudgetItems(items: Array<any>, _rateValue: string): Record<string, string> {
  const cents = (value: unknown): bigint => {
    const text = String(value ?? '0'); const [whole, fraction = ''] = text.split('.');
    return BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  };
  const format = (value: bigint): string => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
  const locked = new Set(['VALIDE', 'ENGAGE', 'REALISE']);
  const retained = items.reduce((sum, item) => sum + cents(item.totalHt), 0n);
  const estimated = items.filter((item) => item.status === 'ESTIME').reduce((sum, item) => sum + cents(item.totalHt), 0n);
  const validated = items.filter((item) => locked.has(String(item.status))).reduce((sum, item) => sum + cents(item.totalHt), 0n);
  return { retainedBudgetHt: format(retained), estimatedBudgetHt: format(estimated), validatedBudgetHt: format(validated), contingencyAmountHt: '0.00', totalBudgetHt: format(retained) };
}
