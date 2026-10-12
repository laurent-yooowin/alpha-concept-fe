import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { orgScope } from '../common/utils/org-scope';
import { Report, ReportStatus, isReportLocked } from './report.entity';
import { CreateReportDto, UpdateReportDto } from './report.dto';
import { User, UserRole } from '../user/user.entity';
import { MissionService } from '../missions/mission.service';
import { UpdateMissionDto } from '../missions/mission.dto';
import { MailService } from '../mail/mail.service';
import { Readable } from 'stream';
import { ReportPdfTemplateService } from './report-pdf-template.service';
import { PreventionOutboxService } from '../prevention/outbox/prevention-outbox.service';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';
import { createHash } from 'crypto';
import { PreventionActivationService } from '../prevention/prevention-activation.service';
import { UploadedAssetService } from '../upload/uploaded-asset.service';
import { effectivePermission } from '../common/guards/permissions.guard';
import { levelMeets } from '../common/permissions/permissions.types';

export function resolveReportOrganizationId(
  report: Pick<Report, 'organizationId'> & { visit?: Pick<Visit, 'organizationId'> | null },
): string | null {
  return report.visit?.organizationId ?? report.organizationId;
}

export function reportAnalyticalFingerprint(report: Partial<Report>): string {
  const analyticalSource = {
    missionId: report.missionId ?? null,
    visitId: report.visitId ?? null,
    title: report.title ?? null,
    content: report.content ?? null,
    status: report.status ?? null,
    conformityPercentage: report.conformityPercentage ?? null,
    observations: report.observations ?? null,
    remarquesAdmin: report.remarquesAdmin ?? null,
  };
  return createHash('sha256').update(JSON.stringify(analyticalSource)).digest('hex');
}

function pdfSourceFingerprint(report: Partial<Report>): string {
  return createHash('sha256').update(JSON.stringify({
    title: report.title ?? null,
    content: report.content ?? null,
    header: report.header ?? null,
    footer: report.footer ?? null,
    conformityPercentage: report.conformityPercentage ?? null,
    status: report.status ?? null,
    reportFileUrl: report.reportFileUrl ?? null,
  })).digest('hex');
}

function visitPdfFingerprint(visit: Partial<Visit>): string {
  let photos: unknown = visit.photos ?? null;
  if (typeof photos === 'string') {
    try { photos = JSON.parse(photos); } catch { /* compare the original value */ }
  }
  return createHash('sha256').update(JSON.stringify({
    visitDate: visit.visitDate ? new Date(visit.visitDate).toISOString() : null,
    photos,
  })).digest('hex');
}

