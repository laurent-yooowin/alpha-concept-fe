import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { orgScope } from '../common/utils/org-scope';
import { Visit } from './visit.entity';
import {
  AnalysisGroupAttachDto,
  AnalysisGroupBulkEditDto,
  AnalysisGroupClarifyDto,
  AnalysisGroupCreateDto,
  AnalysisGroupPatchDto,
  AnalysisGroupReanalyzeAllDto,
  AnalysisGroupReanalyzeDto,
  CreateVisitDto,
  UpdateVisitDto,
} from './visit.dto';
import { User, UserRole } from '../user/user.entity';
import { MissionService } from '../missions/mission.service';
import { MissionStatus, UpdateMissionDto } from '../missions/mission.dto';
import { ReportService } from '../reports/report.service';
import { CreateReportDto } from '../reports/report.dto';
import { ReportStatus, isReportLocked } from '../reports/report.entity';
import { AiService, AiAnalysisResult } from '../ai/ai.service';
import { CustomPromptService } from '../custom-prompts/custom-prompt.service';
import { PreventionGroupProcessingService } from '../prevention/worker/prevention-group-processing.service';
import { PreventionGroupEntry, preventionGroupSourceHash } from '../prevention/worker/prevention-group-source';
import { UploadService } from '../upload/upload.service';
import { VisitPhotoAssetService, visitPhotoKeyFromUrl } from '../upload/visit-photo-asset.service';

const ANALYSIS_REQUEST_STALE_MS = 15 * 60 * 1000;
const MAX_ANALYSIS_GROUP_PHOTOS = 20;
const VISIT_PHOTO_KEY = /^\/visits\/photos\/[0-9a-f-]{36}\.(?:jpe?g|jfif|png|webp|avif)$/i;

