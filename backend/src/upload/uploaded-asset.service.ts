import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { User, UserRole } from '../user/user.entity';
import { UploadedAssetGeneration, UploadedAssetStatus, UploadedAssetType } from './uploaded-asset.entity';

export type AssetSecurityMode = 'OBSERVE' | 'ENFORCE_NEW_ONLY';

export interface AssetRegistrationContext {
  user?: User;
  organizationId: string;
  uploaderId?: string | null;
  objectType: UploadedAssetType;
  visitId?: string | null;
  reportId?: string | null;
  sourceRef?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
}

export interface AssetAccessContext {
  visitId?: string;
  reportId?: string;
  objectType?: UploadedAssetType;
}

/**
 * AI image reads have a stricter contract than generic legacy downloads.
 * Generic callers still use the configurable OBSERVE/ENFORCE_NEW_ONLY policy;
 * AI must never turn an arbitrary S3 URL into an LLM input.
 */
export interface AiAssetAccessContext {
  visitId?: string;
}

export interface UserDownloadAccessContext extends AssetAccessContext {}

export interface UserDeleteAccessContext extends AssetAccessContext {
  groupId?: string;
}

export interface LegacyAssetRow {
  organizationId: string;
  s3Key: string;
  objectType: UploadedAssetType;
  visitId?: string | null;
  reportId?: string | null;
  sourceRef?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
}

@Injectable()
export class UploadedAssetService {
  private readonly logger = new Logger(UploadedAssetService.name);

  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  mode(): AssetSecurityMode {
    const value = String(this.config.get('ASSET_SECURITY_MODE', process.env.ASSET_SECURITY_MODE || 'OBSERVE')).trim().toUpperCase();
    if (value === 'OBSERVE' || value === 'ENFORCE_NEW_ONLY') return value;
    throw new Error('ASSET_SECURITY_MODE must be OBSERVE or ENFORCE_NEW_ONLY');
  }