function missionPdfFingerprint(mission: Partial<Mission>): string {
  return createHash('sha256').update(JSON.stringify({
    title: mission.title ?? null,
    client: mission.client ?? null,
    address: mission.address ?? null,
    type: mission.type ?? null,
  })).digest('hex');
}

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  private assertMutableReport(status: ReportStatus | string | null | undefined): void {
    if (isReportLocked(status)) {
      throw new ConflictException('Ce rapport est verrouillé car il a été envoyé au client ou archivé');
    }
  }

  private async lockMutableReport(manager: EntityManager, report: Report): Promise<void> {
    const organizationId = resolveReportOrganizationId(report);
    if (!organizationId || !report.visitId) throw new NotFoundException('Rapport ou visite introuvable');
    const [visit] = await manager.query(
      `SELECT id FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
      [organizationId, report.visitId],
    );
    if (!visit) throw new NotFoundException('Visite du rapport introuvable');
    const [locked] = await manager.query(
      `SELECT status FROM reports WHERE id=? AND visitId=? LIMIT 1 FOR UPDATE`,
      [report.id, report.visitId],
    );
    if (!locked) throw new NotFoundException('Rapport introuvable');
    this.assertMutableReport(locked.status);
  }

  private async lockCurrentPdfSource(manager: EntityManager, report: Report): Promise<void> {
    const organizationId = resolveReportOrganizationId(report);
    if (!organizationId || !report.visitId) throw new NotFoundException('Rapport ou visite introuvable');
    if (report.mission) {
      const [mission] = await manager.query(
        `SELECT title,client,address,type FROM missions WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
        [organizationId, report.missionId],
      );
      if (!mission || missionPdfFingerprint(mission) !== missionPdfFingerprint(report.mission)) {
        throw new ConflictException('Le chantier a changé pendant la préparation du PDF ; veuillez réessayer');
      }
    }
    const [visit] = await manager.query(
      `SELECT id,visitDate,photos FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
      [organizationId, report.visitId],
    );
    if (!visit) throw new NotFoundException('Visite du rapport introuvable');
    if (report.visit && visitPdfFingerprint(visit) !== visitPdfFingerprint(report.visit)) {
      throw new ConflictException('La visite a changé pendant la préparation du PDF ; veuillez réessayer');
    }
    const [current] = await manager.query(
      `SELECT title,content,header,footer,conformityPercentage,status,reportFileUrl
       FROM reports WHERE id=? AND visitId=? LIMIT 1 FOR UPDATE`,
      [report.id, report.visitId],
    );
    if (!current) throw new NotFoundException('Rapport introuvable');
    if (pdfSourceFingerprint(current) !== pdfSourceFingerprint(report)) {
      throw new ConflictException('Le rapport a changé pendant la préparation du PDF ; veuillez réessayer');
    }
  }

  constructor(
    @InjectRepository(Report)
    private reportRepository: Repository<Report>,

    @Inject(forwardRef(() => MissionService))
    private readonly missionService: MissionService,
    private readonly mailService: MailService,
    private readonly reportPdfTemplateService: ReportPdfTemplateService,
    private readonly dataSource: DataSource,
    private readonly preventionOutboxService: PreventionOutboxService,
    private readonly uploadedAssets: UploadedAssetService,
    @Optional() private readonly preventionActivation?: PreventionActivationService,
  ) { }

  private async enqueueReportUpsert(
    manager: EntityManager,
    report: Report,
  ): Promise<void> {
    if (!report.organizationId) {
      this.logger.warn(`Prevention event skipped for unscoped report id=${report.id}`);
      return;
    }
    if (this.preventionActivation && !(await this.preventionActivation.isEnabled(report.organizationId, manager))) {
      return;
    }
    const persisted = await manager.getRepository(Report).findOneByOrFail({ id: report.id });
    const [versionRow]: Array<{ aggregateVersion: string }> = await manager.query(
      `SELECT DATE_FORMAT(updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS aggregateVersion
       FROM reports WHERE id = ? AND organizationId = ?`,
      [persisted.id, persisted.organizationId],
    );
    if (!versionRow?.aggregateVersion) {
      throw new Error('Persisted report version could not be resolved');
    }
    await this.preventionOutboxService.enqueueReportEvent(manager, {
      organizationId: persisted.organizationId,
      reportId: persisted.id,
      eventType: 'REPORT_UPSERTED',
      aggregateVersion: versionRow.aggregateVersion,
      occurredAt: new Date(persisted.updatedAt),
    });
  }

  private async enqueueReportUpsertIfChanged(
    manager: EntityManager,
    report: Report,
    previousFingerprint?: string,
  ): Promise<void> {
    if (
      previousFingerprint !== undefined &&
      previousFingerprint === reportAnalyticalFingerprint(report)
    ) {
      return;
    }
    await this.enqueueReportUpsert(manager, report);
  }

  private notifyPreventionAfterCommit(report: Report, previousFingerprint?: string): void {
    // The SPS write is already committed. A Prevention outage must never roll
    // it back; the differential audit recovers a missing upsert event.
    void this.enqueueReportUpsertIfChanged(this.dataSource.manager, report, previousFingerprint)
      .catch((error) => this.logger.warn({ message: 'Prevention report event deferred',
        reportId: report.id, errorCode: String(error?.code ?? 'UNKNOWN').slice(0, 64) } as any));
  }

  async notifyVisitReportChangedInTransaction(
    manager: EntityManager,
    organizationId: string,
    reportId: string,
  ): Promise<void> {
    try {
      await this.enqueueReportUpsert(manager, { id: reportId, organizationId } as Report);
    } catch (error: any) {
      // The differential audit also observes the visit/report timestamps. An
      // unavailable Prevention outbox must not roll back the SPS edit.
      this.logger.warn({ message: 'Prevention report event deferred', reportId,
        errorCode: String(error?.code ?? 'UNKNOWN').slice(0, 64) } as any);
    }
  }

  private async assertReportRelationsInOrganization(
    manager: EntityManager,
    organizationId: string,
    missionId: string,
    visitId?: string,
  ): Promise<void> {
    if (!visitId) {
      throw new NotFoundException('Visit not found');
    }
    const [mission, visit] = await Promise.all([
      manager.getRepository(Mission).findOneBy({ id: missionId, organizationId }),
      manager.getRepository(Visit).findOneBy({ id: visitId, organizationId, missionId }),
    ]);
    if (!mission || !visit) {
      // Keep the same response for missing and cross-tenant references.
      throw new NotFoundException('Mission or visit not found');
    }
  }

  async create(userOrId: User | string, createReportDto: CreateReportDto): Promise<Report> {
    const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;
    const organizationId =
      typeof userOrId === 'string' ? null : userOrId.organizationId ?? null;

    const report = this.reportRepository.create({
      ...createReportDto,
      userId,
      organizationId,
    });

    const persisted = await this.dataSource.transaction(async (manager) => {
      if (typeof userOrId !== 'string') {
        if (!organizationId) throw new ForbiddenException('Organization scope is required');
        await this.assertReportRelationsInOrganization(
          manager,
          organizationId,
          createReportDto.missionId,
          createReportDto.visitId,
        );
        const [lockedVisit] = await manager.query(
          `SELECT id FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
          [organizationId, createReportDto.visitId],
        );
        if (!lockedVisit) throw new NotFoundException('Visite introuvable');
        const [existing] = await manager.query(
          `SELECT status FROM reports WHERE visitId=? LIMIT 1 FOR UPDATE`,
          [createReportDto.visitId],
        );
        if (existing) this.assertMutableReport(existing.status);
      }
      const saved = await manager.getRepository(Report).save(report);
      if (organizationId && createReportDto.visitId) {
        await manager.query(
          `UPDATE visits SET reportGenerated=1 WHERE organizationId=? AND id=?`,
          [organizationId, createReportDto.visitId],
        );
      }
      return saved;
    });
    this.notifyPreventionAfterCommit(persisted);
    return persisted;
  }

  /**
   * Atomically creates a report for a visit or refreshes its generated content.
   * The unique visitId index is the concurrency guard: simultaneous web/mobile
   * requests update the same report instead of producing ER_DUP_ENTRY.
   */
  async createOrUpdateGeneratedReport(user: User, createReportDto: CreateReportDto): Promise<Report> {
    const organizationId = user.organizationId ?? null;
    if (!organizationId) throw new ForbiddenException('Organization scope is required');
    return this.dataSource.transaction(async (manager) => {
      const [lockedVisit] = await manager.query(
        `SELECT id FROM visits WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
        [organizationId, createReportDto.visitId],
      );
      if (!lockedVisit) throw new NotFoundException('Visite introuvable');
      return this.upsertGeneratedReportInTransaction(manager, user, createReportDto);
    });
  }

  async upsertGeneratedReportInTransaction(
    manager: EntityManager,
    user: User,
    createReportDto: CreateReportDto,
  ): Promise<Report> {
    const organizationId = user.organizationId ?? null;
    if (!organizationId) throw new ForbiddenException('Organization scope is required');
    await this.assertReportRelationsInOrganization(
      manager, organizationId, createReportDto.missionId, createReportDto.visitId,
    );
    const existing = await manager.getRepository(Report).findOneBy({ visitId: createReportDto.visitId });
    if (existing) this.assertMutableReport(existing.status);
    const previousFingerprint = existing ? reportAnalyticalFingerprint(existing) : undefined;
    await manager.getRepository(Report).createQueryBuilder().insert().into(Report).values({
      ...createReportDto, userId: user.id, organizationId,
    }).orUpdate(['content', 'header', 'footer', 'conformityPercentage'], ['visitId']).execute();
    const persisted = await manager.getRepository(Report).findOneByOrFail({ visitId: createReportDto.visitId });
    if (existing && (
      existing.content !== persisted.content || existing.header !== persisted.header ||
      existing.footer !== persisted.footer || existing.conformityPercentage !== persisted.conformityPercentage
    )) {
      await manager.query(`UPDATE reports SET reportFileUrl=NULL WHERE organizationId=? AND id=?`, [organizationId, persisted.id]);
      persisted.reportFileUrl = null;
    }
    if (previousFingerprint !== reportAnalyticalFingerprint(persisted)) {
      await this.notifyVisitReportChangedInTransaction(manager, organizationId, persisted.id);
    }
    return persisted;
  }

  async findAll(user: User, status?: ReportStatus): Promise<Report[]> {
    const where: any = orgScope(user);

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    if (status) {
      where.status = status;
    }

    let reportsDb: any = await this.reportRepository.find({
      where,
      relations: ['visit', 'mission'],
      order: { createdAt: 'DESC' }
    });

    if (reportsDb?.length > 0) {
      const reports = [];
      reportsDb.forEach((report) => {
        if (!reports.some(r => r.id == report.id) || reports.length == 0) {
          const secondeMission = reportsDb.filter(r => r.missionId == report.missionId);
          if (secondeMission?.length > 0) {
            secondeMission.forEach(sr => {
              const visit = sr.visit;
              sr.visit = { photos: visit.photos, photoCount: visit.photoCount, createdAt: visit.createdAt, visitDate: visit.visitDate };
              reports.push(sr)
            });
          }
        }
      });
      return reports;
    }
    return [];
  }

  async findOne(id: string, user: User): Promise<Report> {
    const where: any = orgScope(user, { id });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    let report = await this.reportRepository.findOne({
      where,
      relations: ["mission", "visit", "user", "organization", "mission.organization", "visit.organization"],
    });

    if (!report) {
      // Legacy reports can carry a stale userId/organizationId while their
      // linked visit remains correctly scoped. The visit is the authorization
      // source for reports generated from visits.
      report = await this.reportRepository.findOne({
        where: { id },
        relations: ["mission", "visit", "user", "organization", "mission.organization", "visit.organization"],
      });
    }

    // The visit remains authoritative even when the report row matched the
    // preliminary tenant/user filter. An inconsistent legacy row must never
    // grant access to another tenant's report or PDF.
    const linkedVisit = report?.visit;
    const canAccessLinkedVisit = Boolean(
      linkedVisit &&
      (user.role === UserRole.HYPER_ADMIN ||
        (linkedVisit.organizationId === user.organizationId &&
          (user.role === UserRole.ADMIN || linkedVisit.userId === user.id))),
    );
    if (!canAccessLinkedVisit ||
        (report?.mission?.organizationId && report.mission.organizationId !== linkedVisit!.organizationId)) {
      throw new NotFoundException("Report not found");
    }

    return report;
  }

  async findByVisit(visitId: string, user: User): Promise<Report> {
    const where: any = orgScope(user, { visitId });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    const report = await this.reportRepository.findOne({ where });
    return report || null;
  }

  async findByMission(missionId: string, user: User): Promise<Report[]> {
    const where: any = orgScope(user, { missionId });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }
    return this.reportRepository.findBy(where);
  }

  /** Loads DB data, reuses a fresh S3 artifact, or renders it in backend Chromium. */
  private async generateAndStorePdfArtifact(
    id: string,
    user: User,
    requestedFileName?: string,
    forceRegenerate = false,
    preferExistingArtifact = false,
    allowGeneration = true,
  ): Promise<{ url: string; key: string; size: number; fileName: string; pdf: Buffer; cached: boolean }> {
    const report = await this.findOne(id, user);
    if (!isReportLocked(report.status) && Array.isArray(report.visit?.photos) && report.visit.photos.length === 0) {
      throw new ConflictException('Impossible de générer ou envoyer un rapport sans groupe d’analyse');
    }
    if (isReportLocked(report.status)) {
      if (!report.reportFileUrl || forceRegenerate) {
        throw new ConflictException('Le PDF d’un rapport envoyé ou archivé ne peut pas être régénéré');
      }
      preferExistingArtifact = true;
      allowGeneration = false;
    }
    if (!report.reportFileUrl && !allowGeneration) {
      throw new ForbiddenException('Permission insuffisante pour générer le PDF');
    }
    if (preferExistingArtifact && !forceRegenerate && report.reportFileUrl) {
      await this.uploadedAssets.assertReportAccess(user, report.reportFileUrl, id);
      if (allowGeneration && !isReportLocked(report.status)) {
        try {
          if (await this.reportPdfTemplateService.isOutdatedTemplate(report.reportFileUrl)) {
            preferExistingArtifact = false;
          }
        } catch {
          // Historical objects without readable metadata keep the legacy reuse path.
        }
      }
    }
    const generated = await this.reportPdfTemplateService.generate(
      report,
      requestedFileName,
      forceRegenerate,
      preferExistingArtifact,
      user,
    );
    await this.dataSource.transaction(async (manager) => {
      await this.lockCurrentPdfSource(manager, report);
      if (!generated.cached && generated.url !== report.reportFileUrl) {
        await manager.query(
          `UPDATE reports SET reportFileUrl=? WHERE id=? AND visitId=?`,
          [generated.url, id, report.visitId],
        );
      }
    });
    return generated;
  }

  async generateAndStorePdf(
    id: string,
    user: User,
    requestedFileName?: string,
    forceRegenerate = false,
  ): Promise<{ url: string; key: string; size: number; fileName: string; cached: boolean }> {
    const { pdf: _pdf, ...generated } = await this.generateAndStorePdfArtifact(
      id, user, requestedFileName, forceRegenerate,
    );
    return generated;
  }

  async resolveCurrentPdf(
    id: string,
    user: User,
    requestedFileName?: string,
  ): Promise<{ base64: string; contentType: 'application/pdf'; fileName: string; cached: boolean }> {
    const permission = effectivePermission(user, 'reports');
    if (!levelMeets(permission, 'read')) {
      throw new ForbiddenException('Permission insuffisante pour télécharger le PDF');
    }
    const { pdf, fileName, cached } = await this.generateAndStorePdfArtifact(
      id, user, requestedFileName, false, true, levelMeets(permission, 'write'),
    );
    return { base64: pdf.toString('base64'), contentType: 'application/pdf', fileName, cached };
  }
  async generateAndStorePdfByVisit(
    visitId: string,
    user: User,
    requestedFileName?: string,
    forceRegenerate = false,
  ): Promise<{ url: string; key: string; size: number; fileName: string; cached: boolean }> {
    const report = await this.findByVisit(visitId, user);
    if (!report) {
      throw new NotFoundException('Report not found for this visit');
    }
    return this.generateAndStorePdf(report.id, user, requestedFileName, forceRegenerate);
  }


  async update(id: string, user: User, updateReportDto: UpdateReportDto & { reportFileUrl?: string }): Promise<Report> {
    const report = await this.findOne(id, user);
    this.assertMutableReport(report.status);

    // if ((updateReportDto.status === ReportStatus.VALIDATED || updateReportDto.status === ReportStatus.SENT_TO_CLIENT) && user.role == UserRole.ADMIN) {
    //   throw new NotFoundException('Only Coordonator can validate / send to clients the reports');
    // }

    if (updateReportDto.status === ReportStatus.SENT) {
      updateReportDto['sentAt'] = new Date();
    }

    if (updateReportDto.status === ReportStatus.SENT_TO_CLIENT) {
      updateReportDto['sentToClientAt'] = new Date();
      // const mission = await this.missionService.findOne(report.missionId, user);
      // mission.status = 'terminee';
      // const missionDto = new UpdateMissionDto();
      // Object.assign(missionDto, mission);
      // await this.missionService.update(mission.id, mission.userId, missionDto);      
    }

    if (updateReportDto.status === ReportStatus.VALIDATED) {
      updateReportDto['validatedAt'] = new Date();
    }

    const result = await this.dataSource.transaction(async (manager) => {
      await this.lockMutableReport(manager, report);
      const current = await manager.getRepository(Report).findOneByOrFail({ id });
      const previousFingerprint = reportAnalyticalFingerprint(current);
      const pdfSourceChanged = (['title', 'header', 'content', 'footer'] as const).some((field) =>
        updateReportDto[field] !== undefined && updateReportDto[field] !== current[field]);
      // Strip relation objects to avoid TypeORM nulling join columns on save.
      const { visit: _visit, mission: _mission, user: _user, ...rest } = current as any;
      Object.assign(rest, updateReportDto);
      if (pdfSourceChanged) rest.reportFileUrl = null;
      rest.visitId = report.visitId;
      rest.missionId = report.missionId;
      rest.userId = report.visit?.userId ?? report.userId;
      rest.organizationId = resolveReportOrganizationId(report);
      return { persisted: await manager.getRepository(Report).save(rest), previousFingerprint };
    });
    this.notifyPreventionAfterCommit(result.persisted, result.previousFingerprint);
    if (updateReportDto.status === ReportStatus.VALIDATED) {
      const mission = await this.missionService.findOne(report.missionId, user);
      mission.status = 'terminee';
      const missionDto = new UpdateMissionDto();
      Object.assign(missionDto, mission);
      await this.missionService.update(mission.id, user, missionDto);
    }
    return this.findOne(id, user);
  }

  async delete(id: string, user: User): Promise<void> {
    const report = await this.findOne(id, user);
    this.assertMutableReport(report.status);
    const reportId = report.id;
    const occurredAt = new Date();
    const authoritativeOrganizationId = resolveReportOrganizationId(report);
    await this.dataSource.transaction(async (manager) => {
      await this.lockMutableReport(manager, report);
      if (authoritativeOrganizationId) {
        await this.markReportDeletionPartitions(manager, authoritativeOrganizationId, reportId, occurredAt);
      }
      await manager.getRepository(Report).remove(report);
      await manager.query(
        `UPDATE visits SET reportGenerated=0 WHERE organizationId=? AND id=?`,
        [authoritativeOrganizationId, report.visitId],
      );
    });
    if (authoritativeOrganizationId) {
      this.notifyReportDeletedAfterCommit(authoritativeOrganizationId, reportId, occurredAt);
    }
  }

  async markReportDeletionPartitions(
    manager: EntityManager, organizationId: string, reportId: string, occurredAt = new Date(),
  ): Promise<void> {
    const referenceDate = occurredAt.toISOString().slice(0, 10);
    await manager.query(
      `INSERT INTO prevention_statistics_partitions
        (id,organizationId,statDate,missionType,categoryKey,referenceDate,status,version,attempts,availableAt)
       SELECT UUID(),organizationId,businessDate,missionType,
         COALESCE(categoryId,'UNCATEGORIZED'),?,'PENDING',1,0,UTC_TIMESTAMP(6)
       FROM prevention_findings
       WHERE organizationId=? AND reportId=?
       GROUP BY organizationId,businessDate,missionType,COALESCE(categoryId,'UNCATEGORIZED')
       ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,attempts=0,
         referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),
         availableAt=UTC_TIMESTAMP(6),claimedAt=NULL,claimToken=NULL,lastError=NULL`,
      [referenceDate, organizationId, reportId],
    );
    await manager.query(
      `INSERT INTO prevention_score_partitions
        (id,organizationId,patternKey,missionType,categoryKey,findingType,referenceDate,
         status,version,availableAt)
       SELECT UUID(),organizationId,patternKey,missionType,
         COALESCE(categoryId,'UNCATEGORIZED'),findingType,?,
         'PENDING',1,UTC_TIMESTAMP(6)
       FROM prevention_findings
       WHERE organizationId=? AND reportId=?
       GROUP BY organizationId,patternKey,missionType,COALESCE(categoryId,'UNCATEGORIZED'),findingType
       ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,
         referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),
         availableAt=UTC_TIMESTAMP(6),claimedAt=NULL,claimToken=NULL`,
      [referenceDate, organizationId, reportId],
    );
  }

  notifyReportDeletedAfterCommit(organizationId: string, reportId: string, occurredAt = new Date()): void {
    // The independent Prevention consumer repairs its derived data. An outage
    // must never roll back or reject the already committed SPS deletion.
    void this.preventionOutboxService.enqueueReportEvent(this.dataSource.manager, {
      organizationId,
      reportId,
      eventType: 'REPORT_DELETED',
      aggregateVersion: occurredAt.toISOString(),
      occurredAt,
    }).catch((error) => this.logger.warn({ message: 'Prevention delete event deferred',
      reportId, errorCode: String(error?.code ?? 'UNKNOWN').slice(0, 64) } as any));
  }

  async save(report: Report, user: User): Promise<void> {
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    const scopedReport = await this.findOne(report.id, user);
    this.assertMutableReport(scopedReport.status);
    const previousFingerprint = reportAnalyticalFingerprint(scopedReport);
    report.visitId = scopedReport.visitId;
    report.missionId = scopedReport.missionId;
    report.organizationId = resolveReportOrganizationId(scopedReport);
    const persisted = await this.dataSource.transaction(async (manager) => {
      await this.lockMutableReport(manager, scopedReport);
      if (!report.organizationId) {
        throw new ForbiddenException('Organization scope is required');
      }
      await this.assertReportRelationsInOrganization(
        manager,
        report.organizationId,
        report.missionId,
        report.visitId,
      );
      return manager.getRepository(Report).save(report);
    });
    this.notifyPreventionAfterCommit(persisted, previousFingerprint);
  }

  async countByStatus(user: User): Promise<{ [key: string]: number }> {
    const where: any = orgScope(user);

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    const reports = await this.reportRepository.find({ where });

    return {
      [ReportStatus.DRAFT]: reports.filter(r => r.status === ReportStatus.DRAFT).length,
      [ReportStatus.SENT]: reports.filter(r => r.status === ReportStatus.SENT).length,
      [ReportStatus.VALIDATED]: reports.filter(r => r.status === ReportStatus.VALIDATED).length,
      [ReportStatus.REJECTED]: reports.filter(r => r.status === ReportStatus.REJECTED).length,
      [ReportStatus.ARCHIVED]: reports.filter(r => r.status === ReportStatus.ARCHIVED).length,
    };
  }

  async sendReportToClient(
    reportId: string,
    user: User,
    recipientEmail: string,
    subject: string,
    message: string,
    requestedFileName?: string,
    cc: string[] = [],
    forceRegenerate = false,
  ) {
    const report = await this.findOne(reportId, user);
    this.assertMutableReport(report.status);
    const primaryRecipient = recipientEmail.trim().toLowerCase();
    const { pdf, ...generated } = await this.generateAndStorePdfArtifact(
      reportId,
      user,
      requestedFileName,
      forceRegenerate,
      true,
    );
    const normalizedCc = Array.from(new Set(
      cc
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email && email !== primaryRecipient),
    ));

    const mailResult = await this.dataSource.transaction(async (manager) => {
      await this.lockCurrentPdfSource(manager, { ...report, reportFileUrl: generated.url });
      const result = await this.mailService.sendPdfReport(
        primaryRecipient,
        subject,
        message,
        Readable.from(pdf),
        generated.fileName,
        normalizedCc,
      );
      await manager.query(
        `UPDATE reports SET status=?,recipientEmail=?,sentToClientAt=UTC_TIMESTAMP(6)
         WHERE id=? AND visitId=?`,
        [ReportStatus.SENT_TO_CLIENT, primaryRecipient, reportId, report.visitId],
      );
      const organizationId = resolveReportOrganizationId(report);
      if (organizationId) {
        await this.notifyVisitReportChangedInTransaction(manager, organizationId, reportId);
      }
      return result;
    });

    return {
      ...mailResult,
      ...generated,
    };
  }
}