@Injectable()
export class VisitService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Visit)
    private visitRepository: Repository<Visit>,

    @Inject(forwardRef(() => MissionService))
    private missionService: MissionService,

    @Inject(forwardRef(() => ReportService))
    private reportService: ReportService,

    private readonly aiService: AiService,
    private readonly customPromptService: CustomPromptService,
    @Inject(forwardRef(() => PreventionGroupProcessingService))
    private readonly groupProcessing: PreventionGroupProcessingService,
    @Optional() private readonly uploadService?: UploadService,
    @Optional() private readonly photoAssets?: VisitPhotoAssetService,
  ) { }

  private async invalidateReportPdf(manager: EntityManager, organizationId: string, visitId: string): Promise<void> {
    // Serialize every visit mutation with its linked report. A status change
    // that commits while SPS/AI work is in flight must win at persistence time.
    await manager.query(
      `UPDATE reports SET reportFileUrl=NULL WHERE organizationId=? AND visitId=? AND reportFileUrl IS NOT NULL`,
      [organizationId, visitId],
    );
    const [report] = await manager.query(
      `SELECT id,organizationId,status,header,footer FROM reports WHERE visitId=? LIMIT 1 FOR UPDATE`,
      [visitId],
    );
    if (!report) return;
    if (report.organizationId !== organizationId) {
      throw new ConflictException('Le rapport lié à cette visite appartient à une autre organisation');
    }
    if (isReportLocked(report.status)) {
      throw new ConflictException('Cette visite est verrouillée par un rapport envoyé au client ou archivé');
    }
    const [visit] = await manager.query(
      `SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1`,
      [organizationId, visitId],
    );
    if (!visit) throw new NotFoundException('Visite introuvable');
    const photos = this.parsePhotos(visit.photos);
    let content = '';
    let header = '';
    let footer = '';
    let conformityPercentage = 0;
    if (photos.length) {
      const [mission] = await manager.query(
        `SELECT title,client,address FROM missions WHERE organizationId=? AND id=? LIMIT 1`,
        [organizationId, visit.missionId],
      );
      if (!mission) throw new ConflictException('Chantier de la visite introuvable');
      const generated = this.buildGeneratedReportDto({ ...visit, photos, mission } as Visit);
      content = generated.content;
      header = report.header ?? generated.header ?? '';
      footer = report.footer ?? generated.footer ?? '';
      conformityPercentage = generated.conformityPercentage ?? 0;
    }
    await manager.query(
      `UPDATE reports SET content=?,header=?,footer=?,conformityPercentage=?,reportFileUrl=NULL,updatedAt=UTC_TIMESTAMP(6)
       WHERE organizationId=? AND id=?`,
      [content, header, footer, conformityPercentage, organizationId, report.id],
    );
    await manager.query(
      `UPDATE visits SET reportGenerated=? WHERE organizationId=? AND id=?`,
      [photos.length ? 1 : 0, organizationId, visitId],
    );
    await this.reportService.notifyVisitReportChangedInTransaction(manager, organizationId, report.id);
  }

  private assertReanalysisConfiguration(dto: AnalysisGroupReanalyzeDto, directiveRequired = false, globalDirectives?: string, globalCustomPromptIds?: string[]): void {
    if (typeof dto.userDirectives === 'string' && dto.userDirectives.trim()) return;
    if (directiveRequired) {
      throw new BadRequestException('Ce rapport est fondé sur les directives : saisissez un contenu, même si un prompt custom est sélectionné.');
    }
    if (globalDirectives?.trim()) return;
    if (globalCustomPromptIds?.length) return;
    if (Array.isArray(dto.customPromptIds) && dto.customPromptIds.length > 0) return;
    throw new BadRequestException('Saisissez une directive ou sélectionnez au moins un prompt custom pour lancer la réanalyse.');
  }

  async create(user: User, createVisitDto: CreateVisitDto): Promise<Visit> {
    const userId = user.id;
    const mission = await this.missionService.findOne(createVisitDto.missionId, user);
    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    if (mission.status === 'terminee' || mission.status === 'annulee' || mission.status === 'validee') {
      throw new NotFoundException('Cannot add visit to a completed mission');
    }

    if (mission.userId !== userId && user.role !== UserRole.ADMIN) {
      throw new NotFoundException('You are not assigned to this mission');
    }

    const visit = this.visitRepository.create({
      ...createVisitDto,
      userId,
      organizationId: user.organizationId,
      photoCount: 0,
      visitDate: new Date(createVisitDto.visitDate),
    });

    if (mission && (mission.status === 'planifiee' || mission.status === 'assignee')) {
      const updateMissionDto = new UpdateMissionDto();
      updateMissionDto.status = MissionStatus.IN_PROGRESS;
      await this.missionService.update(mission.id, user, updateMissionDto);
    }

    const saved = await this.visitRepository.save(visit);
    return saved;
  }

  async findAll(user: User, missionId?: string): Promise<Visit[]> {
    const where: any = orgScope(user);

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    if (missionId) {
      where.missionId = missionId;
    }

    return this.visitRepository.find({
      where,
      relations: ['mission', 'user', 'report'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByMission(missionId: string, user: User): Promise<Visit[]> {
    const where: any = orgScope(user, { missionId });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    return this.visitRepository.find({
      where,
      order: { visitDate: 'DESC' },
    });
  }

  async findOne(id: string, user: User): Promise<Visit> {
    const where: any = orgScope(user, { id });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    const visit = await this.visitRepository.findOne({
      where,
      relations: ['mission', 'user', 'report'],
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    return visit;
  }

  async update(id: string, user: User, updateVisitDto: UpdateVisitDto): Promise<Visit> {
    const visit = await this.findOne(id, user);
    this.assertMutableVisit(visit);
    if (Object.prototype.hasOwnProperty.call(updateVisitDto, 'photos')) {
      throw new BadRequestException('Les photos se modifient via les commandes analysis-groups');
    }
    if (Object.prototype.hasOwnProperty.call(updateVisitDto, 'reportGenerated')) {
      throw new BadRequestException('La génération du rapport est gérée par le backend');
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updateVisitDto.visitDate !== undefined) {
      fields.push('visitDate=?');
      values.push(new Date(updateVisitDto.visitDate));
    }
    if (updateVisitDto.notes !== undefined) {
      fields.push('notes=?');
      values.push(updateVisitDto.notes);
    }
    if (updateVisitDto.customPromptIds !== undefined) {
      fields.push('customPromptIds=?');
      values.push(JSON.stringify(updateVisitDto.customPromptIds));
    }
    if (!fields.length) return visit;
    await this.dataSource.transaction(async (manager) => {
      const [locked] = await manager.query(
        `SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
        [user.organizationId, id],
      );
      this.assertLockedVisitAccess(locked, user);
      await manager.query(
        `UPDATE visits SET ${fields.join(',')},updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`,
        [...values, user.organizationId, id],
      );
      await this.invalidateReportPdf(manager, user.organizationId, id);
    });
    return this.findOne(id, user);
  }

  private assertRequestId(requestId: string): string {
    const value = String(requestId || '').trim();
    if (!value || value.length > 128) throw new BadRequestException('requestId est requis et doit être borné');
    return value;
  }

  private assertImageUrls(urls: string[]): string[] {
    if (!Array.isArray(urls)) throw new BadRequestException('Liste de photos invalide');
    if (urls.length > MAX_ANALYSIS_GROUP_PHOTOS) {
      throw new BadRequestException(`Un groupe ne peut pas dépasser ${MAX_ANALYSIS_GROUP_PHOTOS} photos`);
    }
    const normalized = urls.map((url) => String(url).trim()).filter(Boolean);
    if (new Set(normalized).size !== normalized.length) throw new BadRequestException('Une photo ne peut apparaître qu’une fois dans la demande');
    return normalized.map((url) => {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new BadRequestException('URL de photo invalide'); }
      const configuredBucket = process.env.AWS_S3_BUCKET;
      const configuredRegion = process.env.AWS_REGION;
      const expectedHost = configuredBucket && configuredRegion
        ? `${configuredBucket}.s3.${configuredRegion}.amazonaws.com`
        : null;
      const isS3Host = expectedHost
        ? parsed.hostname === expectedHost
        : /^[a-z0-9][a-z0-9.-]*\.s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(parsed.hostname);
      if (url.length > 4096 || parsed.protocol !== 'https:' || !isS3Host || parsed.search || parsed.hash || parsed.port ||
          !VISIT_PHOTO_KEY.test(parsed.pathname)) {
        throw new BadRequestException('URL de photo invalide');
      }
      return url;
    });
  }

  private assertGroupId(groupId: string): string {
    const value = String(groupId || '').trim();
    if (!value || value.length > 100) throw new BadRequestException('Identifiant de groupe invalide');
    return value;
  }

  private assertLockedVisitAccess(row: any, user: User): void {
    if (!row) throw new NotFoundException('Visite introuvable');
    if (user.role === UserRole.USER && row.userId !== user.id) {
      throw new NotFoundException('Visite introuvable');
    }
  }

  private assertMutableVisit(visit: Visit): void {
    if (isReportLocked(visit.report?.status)) {
      throw new ConflictException('Cette visite est verrouillée par un rapport envoyé au client ou archivé');
    }
  }

  private async findMutableVisit(id: string, user: User): Promise<Visit> {
    const visit = await this.findOne(id, user);
    this.assertMutableVisit(visit);
    return visit;
  }

  private parsePhotos(value: unknown): PreventionGroupEntry[] {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { value = []; }
    }
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)) as PreventionGroupEntry[] : [];
  }

  private groupEntries(photos: PreventionGroupEntry[], groupId: string): PreventionGroupEntry[] {
    return photos.filter((entry, index) => {
      const id = typeof entry.groupId === 'string' && entry.groupId
        ? entry.groupId
        : (typeof entry.id === 'string' && entry.id ? entry.id : `entry-${index}`);
      return id === groupId;
    });
  }

  private async assertNewPhotoReceipts(user: User, visitId: string, groupId: string, urls: string[], receipts?: string[]): Promise<string[]> {
    if (!urls.length) return [];
    // Unit fixtures that construct VisitService without Nest's UploadModule
    // keep the historical in-memory contract; the application module always
    // provides this service and therefore takes the fail-closed path.
    if (!this.photoAssets) return [];
    return this.photoAssets.assertReceiptsForAttach(this.dataSource, user, visitId, groupId, urls, receipts || []);
  }

  private async assertPersistedPhotoAssets(user: User, visitId: string, groupId: string, entries: PreventionGroupEntry[]): Promise<void> {
    const urls = entries.filter((entry) => entry.isDirectiveOnly !== true && typeof entry.s3Url === 'string' && entry.s3Url)
      .map((entry) => String(entry.s3Url));
    if (!urls.length) return;
    if (!this.photoAssets) return;
    await this.photoAssets.assertGroupAssets(this.dataSource, user, visitId, groupId, urls);
  }

  /** Mirrors the historical Web SPS normalization before visit.photos persistence. */
  private normalizeSpsList(value: unknown): string[] {
    if (value === null || value === undefined || value === '') return [];
    const values = Array.isArray(value) ? value : [value];
    const partitioned: string[] = [];
    values.forEach((item) => {
      const normalized = String(item)
        .replace(/\r/g, '')
        .replace(/[ \t]+(?=[•▪◦]\s*)/g, '\n')
        .replace(/[ \t]+(?=\d{1,2}[.)]\s+[A-ZÀ-Ÿ])/g, '\n')
        .replace(/[ \t]+(?=(?:dangers?|risques?)\s*:)/gi, '\n');
      normalized.split(/\n+/).forEach((rawLine) => {
        const line = rawLine.replace(/^\s*(?:[-*•▪◦]+|\d{1,2}[.)])\s*/, '').trim();
        if (!line) return;
        if (/^(?:danger|dangers|risque|risques)\b/i.test(line) && partitioned.length > 0) {
          partitioned[partitioned.length - 1] += `\n${line}`;
        } else {
          partitioned.push(line);
        }
      });
    });
    return partitioned.filter(Boolean);
  }

  private analysisForPhoto(result: AiAnalysisResult): any {
    const nonConformities = this.normalizeSpsList(result.nonConformities);
    const conformityMessage = this.normalizeSpsList(result.photoConformityMessage);
    const observations = nonConformities.length
      ? nonConformities
      : conformityMessage.length
        ? conformityMessage
        : this.normalizeSpsList(result.observations);
    const rawRisk = String(result.riskLevel);
    const normalizedRisk = rawRisk === 'faible' || rawRisk === 'low'
      ? 'low'
      : rawRisk === 'moyen' || rawRisk === 'medium'
        ? 'medium'
        : 'high';
    const riskLevel = normalizedRisk === 'low' ? 'faible' : normalizedRisk === 'medium' ? 'moyen' : 'eleve';
    return {
      observation: observations,
      recommendation: this.normalizeSpsList(result.recommendations),
      references: this.normalizeSpsList(result.references),
      riskLevel,
      confidence: parseInt(String(result.confidence || '0'), 10),
      unreadableSections: this.normalizeSpsList(result.unreadableSections),
    };
  }

  private previousReportFor(entries: PreventionGroupEntry[]): string | undefined {
    const analysis = entries.find((entry) => entry.analysis)?.analysis as any;
    if (!analysis) return undefined;
    const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : [];
    return JSON.stringify({
      observations: list(analysis.observation ?? analysis.observations),
      recommendations: list(analysis.recommendation ?? analysis.recommendations),
      references: list(analysis.references),
      riskLevel: analysis.riskLevel,
      confidence: analysis.confidence,
    });
  }

  private async resolveAiContext(user: User, visitId: string, customPromptIds?: string[]) {
    const resolved = await this.customPromptService.resolveForAnalysis(user, customPromptIds || [], visitId);
    return {
      resolved,
      context: { customPromptText: resolved.combinedContent, missionType: resolved.missionType },
    };
  }

  private async reserveRequest(
    organizationId: string,
    visitId: string,
    userId: string,
    requestId: string,
    operation: 'CREATE' | 'REANALYZE' | 'CLARIFY' | 'REANALYZE_ALL',
    groupId?: string,
    input?: unknown,
    quotaUnits = 1,
  ): Promise<any> {
    const normalized = this.assertRequestId(requestId);
    const inputHash = createHash('sha256').update(JSON.stringify(input ?? {})).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      const candidateId = randomUUID();
      if (quotaUnits > 0) {
        // Serialize reservations per user. The request itself is inserted only
        // after this lock; if the limit is exceeded the whole transaction is
        // rolled back, leaving no durable request or visit mutation.
        await manager.query(`SELECT id FROM organizations WHERE id=? LIMIT 1 FOR UPDATE`, [organizationId]);
        await manager.query(`SELECT id FROM users WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [organizationId, userId]);
      }
      await manager.query(
        `INSERT INTO visit_analysis_requests (id,organizationId,visitId,requestId,userId,operation,groupId,inputHash,quotaUnits,status)
         VALUES (?,?,?,?,?,?,?,?,?,'PENDING')
         ON DUPLICATE KEY UPDATE id=id
        `,
        [candidateId, organizationId, visitId, normalized, userId, operation, groupId || null, inputHash, Number.isInteger(quotaUnits) && quotaUnits > 0 ? quotaUnits : 0],
      );
      const [row] = await manager.query(
        `SELECT * FROM visit_analysis_requests WHERE organizationId=? AND visitId=? AND requestId=? LIMIT 1 FOR UPDATE`,
        [organizationId, visitId, normalized],
      );
      if (!row) throw new BadRequestException('Impossible de réserver la demande d’analyse');
      const inserted = row.id === candidateId;
      if (inserted && quotaUnits > 0) {
        const since = new Date(Date.now() - 60 * 60 * 1000);
        const [usage] = await manager.query(
          `SELECT COALESCE(SUM(quotaUnits),0) AS totalUser,
                  (SELECT COALESCE(SUM(quotaUnits),0) FROM visit_analysis_requests
                   WHERE organizationId=? AND createdAt>=? AND operation IN ('CREATE','REANALYZE','CLARIFY','REANALYZE_ALL')) AS totalOrganization
           FROM visit_analysis_requests
           WHERE organizationId=? AND userId=? AND createdAt>=?`,
          [organizationId, since, organizationId, userId, since],
        );
        const userLimit = Number(process.env.LLM_USER_QUOTA_PER_HOUR || 20);
        const organizationLimit = Number(process.env.LLM_ORGANIZATION_QUOTA_PER_HOUR || 200);
        if (!Number.isInteger(userLimit) || userLimit < 1 || userLimit > 10000 ||
            !Number.isInteger(organizationLimit) || organizationLimit < 1 || organizationLimit > 100000) {
          throw new BadRequestException('Configuration de quota LLM invalide');
        }
        if (Number(usage?.totalUser || 0) > userLimit || Number(usage?.totalOrganization || 0) > organizationLimit) {
          throw new HttpException('Quota horaire d’analyses IA atteint', HttpStatus.TOO_MANY_REQUESTS);
        }
      }
      if (!inserted && row.operation !== operation) {
        throw new ConflictException('requestId déjà utilisé pour une autre opération');
      }
      if (!inserted && row.inputHash !== inputHash) {
        throw new ConflictException('requestId déjà utilisé avec des données différentes');
      }
      if (row.status === 'PENDING' && !inserted) {
        if (row.result) {
          return { ...row, replay: false, reuseAiResult: true };
        }
        if (row.createdAt && Date.now() - new Date(row.createdAt).getTime() < ANALYSIS_REQUEST_STALE_MS) {
          throw new ConflictException('Une demande d’analyse identique est déjà en cours');
        }
        // A crashed HTTP process may leave a durable reservation. Reusing the
        // same requestId is safe because no visit mutation occurred yet.
        await manager.query(
          `UPDATE visit_analysis_requests SET status='PENDING',errorMessage=NULL,updatedAt=UTC_TIMESTAMP(6) WHERE id=?`,
          [row.id],
        );
      }
      if (row.status === 'COMPLETED') return { ...row, replay: true };
      if (row.status === 'FAILED') {
        await manager.query(
          `UPDATE visit_analysis_requests SET status='PENDING',errorMessage=NULL,result=NULL,updatedAt=UTC_TIMESTAMP(6) WHERE id=?`,
          [row.id],
        );
      }
      return { ...row, replay: false, reuseAiResult: false };
    });
  }

  private async storeAiResult(
    organizationId: string,
    visitId: string,
    requestId: string,
    payload: { groupId: string; result: AiAnalysisResult; imageUrls: string[]; appliedCustomPrompts: any[]; sourceHash?: string },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE visit_analysis_requests SET result=?,updatedAt=UTC_TIMESTAMP(6)
       WHERE organizationId=? AND visitId=? AND requestId=? AND status='PENDING'`,
      [JSON.stringify(payload), organizationId, visitId, this.assertRequestId(requestId)],
    );
  }

  private async storeRequestProgress(
    organizationId: string,
    visitId: string,
    requestId: string,
    result: unknown,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE visit_analysis_requests SET result=?,updatedAt=UTC_TIMESTAMP(6)
       WHERE organizationId=? AND visitId=? AND requestId=? AND status='PENDING'`,
      [JSON.stringify(result), organizationId, visitId, this.assertRequestId(requestId)],
    );
  }

  private async markRequestFailed(organizationId: string, visitId: string, requestId: string, message: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE visit_analysis_requests SET status='FAILED',errorMessage=?,updatedAt=UTC_TIMESTAMP(6)
       WHERE organizationId=? AND visitId=? AND requestId=? AND status='PENDING'`,
      [message.slice(0, 1000), organizationId, visitId, this.assertRequestId(requestId)],
    );
  }

  private async persistAnalyzedGroup(
    user: User,
    visitId: string,
    groupId: string,
    requestId: string,
    result: AiAnalysisResult,
    imageUrls: string[],
    options: { directives?: string; customPromptIds?: string[]; comment?: string; detail?: boolean; replaceAnalysis?: boolean; completeRequest?: boolean; appliedCustomPrompts?: any[]; expectedSourceHash?: string; assetKeys?: string[]; preserveGroupConfiguration?: boolean },
  ): Promise<Visit> {
    const organizationId = user.organizationId;
    if (!organizationId) throw new BadRequestException('Organisation requise');
    const analysis = this.analysisForPhoto(result);
    const appliedCustomPrompts = options.appliedCustomPrompts || [];
    let savedVisit: Visit;
    await this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(
        `SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [organizationId, visitId],
      );
      this.assertLockedVisitAccess(row, user);
      const photos = this.parsePhotos(row.photos);
      const matching = this.groupEntries(photos, groupId);
      if (!matching.length) throw new NotFoundException('Groupe d’analyse introuvable');
      if (options.expectedSourceHash && preventionGroupSourceHash(groupId, matching) !== options.expectedSourceHash) {
        throw new ConflictException('Le groupe a changé pendant l’analyse SPS; résultat abandonné');
      }
      const updated = photos.map((entry) => {
        const isGroup = matching.includes(entry);
        if (!isGroup) return entry;
        return {
          ...entry,
          ...(options.replaceAnalysis === false ? {} : { analysis }),
          ...(!options.preserveGroupConfiguration && options.directives !== undefined ? { userDirectives: options.directives } : {}),
          ...(!options.preserveGroupConfiguration && options.customPromptIds ? { customPromptIds: options.customPromptIds } : {}),
          ...(options.comment !== undefined ? { comment: options.comment } : {}),
          appliedCustomPrompts,
          requestId,
          validated: false,
        };
      });
      if (options.detail && imageUrls.length) {
        for (const imageUrl of imageUrls) {
          updated.push({
            id: randomUUID(), uri: imageUrl, s3Url: imageUrl, groupId,
            isDetailPhoto: true, isReadabilityPhoto: true,
            detailContext: (result.unreadableSections || []).join('; ').slice(0, 1000),
            analysis, userDirectives: options.directives, customPromptIds: options.customPromptIds,
            appliedCustomPrompts, requestId, validated: false,
          } as any);
        }
      }
      await manager.query(
        `UPDATE visits SET photos=?,photoCount=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`,
        [JSON.stringify(updated), updated.length, organizationId, visitId],
      );
      await this.invalidateReportPdf(manager, organizationId, visitId);
      if (options.assetKeys?.length) {
        if (this.photoAssets) await this.photoAssets.attachInTransaction(manager, organizationId, visitId, groupId, options.assetKeys);
      }
      await this.groupProcessing.stageExplicitGroupInTransaction(
        manager,
        organizationId,
        visitId,
        row.missionId,
        groupId,
        this.groupEntries(updated, groupId),
      );
      if (options.completeRequest !== false) {
        await manager.query(
          `UPDATE visit_analysis_requests SET status='COMPLETED',groupId=?,result=?,updatedAt=UTC_TIMESTAMP(6)
           WHERE organizationId=? AND visitId=? AND requestId=?`,
          [groupId, JSON.stringify({ groupId }), organizationId, visitId, this.assertRequestId(requestId)],
        );
      }
    });
    try { await this.groupProcessing.enqueueDue(); } catch { /* durable PENDING is recovered by dispatcher */ }
    savedVisit = await this.findOne(visitId, user);
    return savedVisit;
  }

  private async runGroupAi(user: User, visitId: string, groupId: string, entries: PreventionGroupEntry[], directives?: string, customPromptIds?: string[], globalDirectives?: string, globalCustomPromptIds?: string[]): Promise<{ result: AiAnalysisResult; urls: string[]; appliedCustomPrompts: any[]; sourceHash: string }> {
    groupId = this.assertGroupId(groupId);
    const urls = this.assertImageUrls(entries.filter((entry) => entry.isDirectiveOnly !== true && typeof entry.s3Url === 'string' && entry.s3Url).map((entry) => String(entry.s3Url)));
    const first = entries.find((entry) => entry.analysis) || entries[0];
    const groupPromptIds = customPromptIds ?? (Array.isArray((first as any)?.customPromptIds) ? (first as any).customPromptIds as string[] : []);
    const effectivePromptIds = [...new Set([...groupPromptIds, ...(globalCustomPromptIds || [])])];
    const { context, resolved } = await this.resolveAiContext(user, visitId, effectivePromptIds);
    const promptSnapshot = resolved.prompts.map((prompt) => ({ id: prompt.id, name: prompt.name, content: prompt.content }));
    const appliedDirectives = directives ?? (typeof first?.userDirectives === 'string' ? first.userDirectives : undefined);
    const analysisDirectives = globalDirectives?.trim()
      ? [appliedDirectives?.trim() ? `Directives du groupe :\n${appliedDirectives.trim()}` : '', `Directives globales :\n${globalDirectives.trim()}`].filter(Boolean).join('\n\n')
      : appliedDirectives;
    const previousReport = this.previousReportFor(entries);
    const sourceHash = preventionGroupSourceHash(groupId, entries);
    if (urls.length) {
      return { result: await this.aiService.analyzeBatchPhotos(urls, analysisDirectives, previousReport, context), urls, appliedCustomPrompts: promptSnapshot, sourceHash };
    }
    if (!appliedDirectives?.trim()) throw new BadRequestException('Une photo ou une directive est requise');
    const visit = await this.findOne(visitId, user);
    return {
      result: await this.aiService.analyzeDirectives(analysisDirectives || '', {
        title: visit.mission?.title, client: visit.mission?.client, address: visit.mission?.address, type: visit.mission?.type,
      }, previousReport, context),
      urls,
      appliedCustomPrompts: promptSnapshot,
      sourceHash,
    };
  }

  async createAnalysisGroup(user: User, visitId: string, dto: AnalysisGroupCreateDto): Promise<{ visit: Visit; groupId: string }> {
    await this.findMutableVisit(visitId, user);
    const imageUrls = this.assertImageUrls(dto.imageUrls || []);
    if (!imageUrls.length && !dto.userDirectives?.trim()) throw new BadRequestException('Une photo ou une directive est requise');
    let groupId = randomUUID();
    const assetKeys = await this.assertNewPhotoReceipts(user, visitId, groupId, imageUrls, dto.imageReceipts);
    const reservation = await this.reserveRequest(user.organizationId, visitId, user.id, dto.requestId, 'CREATE', groupId, { imageUrls, userDirectives: dto.userDirectives || '', comment: dto.comment || '', customPromptIds: dto.customPromptIds || [] });
    groupId = reservation.groupId || groupId;
    if (reservation.replay) return { visit: await this.findOne(visitId, user), groupId: reservation.groupId || groupId };
    let aiResultStored = false;
    try {
      let result: AiAnalysisResult;
      let appliedCustomPrompts: any[];
      if (reservation.reuseAiResult && reservation.result) {
        const saved = typeof reservation.result === 'string' ? JSON.parse(reservation.result) : reservation.result;
        result = saved.result;
        appliedCustomPrompts = saved.appliedCustomPrompts || [];
        groupId = saved.groupId || groupId;
        aiResultStored = true;
      } else {
        const analyzed = await this.runGroupAi(user, visitId, groupId, imageUrls.map((url) => ({ s3Url: url })), dto.userDirectives, dto.customPromptIds);
        result = analyzed.result;
        appliedCustomPrompts = analyzed.appliedCustomPrompts;
        await this.storeAiResult(user.organizationId, visitId, dto.requestId, { groupId, result, imageUrls, appliedCustomPrompts });
        aiResultStored = true;
      }
      const entries = imageUrls.map((url) => ({ id: randomUUID(), uri: url, s3Url: url, groupId, userDirectives: dto.userDirectives, comment: dto.comment || '', customPromptIds: dto.customPromptIds || [], appliedCustomPrompts, validated: false, analysis: this.analysisForPhoto(result) } as any));
      if (!entries.length) entries.push({ id: randomUUID(), uri: '', groupId, isDirectiveOnly: true, userDirectives: dto.userDirectives, comment: dto.comment || '', customPromptIds: dto.customPromptIds || [], validated: false, analysis: this.analysisForPhoto(result) } as any);
      let saved: Visit;
      await this.dataSource.transaction(async (manager) => {
        const [locked] = await manager.query(`SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, visitId]);
        this.assertLockedVisitAccess(locked, user);
        const photos = this.parsePhotos(locked.photos);
        const next = [...photos, ...entries.map((entry) => ({ ...entry, requestId: dto.requestId }))];
        await manager.query(`UPDATE visits SET photos=?,photoCount=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`, [JSON.stringify(next), next.length, user.organizationId, visitId]);
        await this.invalidateReportPdf(manager, user.organizationId, visitId);
        if (assetKeys.length) {
          if (this.photoAssets) await this.photoAssets.attachInTransaction(manager, user.organizationId, visitId, groupId, assetKeys);
        }
        await this.groupProcessing.stageExplicitGroupInTransaction(manager, user.organizationId, visitId, locked.missionId, groupId, entries as any);
        await manager.query(`UPDATE visit_analysis_requests SET status='COMPLETED',groupId=?,result=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND visitId=? AND requestId=?`, [groupId, JSON.stringify({ groupId }), user.organizationId, visitId, dto.requestId]);
      });
      try { await this.groupProcessing.enqueueDue(); } catch { /* durable pending */ }
      saved = await this.findOne(visitId, user);
      return { visit: saved, groupId };
    } catch (error: any) {
      if (error instanceof ConflictException && aiResultStored) {
        await this.markRequestFailed(user.organizationId, visitId, dto.requestId, String(error.message)).catch(() => undefined);
      } else if (!(error instanceof ConflictException) && !aiResultStored) {
        await this.markRequestFailed(user.organizationId, visitId, dto.requestId, String(error?.message || 'Analyse SPS échouée')).catch(() => undefined);
      }
      throw error;
    }
  }

  async reanalyzeGroup(user: User, visitId: string, groupId: string, dto: AnalysisGroupReanalyzeDto, options?: { quotaUnits?: number; globalDirectives?: string; globalCustomPromptIds?: string[]; preserveGroupConfiguration?: boolean }): Promise<{ visit: Visit; groupId: string }> {
    groupId = this.assertGroupId(groupId);
    const visit = await this.findMutableVisit(visitId, user);
    const entries = this.groupEntries(this.parsePhotos(visit.photos), groupId);
    if (!entries.length) throw new NotFoundException('Groupe d’analyse introuvable');
    this.assertReanalysisConfiguration(dto, entries.every((entry) => entry.isDirectiveOnly === true), options?.globalDirectives, options?.globalCustomPromptIds);
    await this.assertPersistedPhotoAssets(user, visitId, groupId, entries);
    let expectedSourceHash = preventionGroupSourceHash(groupId, entries);
    const reservation = await this.reserveRequest(user.organizationId, visitId, user.id, dto.requestId, 'REANALYZE', groupId, {
      groupId, userDirectives: dto.userDirectives || '', customPromptIds: dto.customPromptIds || [],
      ...(options?.globalDirectives?.trim() ? { globalDirectives: options.globalDirectives.trim() } : {}),
      ...(options?.globalCustomPromptIds?.length ? { globalCustomPromptIds: options.globalCustomPromptIds } : {}),
    }, options?.quotaUnits ?? 1);
    if (reservation.replay) return { visit: await this.findOne(visitId, user), groupId };
    let aiResultStored = false;
    try {
      let result: AiAnalysisResult;
      let urls: string[];
      let appliedCustomPrompts: any[];
      if (reservation.reuseAiResult && reservation.result) {
        const savedResult = typeof reservation.result === 'string' ? JSON.parse(reservation.result) : reservation.result;
        result = savedResult.result; urls = savedResult.imageUrls || []; appliedCustomPrompts = savedResult.appliedCustomPrompts || [];
        expectedSourceHash = savedResult.sourceHash || expectedSourceHash;
        aiResultStored = true;
      } else {
        const analyzed = await this.runGroupAi(user, visitId, groupId, entries, dto.userDirectives, dto.customPromptIds, options?.globalDirectives, options?.globalCustomPromptIds);
        result = analyzed.result; urls = analyzed.urls; appliedCustomPrompts = analyzed.appliedCustomPrompts;
        await this.storeAiResult(user.organizationId, visitId, dto.requestId, { groupId, result, imageUrls: urls, appliedCustomPrompts, sourceHash: expectedSourceHash });
        aiResultStored = true;
      }
      const saved = await this.persistAnalyzedGroup(user, visitId, groupId, dto.requestId, result, urls, {
        directives: dto.userDirectives, customPromptIds: dto.customPromptIds, appliedCustomPrompts, expectedSourceHash,
        preserveGroupConfiguration: options?.preserveGroupConfiguration,
      });
      return { visit: saved, groupId };
    } catch (error: any) {
      if (error instanceof ConflictException && aiResultStored) {
        await this.markRequestFailed(user.organizationId, visitId, dto.requestId, String(error.message)).catch(() => undefined);
      } else if (!(error instanceof ConflictException) && !aiResultStored) {
        await this.markRequestFailed(user.organizationId, visitId, dto.requestId, String(error?.message || 'Analyse SPS échouée')).catch(() => undefined);
      }
      throw error;
    }
  }

  async clarifyGroup(user: User, visitId: string, groupId: string, dto: AnalysisGroupClarifyDto): Promise<{ visit: Visit; groupId: string }> {
    groupId = this.assertGroupId(groupId);
    const visit = await this.findMutableVisit(visitId, user);
    const entries = this.groupEntries(this.parsePhotos(visit.photos), groupId);
    if (!entries.length || !dto.detailImageUrls?.length) throw new BadRequestException('Groupe ou photos de clarification manquants');
    await this.assertPersistedPhotoAssets(user, visitId, groupId, entries);
    const detailImageUrls = this.assertImageUrls(dto.detailImageUrls);
    const detailAssetKeys = await this.assertNewPhotoReceipts(user, visitId, groupId, detailImageUrls, dto.detailImageReceipts);
    if (entries.filter((entry) => entry.isDirectiveOnly !== true).length + detailImageUrls.length > MAX_ANALYSIS_GROUP_PHOTOS) {
      throw new BadRequestException(`Un groupe ne peut pas dépasser ${MAX_ANALYSIS_GROUP_PHOTOS} photos`);
    }
    let expectedSourceHash = preventionGroupSourceHash(groupId, entries);
    const reservation = await this.reserveRequest(user.organizationId, visitId, user.id, dto.requestId, 'CLARIFY', groupId, { groupId, detailImageUrls, userDirectives: dto.userDirectives || '', customPromptIds: dto.customPromptIds || [] });
    if (reservation.replay) return { visit: await this.findOne(visitId, user), groupId };
    let aiResultStored = false;
    try {
      let result: AiAnalysisResult;
      let appliedCustomPrompts: any[];
      if (reservation.reuseAiResult && reservation.result) {
        const savedResult = typeof reservation.result === 'string' ? JSON.parse(reservation.result) : reservation.result;
        result = savedResult.result; appliedCustomPrompts = savedResult.appliedCustomPrompts || [];
        expectedSourceHash = savedResult.sourceHash || expectedSourceHash;
        aiResultStored = true;
      } else {
        const urls = this.assertImageUrls(entries.filter((entry) => entry.isDirectiveOnly !== true && typeof entry.s3Url === 'string').map((entry) => String(entry.s3Url)));
        const allUrls = [...urls, ...detailImageUrls];
        const firstAnalysis = entries.find((entry) => entry.analysis)?.analysis;
        const unreadable = Array.isArray(firstAnalysis?.unreadableSections) ? firstAnalysis.unreadableSections as string[] : [];
        const firstEntry = entries.find((entry) => entry.analysis) || entries[0];
        const effectiveDirectives = dto.userDirectives ?? (typeof firstEntry.userDirectives === 'string' ? firstEntry.userDirectives : undefined);
        const effectivePromptIds = dto.customPromptIds ?? (Array.isArray((firstEntry as any).customPromptIds) ? (firstEntry as any).customPromptIds as string[] : []);
        const { context, resolved } = await this.resolveAiContext(user, visitId, effectivePromptIds);
        appliedCustomPrompts = resolved.prompts.map((prompt) => ({ id: prompt.id, name: prompt.name, content: prompt.content }));
        result = await this.aiService.analyzeBatchEnhanced(allUrls, firstAnalysis, unreadable, effectiveDirectives, context);
        await this.storeAiResult(user.organizationId, visitId, dto.requestId, { groupId, result, imageUrls: detailImageUrls, appliedCustomPrompts, sourceHash: expectedSourceHash });
        aiResultStored = true;
      }
      const saved = await this.persistAnalyzedGroup(user, visitId, groupId, dto.requestId, result, detailImageUrls, {
        directives: dto.userDirectives ?? (typeof entries[0].userDirectives === 'string' ? entries[0].userDirectives : undefined),
        customPromptIds: dto.customPromptIds ?? (Array.isArray((entries[0] as any).customPromptIds) ? (entries[0] as any).customPromptIds : undefined),
        detail: true, appliedCustomPrompts, expectedSourceHash,
        assetKeys: detailAssetKeys,
      });
      return { visit: saved, groupId };
    } catch (error: any) {
      if (error instanceof ConflictException && aiResultStored) {
        await this.markRequestFailed(user.organizationId, visitId, dto.requestId, String(error.message)).catch(() => undefined);
      } else if (!(error instanceof ConflictException) && !aiResultStored) {
        await this.markRequestFailed(user.organizationId, visitId, dto.requestId, String(error?.message || 'Clarification SPS échouée')).catch(() => undefined);
      }
      throw error;
    }
  }

  async reanalyzeAll(user: User, visitId: string, dto: AnalysisGroupReanalyzeAllDto): Promise<{ visit: Visit; succeeded: string[]; failed: Array<{ groupId: string; reason: string }> }> {
    const visit = await this.findMutableVisit(visitId, user);
    this.assertReanalysisConfiguration(dto);
    const photos = this.parsePhotos(visit.photos);
    const groupIds = [...new Set(photos.map((entry, index) => {
      return typeof entry.groupId === 'string' && entry.groupId ? entry.groupId : (typeof entry.id === 'string' ? entry.id : `entry-${index}`);
    }))];
    for (const groupId of groupIds) {
      const entries = this.groupEntries(photos, groupId);
      if (entries.some((entry) => entry.analysis)) await this.assertPersistedPhotoAssets(user, visitId, groupId, entries);
    }
    const eligibleCount = groupIds.filter((groupId) => {
      const entries = this.groupEntries(photos, groupId);
      return entries.some((entry) => entry.analysis);
    }).length;
    const reservation = await this.reserveRequest(user.organizationId, visitId, user.id, dto.requestId, 'REANALYZE_ALL', undefined, { userDirectives: dto.userDirectives || '', customPromptIds: dto.customPromptIds || [] }, eligibleCount);
    if (reservation.replay) {
      const replay = typeof reservation.result === 'string' ? JSON.parse(reservation.result) : (reservation.result || {});
      return { visit: await this.findOne(visitId, user), succeeded: replay.succeeded || [], failed: replay.failed || [] };
    }
    const progress = reservation.reuseAiResult && reservation.result
      ? (typeof reservation.result === 'string' ? JSON.parse(reservation.result) : reservation.result)
      : {};
    const succeeded: string[] = Array.isArray(progress.succeeded) ? progress.succeeded : [];
    const failed: Array<{ groupId: string; reason: string }> = Array.isArray(progress.failed) ? progress.failed : [];
    const processed = new Set([...succeeded, ...failed.map((item) => item.groupId)]);
    for (const groupId of groupIds) {
      const entries = this.groupEntries(photos, groupId);
      if (!entries.some((entry) => entry.analysis) || processed.has(groupId)) continue;
      const childRequestId = `global:${createHash('sha256').update(`${dto.requestId}|${groupId}`).digest('hex')}`;
      try {
        const existingDirectives = [...new Set(entries
          .map((entry) => typeof entry.userDirectives === 'string' ? entry.userDirectives.trim() : '')
          .filter(Boolean))].join('\n\n');
        const groupCustomPromptIds = [...new Set(entries.flatMap((entry) =>
          Array.isArray((entry as any).customPromptIds) ? (entry as any).customPromptIds as string[] : []))];
        await this.reanalyzeGroup(user, visitId, groupId, {
          requestId: childRequestId,
          userDirectives: existingDirectives,
          customPromptIds: groupCustomPromptIds,
        }, { quotaUnits: 0, globalDirectives: dto.userDirectives?.trim(), globalCustomPromptIds: dto.customPromptIds, preserveGroupConfiguration: true });
        succeeded.push(groupId);
      } catch (error: any) {
        failed.push({
          groupId,
          reason: String(error?.message || 'Analyse SPS échouée').replace(/[\r\n]+/g, ' ').slice(0, 300),
        });
      }
      await this.storeRequestProgress(user.organizationId, visitId, dto.requestId, { succeeded, failed });
    }
    const result = { succeeded, failed };
    await this.dataSource.transaction(async (manager) => {
      const [locked] = await manager.query(`SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, visitId]);
      this.assertLockedVisitAccess(locked, user);
      await manager.query(`UPDATE visits SET notes=?,customPromptIds=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`, [dto.userDirectives ?? null, JSON.stringify(dto.customPromptIds || []), user.organizationId, visitId]);
      await this.invalidateReportPdf(manager, user.organizationId, visitId);
      await manager.query(
        `UPDATE visit_analysis_requests SET status='COMPLETED',result=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND visitId=? AND requestId=?`,
        [JSON.stringify(result), user.organizationId, visitId, dto.requestId],
      );
    });
    return { visit: await this.findOne(visitId, user), ...result };
  }

  async attachPhotos(user: User, visitId: string, groupId: string, dto: AnalysisGroupAttachDto): Promise<{ visit: Visit; groupId: string }> {
    groupId = this.assertGroupId(groupId);
    const visit = await this.findMutableVisit(visitId, user);
    const existing = this.groupEntries(this.parsePhotos(visit.photos), groupId);
    if (!existing.length) throw new NotFoundException('Groupe d’analyse introuvable');
    const imageUrls = this.assertImageUrls(dto.imageUrls);
    if (!imageUrls.length) throw new BadRequestException('Au moins une photo est requise');
    const assetKeys = await this.assertNewPhotoReceipts(user, visitId, groupId, imageUrls, dto.imageReceipts);
    await this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(`SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, visitId]);
      this.assertLockedVisitAccess(row, user);
      const photos = this.parsePhotos(row?.photos);
      const lockedGroup = this.groupEntries(photos, groupId);
      if (!lockedGroup.length) throw new NotFoundException('Groupe d’analyse introuvable');
      if (lockedGroup.filter((entry) => entry.isDirectiveOnly !== true).length + imageUrls.length > MAX_ANALYSIS_GROUP_PHOTOS) {
        throw new BadRequestException(`Un groupe ne peut pas dépasser ${MAX_ANALYSIS_GROUP_PHOTOS} photos`);
      }
      const additions = imageUrls.map((url) => ({ id: randomUUID(), uri: url, s3Url: url, groupId, validated: false, ...(dto.isDetailPhoto ? { isDetailPhoto: true } : {}), ...(dto.isReadabilityPhoto ? { isReadabilityPhoto: true } : {}), ...(dto.detailContext ? { detailContext: dto.detailContext } : {}) }));
      const next = [...photos, ...additions];
      await manager.query(`UPDATE visits SET photos=?,photoCount=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`, [JSON.stringify(next), next.length, user.organizationId, visitId]);
      await this.invalidateReportPdf(manager, user.organizationId, visitId);
      if (this.photoAssets) await this.photoAssets.attachInTransaction(manager, user.organizationId, visitId, groupId, assetKeys);
    });
    return { visit: await this.findOne(visitId, user), groupId };
  }

  async patchGroup(user: User, visitId: string, groupId: string, dto: AnalysisGroupPatchDto): Promise<{ visit: Visit; groupId: string }> {
    groupId = this.assertGroupId(groupId);
    await this.findMutableVisit(visitId, user);
    await this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(`SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, visitId]);
      this.assertLockedVisitAccess(row, user);
      const photos = this.parsePhotos(row?.photos);
      const entries = this.groupEntries(photos, groupId);
      if (!entries.length) throw new NotFoundException('Groupe d’analyse introuvable');
      const next = photos.map((entry) => {
        if (!entries.includes(entry)) return entry;
        const analysis = entry.analysis ? { ...entry.analysis } : {};
        if (dto.observations !== undefined) analysis.observation = dto.observations;
        if (dto.recommendations !== undefined) analysis.recommendation = dto.recommendations;
        if (dto.references !== undefined) analysis.references = dto.references;
        return { ...entry, analysis, ...(dto.comment !== undefined ? { comment: dto.comment } : {}), ...(dto.userDirectives !== undefined ? { userDirectives: dto.userDirectives } : {}), validated: false };
      });
      await manager.query(`UPDATE visits SET photos=?,photoCount=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`, [JSON.stringify(next), next.length, user.organizationId, visitId]);
      await this.invalidateReportPdf(manager, user.organizationId, visitId);
    });
    return { visit: await this.findOne(visitId, user), groupId };
  }

  async patchGroups(user: User, visitId: string, dto: AnalysisGroupBulkEditDto): Promise<{ visit: Visit; groupIds: string[] }> {
    await this.findMutableVisit(visitId, user);
    const groupIds = dto.groups.map((item) => item.groupId);
    if (new Set(groupIds).size !== groupIds.length) throw new BadRequestException('Un groupe ne peut être édité qu’une fois');
    await this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(`SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, visitId]);
      this.assertLockedVisitAccess(row, user);
      const photos = this.parsePhotos(row.photos);
      const groups = new Map(groupIds.map((groupId) => [groupId, this.groupEntries(photos, groupId)]));
      if ([...groups.values()].some((entries) => entries.length === 0)) throw new NotFoundException('Un groupe d’analyse est introuvable');
      const next = photos.map((entry) => {
        const groupId = groupIds.find((candidate) => groups.get(candidate)?.includes(entry));
        if (!groupId) return entry;
        const edit = dto.groups.find((item) => item.groupId === groupId)!;
        const analysis = entry.analysis ? { ...entry.analysis } : {};
        if (edit.observations !== undefined) analysis.observation = edit.observations;
        if (edit.recommendations !== undefined) analysis.recommendation = edit.recommendations;
        if (edit.references !== undefined) analysis.references = edit.references;
        return { ...entry, analysis, ...(edit.comment !== undefined ? { comment: edit.comment } : {}), validated: false };
      });
      await manager.query(`UPDATE visits SET photos=?,photoCount=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`, [JSON.stringify(next), next.length, user.organizationId, visitId]);
      await this.invalidateReportPdf(manager, user.organizationId, visitId);
    });
    return { visit: await this.findOne(visitId, user), groupIds };
  }

  async deleteGroup(user: User, visitId: string, groupId: string): Promise<{ visit: Visit; groupId: string }> {
    groupId = this.assertGroupId(groupId);
    await this.findMutableVisit(visitId, user);
    await this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(`SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, visitId]);
      this.assertLockedVisitAccess(row, user);
      const photos = this.parsePhotos(row?.photos);
      const removed = photos.filter((entry, index) => {
        const current = typeof entry.groupId === 'string' && entry.groupId ? entry.groupId : (typeof entry.id === 'string' ? entry.id : `entry-${index}`);
        return current === groupId;
      });
      if (removed.some((entry) => typeof entry.s3Url === 'string' && entry.s3Url)) {
        if (this.photoAssets) for (const entry of removed) {
          if (typeof entry.s3Url !== 'string' || !entry.s3Url) continue;
          const key = visitPhotoKeyFromUrl(entry.s3Url, process.env.AWS_S3_BUCKET, process.env.AWS_REGION);
          await this.photoAssets.assertAttachedAsset(manager, user.organizationId, visitId, groupId, key);
        }
      }
      const next = photos.filter((entry, index) => {
        const current = typeof entry.groupId === 'string' && entry.groupId ? entry.groupId : (typeof entry.id === 'string' ? entry.id : `entry-${index}`);
        return current !== groupId;
      });
      if (next.length === photos.length) throw new NotFoundException('Groupe d’analyse introuvable');
      await manager.query(`UPDATE visits SET photos=?,photoCount=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`, [JSON.stringify(next), next.length, user.organizationId, visitId]);
      await this.invalidateReportPdf(manager, user.organizationId, visitId);
      if (this.photoAssets) {
        for (const entry of removed) {
          if (typeof entry.s3Url !== 'string' || !entry.s3Url) continue;
          const key = visitPhotoKeyFromUrl(entry.s3Url, process.env.AWS_S3_BUCKET, process.env.AWS_REGION);
          await this.photoAssets.detachInTransaction(manager, user.organizationId, visitId, groupId, key);
        }
      }
    });
    return { visit: await this.findOne(visitId, user), groupId };
  }

  async deleteGroupPhoto(user: User, visitId: string, groupId: string, photoId: string): Promise<{ visit: Visit; groupId: string }> {
    groupId = this.assertGroupId(groupId);
    if (!photoId || photoId.length > 100) throw new BadRequestException('Identifiant de photo invalide');
    await this.findMutableVisit(visitId, user);
    let deletedUrl: string | undefined;
    let deletedKey: string | undefined;
    await this.dataSource.transaction(async (manager) => {
      const [row] = await manager.query(`SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, visitId]);
      this.assertLockedVisitAccess(row, user);
      const photos = this.parsePhotos(row?.photos);
      const target = photos.find((entry) => entry.id === photoId && entry.groupId === groupId);
      if (!target) throw new NotFoundException('Photo du groupe introuvable');
      deletedUrl = typeof target.s3Url === 'string' ? target.s3Url : undefined;
      if (deletedUrl) {
        if (this.photoAssets) {
          deletedKey = visitPhotoKeyFromUrl(deletedUrl, process.env.AWS_S3_BUCKET, process.env.AWS_REGION);
          await this.photoAssets.assertAttachedAsset(manager, user.organizationId, visitId, groupId, deletedKey);
          await this.photoAssets.detachInTransaction(manager, user.organizationId, visitId, groupId, deletedKey);
        }
      }
      let next = photos.filter((entry) => entry !== target);
      const remainingGroup = this.groupEntries(next, groupId);
      if (target.analysis && remainingGroup.length && !remainingGroup.some((entry) => entry.analysis)) {
        const successor = remainingGroup[0];
        next = next.map((entry) => entry === successor ? {
          ...entry,
          analysis: target.analysis,
          ...(target.userDirectives !== undefined ? { userDirectives: target.userDirectives } : {}),
          ...((target as any).comment !== undefined ? { comment: (target as any).comment } : {}),
          ...((target as any).customPromptIds !== undefined ? { customPromptIds: (target as any).customPromptIds } : {}),
          ...((target as any).appliedCustomPrompts !== undefined ? { appliedCustomPrompts: (target as any).appliedCustomPrompts } : {}),
          ...((target as any).requestId !== undefined ? { requestId: (target as any).requestId } : {}),
        } : entry);
      }
      await manager.query(`UPDATE visits SET photos=?,photoCount=?,updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND id=?`, [JSON.stringify(next), next.length, user.organizationId, visitId]);
      await this.invalidateReportPdf(manager, user.organizationId, visitId);
    });
    let mayDeleteObject = false;
    if (deletedKey && this.photoAssets && typeof this.photoAssets.canPhysicallyDelete === 'function') {
      mayDeleteObject = await this.photoAssets.canPhysicallyDelete(user.organizationId, visitId, deletedKey);
    }
    if (deletedUrl && deletedKey && mayDeleteObject && this.uploadService) {
      try {
        await this.uploadService.deleteDetachedVisitPhoto(this.assertImageUrls([deletedUrl])[0], user.organizationId, visitId, groupId);
      } catch { /* verified S3 cleanup is best effort */ }
    }
    return { visit: await this.findOne(visitId, user), groupId };
  }

  async delete(id: string, user: User): Promise<void> {
    const visit = await this.findMutableVisit(id, user);
    let deletedReportId: string | undefined;
    await this.dataSource.transaction(async (manager) => {
      const [lockedVisit] = await manager.query(
        `SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
        [user.organizationId, visit.id],
      );
      this.assertLockedVisitAccess(lockedVisit, user);
      const [report] = await manager.query(
        `SELECT id,organizationId,status FROM reports WHERE visitId=? LIMIT 1 FOR UPDATE`,
        [visit.id],
      );
      if (report) {
        if (report.organizationId !== user.organizationId) {
          throw new ConflictException('Le rapport lié à cette visite appartient à une autre organisation');
        }
        if (isReportLocked(report.status)) {
          throw new ConflictException('Cette visite est verrouillée par un rapport envoyé au client ou archivé');
        }
        await this.reportService.markReportDeletionPartitions(manager, user.organizationId, report.id);
        await manager.query(`DELETE FROM reports WHERE organizationId=? AND id=?`, [user.organizationId, report.id]);
        deletedReportId = report.id;
      }
      await manager.query(`DELETE FROM visits WHERE organizationId=? AND id=?`, [user.organizationId, visit.id]);
    });
    if (deletedReportId) this.reportService.notifyReportDeletedAfterCommit(user.organizationId, deletedReportId);
  }

  /**
   * Generate a report from a visit's grouped photos.
   * Groups photos by groupId, builds report content from AI analyses,
   * and creates a Report entity linked to this visit and mission.
   */
  private buildGeneratedReportDto(
    visit: Visit,
    options?: { header?: string; footer?: string; notes?: string },
  ): CreateReportDto {
    const mission = visit.mission;

    if (!visit.photos || visit.photos.length === 0) {
      throw new NotFoundException('No photos found in this visit to generate a report');
    }

    // Group photos by groupId
    const groups: { [key: string]: typeof visit.photos } = {};
    visit.photos.forEach(photo => {
      const gid = (photo as any).groupId || photo.id;
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(photo);
    });

    // Build report content from grouped photos
    let groupIndex = 0;
    const photoEntries = visit.photos.filter(p => !(p as any).isDirectiveOnly);
    const directiveEntries = visit.photos.filter(p => (p as any).isDirectiveOnly);
    const highRisks = visit.photos.filter(p => p.analysis?.riskLevel === 'eleve').length;
    const mediumRisks = visit.photos.filter(p => p.analysis?.riskLevel === 'moyen').length;

    const reportContent = Object.entries(groups).map(([groupId, groupPhotos]) => {
      groupIndex++;
      const firstPhoto = groupPhotos[0];
      const isDirectiveOnly = (firstPhoto as any).isDirectiveOnly || false;

      // Separate original photos from readability/detail photos
      const originalPhotos = groupPhotos.filter(p => !(p as any).isDetailPhoto && !(p as any).isReadabilityPhoto);
      const readabilityPhotos = groupPhotos.filter(p => (p as any).isDetailPhoto || (p as any).isReadabilityPhoto);
      const allPhotosInGroup = groupPhotos;

      if (isDirectiveOnly) {
        const observations = firstPhoto.analysis?.observation;
        const recommendations = firstPhoto.analysis?.recommendation;
        const references = firstPhoto.analysis?.references;
        const riskLevel = firstPhoto.analysis?.riskLevel?.toUpperCase() || 'N/A';

        const obsList = Array.isArray(observations) ? observations : (observations ? [observations] : []);
        const recList = Array.isArray(recommendations) ? recommendations : (recommendations ? [recommendations] : []);
        const refList = Array.isArray(references) ? references : (references ? [references] : []);

        return `━━━━━━━━━━━━━━━━━━━━━
Rapport ${groupIndex} - Sans photo - Niveau de risque: ${riskLevel}

Observations:
${obsList.length > 0 ? obsList.map(obs => `• ${obs}`).join('\n') : '• Aucune observation'}

Recommandations:
${recList.map(rec => `• ${rec}`).join('\n')}

🏛️ Références:
${refList.map(ref => `• ${ref}`).join('\n')}


💬 Commentaires:
${firstPhoto.comment || ''}
`;
      }

      const riskLevel = firstPhoto.analysis?.riskLevel?.toUpperCase() || 'N/A';
      const observations = firstPhoto.analysis?.observation;
      const recommendations = firstPhoto.analysis?.recommendation;
      const references = firstPhoto.analysis?.references;

      const obsList = Array.isArray(observations) ? observations : (observations ? [observations] : []);
      const recList = Array.isArray(recommendations) ? recommendations : (recommendations ? [recommendations] : []);
      const refList = Array.isArray(references) ? references : (references ? [references] : []);

      // Include all photos (original + readability) in the report
      const photoLines = originalPhotos.map(p => `📸 Photo: ${p.uri}`);
      if (readabilityPhotos.length > 0) {
        photoLines.push(...readabilityPhotos.map(p => `📸 Photo complémentaire (lisibilité): ${p.uri}`));
      }

      return `━━━━━━━━━━━━━━━━━━━━━
Rapport ${groupIndex} - ${allPhotosInGroup.length} photo(s) - Niveau de risque: ${riskLevel}
${photoLines.join('\n')}

Observations:
${obsList.map(obs => `• ${obs}`).join('\n')}

Recommandations:
${recList.map(rec => `• ${rec}`).join('\n')}

🏛️ Références:
${refList.map(ref => `• ${ref}`).join('\n')}


💬 Commentaires:
${firstPhoto.comment || ''}
`;
    }).join('\n');

    const header = options?.header || `RAPPORT DE VISITE SPS
${mission?.title || 'Chantier sans nom'}

CLIENT: ${mission?.client || 'N/A'}
LIEU: ${mission?.address || 'N/A'}

RÉSUMÉ DE LA VISITE:
${photoEntries.length} photos prises et analysées
${directiveEntries.length} rapport(s) directive(s)
${highRisks} risques élevés identifiés
${mediumRisks} risques moyens identifiés`;

    const footer = options?.footer || `CONCLUSION:
${highRisks > 0
        ? 'Des actions correctives immédiates sont nécessaires pour les risques élevés identifiés.'
        : mediumRisks > 0
          ? 'Quelques améliorations sont recommandées pour optimiser la sécurité.'
          : 'Le chantier présente un bon niveau de conformité sécurité.'
      }`;

    const createReportDto: CreateReportDto = {
      missionId: visit.missionId,
      visitId: visit.id,
      title: `Rapport de visite - ${mission?.title || "Sans titre"} - ${new Date().toLocaleDateString("fr-FR")}`,
      content: reportContent,
      header,
      footer,
      status: ReportStatus.DRAFT,
      conformityPercentage: highRisks > 0 ? 50 : mediumRisks > 0 ? 75 : 95,
    };

    return createReportDto;
  }

  async generateReportFromVisit(
    visitId: string,
    user: User,
    options?: { header?: string; footer?: string; notes?: string },
  ) {
    await this.findMutableVisit(visitId, user);
    return this.dataSource.transaction(async (manager) => {
      const [lockedVisit] = await manager.query(
        `SELECT * FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
        [user.organizationId, visitId],
      );
      this.assertLockedVisitAccess(lockedVisit, user);
      const [linkedReport] = await manager.query(
        `SELECT status FROM reports WHERE visitId=? LIMIT 1 FOR UPDATE`, [visitId],
      );
      if (isReportLocked(linkedReport?.status)) {
        throw new ConflictException('Cette visite est verrouillée par un rapport envoyé au client ou archivé');
      }
      const [mission] = await manager.query(
        `SELECT title,client,address FROM missions WHERE organizationId=? AND id=? LIMIT 1`,
        [user.organizationId, lockedVisit.missionId],
      );
      if (!mission) throw new ConflictException('Chantier de la visite introuvable');
      const createReportDto = this.buildGeneratedReportDto({
        ...lockedVisit, photos: this.parsePhotos(lockedVisit.photos), mission,
      } as Visit, options);
      const report = await this.reportService.upsertGeneratedReportInTransaction(manager, user, createReportDto);
      await manager.query(
        `UPDATE visits SET reportGenerated=1 WHERE organizationId=? AND id=?`,
        [user.organizationId, visitId],
      );
      return report;
    });
  }
}