  keyFromUrl(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) throw new ForbiddenException('Objet fichier invalide');
    let key = raw;
    if (raw.includes('://')) {
      let parsed: URL;
      try { parsed = new URL(raw); } catch { throw new ForbiddenException('Objet fichier invalide'); }
      const bucket = this.config.get<string>('AWS_S3_BUCKET');
      const region = this.config.get<string>('AWS_REGION');
      const expected = bucket && region ? `${bucket}.s3.${region}.amazonaws.com` : undefined;
      if (parsed.protocol !== 'https:' || parsed.search || parsed.hash || parsed.port ||
          (expected ? parsed.hostname !== expected : !/\.s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(parsed.hostname))) {
        throw new ForbiddenException('Objet fichier invalide');
      }
      try { key = decodeURIComponent(parsed.pathname.replace(/^\//, '')); } catch { throw new ForbiddenException('Objet fichier invalide'); }
    }
    if (!key || key.length > 512 || key.includes('..') || key.startsWith('/')) throw new ForbiddenException('Objet fichier invalide');
    return key;
  }

  private auditHash(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  private audit(operation: string, key: string, organizationId?: string, decision?: string): void {
    this.logger.log({
      message: 'ASSET_ACCESS_OBSERVED',
      event: 'ASSET_ACCESS_OBSERVED',
      operation,
      keyHash: this.auditHash(key),
      organizationId: organizationId || null,
      decision: decision || 'ALLOW',
    });
  }

  async registerVerified(context: AssetRegistrationContext, key: string): Promise<void> {
    const normalizedKey = this.keyFromUrl(key);
    await this.db.query(
      `INSERT INTO uploaded_assets
        (id,organizationId,uploaderId,s3Key,objectType,generation,status,visitId,reportId,sourceRef,sourceMetadata)
       VALUES (?,?,?,?,?,'VERIFIED_V1','ACTIVE',?,?,?,?)
       ON DUPLICATE KEY UPDATE
         uploaderId=COALESCE(uploaded_assets.uploaderId,VALUES(uploaderId)),
         objectType=VALUES(objectType),
         status='ACTIVE',
         visitId=COALESCE(VALUES(visitId),uploaded_assets.visitId),
         reportId=COALESCE(VALUES(reportId),uploaded_assets.reportId),
         sourceRef=COALESCE(VALUES(sourceRef),uploaded_assets.sourceRef),
         sourceMetadata=COALESCE(VALUES(sourceMetadata),uploaded_assets.sourceMetadata)`,
      [randomUUID(), context.organizationId, context.uploaderId ?? context.user?.id ?? null, normalizedKey,
        context.objectType, context.visitId ?? null, context.reportId ?? null, context.sourceRef ?? 'UPLOAD',
        context.sourceMetadata ? JSON.stringify(context.sourceMetadata) : null],
    );
  }

  async registerLegacy(row: LegacyAssetRow, dryRun = false): Promise<'inserted' | 'updated' | 'ambiguous' | 'skipped'> {
    const key = this.keyFromUrl(row.s3Key);
    const apply = async (executor: { query(sql: string, parameters?: any[]): Promise<any[]> }): Promise<'inserted' | 'updated' | 'ambiguous' | 'skipped'> => {
      const existing = await executor.query(
        `SELECT id,organizationId,generation FROM uploaded_assets WHERE s3Key=? FOR UPDATE`,
        [key],
      );
      const current = existing.find((item: any) => item.organizationId === row.organizationId);
      // A legacy inventory is strictly additive. It must never reactivate,
      // reclassify or rebind an object created by the verified upload path.
      if (current?.generation === UploadedAssetGeneration.VERIFIED_V1) return 'skipped';
      const otherOrganizations = existing.filter((item: any) => item.organizationId !== row.organizationId);
      const generation = otherOrganizations.length ? UploadedAssetGeneration.LEGACY_AMBIGUOUS : UploadedAssetGeneration.LEGACY_LINKED;
      if (dryRun) return generation === UploadedAssetGeneration.LEGACY_AMBIGUOUS ? 'ambiguous' : current ? 'updated' : 'inserted';

      await executor.query(
        `INSERT INTO uploaded_assets
          (id,organizationId,uploaderId,s3Key,objectType,generation,status,visitId,reportId,sourceRef,sourceMetadata)
         VALUES (?,?,NULL,?,?,?,'ACTIVE',?,?,?,?)
         ON DUPLICATE KEY UPDATE
           objectType=VALUES(objectType),
           generation=IF(uploaded_assets.generation='VERIFIED_V1',uploaded_assets.generation,VALUES(generation)),
           status='ACTIVE',
           visitId=COALESCE(VALUES(visitId),uploaded_assets.visitId),
           reportId=COALESCE(VALUES(reportId),uploaded_assets.reportId),
           sourceRef=COALESCE(VALUES(sourceRef),uploaded_assets.sourceRef),
           sourceMetadata=COALESCE(VALUES(sourceMetadata),uploaded_assets.sourceMetadata)`,
        [randomUUID(), row.organizationId, key, row.objectType, generation, row.visitId ?? null, row.reportId ?? null,
          row.sourceRef ?? 'BACKFILL', row.sourceMetadata ? JSON.stringify(row.sourceMetadata) : null],
      );
      return generation === UploadedAssetGeneration.LEGACY_AMBIGUOUS ? 'ambiguous' : current ? 'updated' : 'inserted';
    };
    if (dryRun) return apply(this.db);
    return typeof (this.db as any).transaction === 'function'
      ? this.db.transaction((manager) => apply(manager))
      : apply(this.db);
  }

  async markDetached(organizationId: string | null | undefined, keyOrUrl: string): Promise<void> {
    if (!organizationId) return;
    const key = this.keyFromUrl(keyOrUrl);
    await this.db.query(`UPDATE uploaded_assets SET status='DETACHED',updatedAt=UTC_TIMESTAMP(6) WHERE organizationId=? AND s3Key=?`, [organizationId, key]);
  }

  private async findByOrgKey(organizationId: string, key: string): Promise<any | undefined> {
    const [row] = await this.db.query(`SELECT * FROM uploaded_assets WHERE organizationId=? AND s3Key=? LIMIT 1`, [organizationId, key]);
    return row;
  }

  private async inspectVerification(organizationId: string, keyOrUrl: string, context?: AssetAccessContext): Promise<{
    key: string;
    verifiedRows: any[];
    applicableVerified: any | undefined;
  }> {
    const key = this.keyFromUrl(keyOrUrl);
    const rows = await this.db.query(
      `SELECT organizationId,status,generation,visitId,reportId,objectType
       FROM uploaded_assets WHERE s3Key=?`,
      [key],
    );
    const verifiedRows = rows.filter((candidate: any) => candidate.generation === UploadedAssetGeneration.VERIFIED_V1);
    const applicableVerified = verifiedRows.find((candidate: any) => candidate.organizationId === organizationId &&
      candidate.status !== UploadedAssetStatus.DETACHED &&
      (!context?.visitId || candidate.visitId === context.visitId) &&
      (!context?.reportId || candidate.reportId === context.reportId) &&
      (!context?.objectType || candidate.objectType === context.objectType));
    return { key, verifiedRows, applicableVerified };
  }

  async isVerifiedActiveForOrganization(organizationId: string, keyOrUrl: string, context?: AssetAccessContext): Promise<boolean> {
    try {
      const inspection = await this.inspectVerification(organizationId, keyOrUrl, context);
      return inspection.verifiedRows.length > 0 && Boolean(inspection.applicableVerified);
    } catch {
      return false;
    }
  }

  private async isLegacyReference(organizationId: string, key: string, context?: AssetAccessContext): Promise<boolean> {
    const params: any[] = [organizationId, key];
    const [visit] = await this.db.query(
      `SELECT id FROM visits WHERE organizationId=? AND JSON_SEARCH(photos,'one',CONCAT('%',?,'%')) IS NOT NULL ${context?.visitId ? 'AND id=?' : ''} LIMIT 1`,
      context?.visitId ? [...params, context.visitId] : params,
    );
    if (visit) return true;
    const [report] = await this.db.query(
      `SELECT id FROM reports WHERE organizationId=? AND (reportFileUrl=? OR reportFileUrl LIKE CONCAT('%/',?)) ${context?.reportId ? 'AND id=?' : ''} LIMIT 1`,
      context?.reportId ? [organizationId, key, key, context.reportId] : [organizationId, key, key],
    );
    if (report) return true;
    const [organization] = await this.db.query(
      `SELECT id FROM organizations WHERE id=? AND (logoS3Key=? OR backgroundImageS3Key=?) LIMIT 1`,
      [organizationId, key, key],
    );
    return Boolean(organization);
  }

  private async hasLegacyWorkerPhotoReference(organizationId: string, key: string, visitId?: string): Promise<boolean> {
    const params: any[] = [organizationId];
    const visitFilter = visitId ? ' AND id=?' : '';
    if (visitId) params.push(visitId);
    params.push(`%${key}%`);
    const [visit] = await this.db.query(
      `SELECT id FROM visits
       WHERE organizationId=?${visitFilter}
         AND JSON_SEARCH(photos,'one',CONCAT('%',?,'%')) IS NOT NULL
       LIMIT 1`,
      params,
    );
    return Boolean(visit);
  }

  private async assertOrganizationAccess(organizationId: string, keyOrUrl: string, operation: string, context?: AssetAccessContext): Promise<void> {
    const mode = this.mode();
    let key: string;
    try {
      key = this.keyFromUrl(keyOrUrl);
    } catch (error) {
      if (mode === 'OBSERVE') {
        this.audit(operation, String(keyOrUrl || '').slice(0, 512), organizationId, 'ALLOW_LEGACY_UNPARSED');
        return;
      }
      throw error;
    }
    let inspection: { verifiedRows: any[]; applicableVerified: any | undefined };
    try {
      inspection = await this.inspectVerification(organizationId, key, context);
    } catch (error) {
      if (mode === 'OBSERVE') {
        this.audit(operation, key, organizationId, 'ALLOW_LEGACY_REGISTRY_UNAVAILABLE');
        return;
      }
      throw error;
    }
    const { verifiedRows, applicableVerified } = inspection;
    if (mode === 'OBSERVE') {
      this.audit(operation, key, organizationId, applicableVerified ? 'ALLOW_VERIFIED' : 'ALLOW_LEGACY');
      return;
    }
    // ENFORCE_NEW_ONLY is deliberately scoped to assets created after the
    // registry rollout. Legacy objects remain operable, including unresolved
    // and ambiguous rows, until a separately approved restriction exists.
    if (verifiedRows.length > 0 && !applicableVerified) {
      this.audit(operation, key, organizationId, 'DENY');
      throw new ForbiddenException('Objet fichier non autorisé pour cette organisation');
    }
    this.audit(operation, key, organizationId, applicableVerified ? 'ALLOW_VERIFIED' : 'ALLOW_LEGACY');
  }

  async assertAccess(user: User | undefined, keyOrUrl: string, operation: string, context?: AssetAccessContext): Promise<void> {
    if (!user?.organizationId) return;
    return this.assertOrganizationAccess(user.organizationId, keyOrUrl, operation, context);
  }

  private canAccessVisit(user: User, visit: any): boolean {
    if (!visit) return false;
    return user.role === UserRole.ADMIN || user.role === UserRole.HYPER_ADMIN || visit.userId === user.id;
  }

  private async findAccessibleVisit(user: User, visitId: string): Promise<any> {
    const [visit] = await this.db.query(
      `SELECT id,userId FROM visits WHERE organizationId=? AND id=? LIMIT 1`,
      [user.organizationId, visitId],
    );
    if (!this.canAccessVisit(user, visit)) {
      throw new ForbiddenException('Visite non autorisée pour cette organisation');
    }
    return visit;
  }

  private async hasLegacyAiPhotoReference(user: User, key: string, visitId?: string): Promise<boolean> {
    const params: any[] = [user.organizationId];
    let visitFilter = '';
    if (visitId) {
      visitFilter = ' AND id=?';
      params.push(visitId);
    }
    params.push(`%${key}%`);
    const rows = await this.db.query(
      `SELECT id,userId FROM visits
       WHERE organizationId=?${visitFilter}
         AND JSON_SEARCH(photos,'one',CONCAT('%',?,'%')) IS NOT NULL
       LIMIT 20`,
      params,
    );
    return rows.some((visit: any) => this.canAccessVisit(user, visit));
  }

  /**
   * Strict authorization for image bytes sent to an AI provider.
   * This intentionally ignores ASSET_SECURITY_MODE: OBSERVE is suitable for
   * migration telemetry, but is not a safe authorization decision for LLM
   * input. Newly uploaded photos remain usable before visit attachment when
   * their registry/provenance row belongs to the requesting user.
   */
  async assertAiAccess(user: User | undefined, keyOrUrl: string, context?: AiAssetAccessContext): Promise<void> {
    if (!user?.organizationId) throw new ForbiddenException('Organisation requise');
    const key = this.keyFromUrl(keyOrUrl);
    if (context?.visitId) await this.findAccessibleVisit(user, context.visitId);

    const registryRows = await this.db.query(
      `SELECT organizationId,uploaderId,status,generation,objectType,visitId
       FROM uploaded_assets WHERE s3Key=?`,
      [key],
    );
    const verifiedRows = registryRows.filter((row: any) => row.generation === UploadedAssetGeneration.VERIFIED_V1);
    // A verified key collision is never resolved by an OBSERVE fallback: a
    // foreign tenant's object must not be sent to the model.
    if (verifiedRows.some((row: any) => row.organizationId !== user.organizationId)) {
      throw new ForbiddenException('Photo non autorisée pour cette organisation');
    }

    // A verified upload row is authoritative. Detached or non-photo rows
    // must not fall through to a permissive legacy-reference check.
    if (verifiedRows.some((row: any) =>
      row.organizationId === user.organizationId &&
      (row.status === UploadedAssetStatus.DETACHED || row.objectType !== UploadedAssetType.PHOTO))) {
      throw new ForbiddenException('Photo non autorisée pour cette organisation');
    }

    const verifiedPhoto = verifiedRows.find((row: any) =>
      row.organizationId === user.organizationId &&
      row.status !== UploadedAssetStatus.DETACHED &&
      row.objectType === UploadedAssetType.PHOTO,
    );
    if (verifiedPhoto) {
      if (verifiedPhoto.visitId && context?.visitId && verifiedPhoto.visitId !== context.visitId) {
        throw new ForbiddenException('Photo non autorisée pour cette visite');
      }
      // The upload endpoint registers a photo before it is attached to a
      // visit. Only its uploader may use that unbound object at this point.
      if (!verifiedPhoto.visitId && verifiedPhoto.uploaderId === user.id) return;
    }

    // The visit-photo provenance table covers the short window between upload
    // and attachment, as well as attached assets whose registry row predates
    // the visit binding.
    const photoRows = await this.db.query(
      `SELECT organizationId,uploaderId,status,visitId
       FROM visit_photo_assets WHERE organizationId=? AND s3Key=? AND status<>'DETACHED' LIMIT 20`,
      [user.organizationId, key],
    );
    for (const photo of photoRows) {
      if (photo.status === 'UPLOADED' && !photo.visitId && photo.uploaderId === user.id &&
          (!verifiedPhoto || photo.uploaderId === verifiedPhoto.uploaderId)) return;
      if (photo.visitId && (!context?.visitId || context.visitId === photo.visitId)) {
        if (verifiedPhoto?.visitId &&
            (photo.status !== 'ATTACHED' || photo.visitId !== verifiedPhoto.visitId)) continue;
        await this.findAccessibleVisit(user, photo.visitId);
        return;
      }
    }

    // A bound verified photo requires active attachment provenance; a stale
    // visit JSON reference cannot rescue it.
    if (verifiedPhoto) throw new ForbiddenException('Provenance de photo inactive ou incohérente');
    if (await this.hasLegacyAiPhotoReference(user, key, context?.visitId)) return;
    throw new ForbiddenException('Photo non rattachée à une visite autorisée');
  }

  private async hasOwnedReportReference(user: User, key: string, reportId?: string): Promise<boolean> {
    const params: any[] = [user.organizationId, key, key];
    const reportFilter = reportId ? ' AND r.id=?' : '';
    if (reportId) params.push(reportId);
    const rows = await this.db.query(
      `SELECT r.id,r.visitId,v.userId,v.organizationId
       FROM reports r
       INNER JOIN visits v ON v.organizationId=r.organizationId AND v.id=r.visitId
       WHERE r.organizationId=?
         AND (r.reportFileUrl=? OR r.reportFileUrl LIKE CONCAT('%/',?))${reportFilter}
       LIMIT 20`,
      params,
    );
    return rows.some((report: any) => this.canAccessVisit(user, report));
  }

  private async hasAnyReportReference(user: User, key: string, reportId?: string): Promise<boolean> {
    const params: any[] = [user.organizationId, key, key];
    const reportFilter = reportId ? ' OR r.id=?' : '';
    if (reportId) params.push(reportId);
    const [report] = await this.db.query(
      `SELECT r.id
       FROM reports r
       INNER JOIN visits v ON v.organizationId=r.organizationId AND v.id=r.visitId
       WHERE r.organizationId=?
         AND ((r.reportFileUrl=? OR r.reportFileUrl LIKE CONCAT('%/',?))${reportFilter})
       LIMIT 1`,
      params,
    );
    return Boolean(report);
  }

  private async hasOwnedOrganizationReference(user: User, key: string): Promise<boolean> {
    const [organization] = await this.db.query(
      `SELECT id FROM organizations
       WHERE id=? AND (logoS3Key=? OR backgroundImageS3Key=?) LIMIT 1`,
      [user.organizationId, key, key],
    );
    return Boolean(organization);
  }

  /**
   * Strict authorization for user-facing S3 downloads. This deliberately does
   * not use ASSET_SECURITY_MODE: OBSERVE is migration telemetry, not an
   * authorization policy. Relations are checked against the visit owner for
   * ROLE_USER and against the tenant for administrators.
   */
  async assertDownloadAccess(user: User | undefined, keyOrUrl: string, context?: UserDownloadAccessContext): Promise<void> {
    if (!user?.organizationId) throw new ForbiddenException('Organisation requise');
    const key = this.keyFromUrl(keyOrUrl);
    if (context?.visitId) await this.findAccessibleVisit(user, context.visitId);

    const registryRows = await this.db.query(
      `SELECT organizationId,uploaderId,status,generation,objectType,visitId,reportId
       FROM uploaded_assets WHERE s3Key=?`,
      [key],
    );
    const verifiedRows = registryRows.filter((row: any) => row.generation === UploadedAssetGeneration.VERIFIED_V1);
    if (verifiedRows.some((row: any) => row.organizationId !== user.organizationId)) {
      throw new ForbiddenException('Objet fichier non autorisé pour cette organisation');
    }
    const tenantRows = registryRows.filter((row: any) => row.organizationId === user.organizationId);
    if (tenantRows.some((row: any) => row.status === UploadedAssetStatus.DETACHED)) {
      throw new ForbiddenException('Objet fichier détaché');
    }
    const tenantVerified = verifiedRows.filter((row: any) => row.organizationId === user.organizationId);
    if (tenantVerified.some((row: any) => ![
      UploadedAssetType.PHOTO,
      UploadedAssetType.REPORT_PDF,
      UploadedAssetType.REPORT_FILE,
      UploadedAssetType.ORGANIZATION_LOGO,
      UploadedAssetType.ORGANIZATION_BACKGROUND,
    ].includes(row.objectType))) {
      throw new ForbiddenException('Objet fichier non autorisé');
    }

    const verified = tenantVerified[0];
    if (verified?.objectType === UploadedAssetType.PHOTO) {
      if (verified.visitId && context?.visitId && verified.visitId !== context.visitId) {
        throw new ForbiddenException('Photo non autorisée pour cette visite');
      }
      const photoRows = await this.db.query(
        `SELECT uploaderId,status,visitId
         FROM visit_photo_assets WHERE organizationId=? AND s3Key=? AND status<>'DETACHED' LIMIT 20`,
        [user.organizationId, key],
      );
      for (const photo of photoRows) {
        if (photo.status === 'UPLOADED' && !photo.visitId && photo.uploaderId === user.id) return;
        if (photo.status === 'ATTACHED' && photo.visitId &&
            (!context?.visitId || context.visitId === photo.visitId) &&
            (!verified.visitId || verified.visitId === photo.visitId)) {
          await this.findAccessibleVisit(user, photo.visitId);
          return;
        }
      }
      throw new ForbiddenException('Photo non rattachée à une visite autorisée');
    }

    if (verified?.objectType === UploadedAssetType.REPORT_PDF ||
        verified?.objectType === UploadedAssetType.REPORT_FILE) {
      if (context?.visitId && verified.visitId && context.visitId !== verified.visitId) {
        throw new ForbiddenException('PDF non autorisé pour cette visite');
      }
      if (context?.reportId && verified.reportId && context.reportId !== verified.reportId) {
        throw new ForbiddenException('PDF non autorisé pour ce rapport');
      }
      if (await this.hasOwnedReportReference(user, key, context?.reportId || verified.reportId || undefined)) return;
      throw new ForbiddenException('PDF non rattaché à un rapport autorisé');
    }

    if (verified && (verified.objectType === UploadedAssetType.ORGANIZATION_LOGO ||
        verified.objectType === UploadedAssetType.ORGANIZATION_BACKGROUND) &&
        await this.hasOwnedOrganizationReference(user, key)) return;

    // Legacy registry rows are accepted only when the current business row
    // proves the same tenant/user relation. An arbitrary unregistered key is
    // never allowed to fall through in OBSERVE mode.
    if (!verified && (await this.hasLegacyAiPhotoReference(user, key, context?.visitId) ||
        await this.hasOwnedReportReference(user, key, context?.reportId) ||
        await this.hasOwnedOrganizationReference(user, key))) return;
    throw new ForbiddenException('Objet fichier non rattaché à une ressource autorisée');
  }

  /**
   * Strict authorization for user-initiated deletion. Attached visit photos
   * are intentionally reserved for the visit/group attachment workflow; the
   * generic upload endpoint can delete only an unbound photo with uploader
   * ownership (the controller additionally verifies its signed receipt).
   */
  async assertDeleteAccess(user: User | undefined, keyOrUrl: string, context?: UserDeleteAccessContext): Promise<void> {
    if (!user?.organizationId) throw new ForbiddenException('Organisation requise');
    const key = this.keyFromUrl(keyOrUrl);
    if (context?.visitId) await this.findAccessibleVisit(user, context.visitId);

    const registryRows = await this.db.query(
      `SELECT organizationId,uploaderId,status,generation,objectType,visitId,reportId
       FROM uploaded_assets WHERE s3Key=?`,
      [key],
    );
    if (registryRows.some((row: any) => row.organizationId !== user.organizationId)) {
      throw new ForbiddenException('Objet fichier non autorisé pour cette organisation');
    }
    const tenantRows = registryRows.filter((row: any) => row.organizationId === user.organizationId);
    if (!tenantRows.length) throw new ForbiddenException('Objet fichier non enregistré');
    if (tenantRows.some((row: any) => row.status === UploadedAssetStatus.DETACHED)) {
      throw new ForbiddenException('Objet fichier détaché');
    }
    if (tenantRows.some((row: any) => context?.objectType && row.objectType !== context.objectType)) {
      throw new ForbiddenException('Type de fichier non autorisé');
    }

    const asset = tenantRows[0];
    if (asset.objectType === UploadedAssetType.PHOTO) {
      if (asset.visitId && context?.visitId && asset.visitId !== context.visitId) {
        throw new ForbiddenException('Photo non autorisée pour cette visite');
      }
      if (asset.visitId && !context?.visitId) {
        throw new ForbiddenException('Photo rattachée : utilisez la commande de visite');
      }
      const photoRows = await this.db.query(
        `SELECT uploaderId,status,visitId
         FROM visit_photo_assets WHERE organizationId=? AND s3Key=? LIMIT 20`,
        [user.organizationId, key],
      );
      for (const photo of photoRows) {
        if (photo.status === 'UPLOADED' && !photo.visitId && photo.uploaderId === user.id) return;
        if (photo.status === 'ATTACHED') {
          // Attached photos must go through the visit/group command, which
          // locks the visit and validates group provenance transactionally.
          if (!context?.visitId || !context.groupId || photo.visitId !== context.visitId) {
            throw new ForbiddenException('Photo rattachée : utilisez la commande de visite');
          }
          await this.findAccessibleVisit(user, photo.visitId);
          return;
        }
      }
      throw new ForbiddenException('Provenance de photo absente ou révoquée');
    }

    if (asset.objectType === UploadedAssetType.REPORT_PDF ||
        asset.objectType === UploadedAssetType.REPORT_FILE) {
      const reportId = context?.reportId || asset.reportId || undefined;
      if (await this.hasAnyReportReference(user, key)) {
        if (await this.hasOwnedReportReference(user, key, reportId)) return;
        throw new ForbiddenException('Fichier rapport non autorisé pour cette visite');
      }
      if (asset.uploaderId === user.id) return;
      throw new ForbiddenException('Fichier rapport non autorisé');
    }

    // Generic uploads remain deletable only by their uploader. Organization
    // assets and other server-owned objects have dedicated service paths.
    if (asset.uploaderId === user.id && asset.objectType === UploadedAssetType.GENERIC) return;
    throw new ForbiddenException('Objet fichier non autorisé à la suppression');
  }

  async assertWorkerAccess(organizationId: string, keyOrUrl: string, operation: string, context?: AssetAccessContext): Promise<void> {
    if (!organizationId) throw new ForbiddenException('Organisation requise');
    const key = this.keyFromUrl(keyOrUrl);
    const rows = await this.db.query(
      `SELECT organizationId,status,generation,objectType,visitId,reportId
       FROM uploaded_assets WHERE s3Key=?`,
      [key],
    );
    const verifiedRows = rows.filter((row: any) => row.generation === UploadedAssetGeneration.VERIFIED_V1);

    // A worker read is an AI boundary. Once the registry knows about a key,
    // OBSERVE must not turn an incompatible row into a legacy authorization.
    if (verifiedRows.some((row: any) => row.organizationId !== organizationId)) {
      this.audit(operation, key, organizationId, 'DENY');
      throw new ForbiddenException('Objet fichier non autorisé pour cette organisation');
    }
    if (verifiedRows.some((row: any) => row.status === UploadedAssetStatus.DETACHED)) {
      this.audit(operation, key, organizationId, 'DENY');
      throw new ForbiddenException('Objet fichier détaché');
    }
    const expectedType = context?.objectType || UploadedAssetType.PHOTO;
    if (verifiedRows.some((row: any) => row.objectType !== expectedType)) {
      this.audit(operation, key, organizationId, 'DENY');
      throw new ForbiddenException('Type de fichier non autorisé');
    }
    if (verifiedRows.some((row: any) => context?.visitId && row.visitId && row.visitId !== context.visitId)) {
      this.audit(operation, key, organizationId, 'DENY');
      throw new ForbiddenException('Objet fichier non autorisé pour cette visite');
    }
    if (verifiedRows.some((row: any) => context?.reportId && row.reportId && row.reportId !== context.reportId)) {
      this.audit(operation, key, organizationId, 'DENY');
      throw new ForbiddenException('Objet fichier non autorisé pour ce rapport');
    }
    if (verifiedRows.length) {
      this.audit(operation, key, organizationId, 'ALLOW_VERIFIED');
      return;
    }

    // Legacy objects remain usable only through an existing tenant relation;
    // an unregistered/arbitrary key must never reach S3 from the worker.
    if (await this.hasLegacyWorkerPhotoReference(organizationId, key, context?.visitId)) {
      this.audit(operation, key, organizationId, 'ALLOW_LEGACY');
      return;
    }
    this.audit(operation, key, organizationId, 'DENY');
    throw new ForbiddenException('Objet fichier non rattaché à une ressource autorisée');
  }

  async assertReportAccess(user: User | undefined, pdfUrl: string, reportId?: string): Promise<void> {
    if (!user?.organizationId) throw new ForbiddenException('Organisation requise');
    // A report relation is mandatory even in OBSERVE: unlike generic legacy
    // assets, a PDF here is being reused for a specific tenant report.
    const inspection = await this.inspectVerification(user.organizationId, pdfUrl);
    const { key, verifiedRows, applicableVerified } = inspection;
    // A verified object is never treated as a legacy URL: a foreign, detached,
    // or wrong-report registry row must be rejected once new-object
    // enforcement is explicitly enabled.
    if (verifiedRows.length > 0 && (!applicableVerified ||
        (reportId && applicableVerified.reportId && applicableVerified.reportId !== reportId))) {
      this.audit('MAIL_REPORT_DOWNLOAD', key, user.organizationId, 'DENY');
      throw new ForbiddenException('PDF non autorisé pour cette organisation');
    }
    const relationParams: any[] = [user.organizationId, key, key];
    const reportFilter = reportId ? ' AND id=?' : '';
    if (reportId) relationParams.push(reportId);
    const [report] = await this.db.query(
      `SELECT id FROM reports
       WHERE organizationId=? AND (reportFileUrl=? OR reportFileUrl LIKE CONCAT('%/',?))${reportFilter}
       LIMIT 1`,
      relationParams,
    );
    if (report) {
      this.audit('MAIL_REPORT_DOWNLOAD', key, user.organizationId, 'ALLOW_REPORT');
      return;
    }
    throw new ForbiddenException('PDF non rattaché à un rapport de cette organisation');
  }
}
