import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { User } from '../user/user.entity';
import { UploadedAssetService } from './uploaded-asset.service';
import { UploadedAssetGeneration, UploadedAssetStatus, UploadedAssetType } from './uploaded-asset.entity';

export interface VisitPhotoReceiptPayload {
  v: 1;
  key: string;
  userId: string;
  organizationId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface VisitPhotoUploadResult {
  url: string;
  key: string;
  receipt: string;
}

export interface SqlExecutor {
  query(sql: string, parameters?: any[]): Promise<any>;
}

const RECEIPT_TTL_MS = 15 * 60 * 1000;
const MAX_RECEIPT_TTL_MS = 60 * 60 * 1000;
const VISIT_PHOTO_KEY = /^visits\/photos\/[0-9a-f-]{36}\.(?:jpe?g|jfif|png|webp|avif)$/i;

export function visitPhotoKeyFromUrl(value: string, bucket?: string, region?: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new BadRequestException('URL de photo invalide'); }
  const expectedHost = bucket && region ? `${bucket}.s3.${region}.amazonaws.com` : undefined;
  if (parsed.protocol !== 'https:' || parsed.search || parsed.hash || parsed.port ||
      (expectedHost ? parsed.hostname !== expectedHost : !/^[a-z0-9][a-z0-9.-]*\.s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(parsed.hostname))) {
    throw new BadRequestException('URL de photo invalide');
  }
  let key: string;
  try { key = decodeURIComponent(parsed.pathname.slice(1)); } catch { throw new BadRequestException('URL de photo invalide'); }
  if (!VISIT_PHOTO_KEY.test(key)) throw new BadRequestException('URL de photo invalide');
  return key;
}

@Injectable()
export class VisitPhotoAssetService {
  private readonly logger = new Logger(VisitPhotoAssetService.name);

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly assets: UploadedAssetService,
  ) {}

  private secret(): string {
    const secret = this.config.get<string>('ASSET_RECEIPT_SECRET') || this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) throw new Error('ASSET_RECEIPT_SECRET must contain at least 32 characters');
    return secret;
  }

  private ttlMs(): number {
    const configured = Number(this.config.get('ASSET_RECEIPT_TTL_MS', RECEIPT_TTL_MS));
    if (!Number.isFinite(configured) || configured < 60_000 || configured > MAX_RECEIPT_TTL_MS) {
      throw new Error('ASSET_RECEIPT_TTL_MS must be between 60000 and 3600000');
    }
    return Math.floor(configured);
  }

  private encode(payload: VisitPhotoReceiptPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private decode(receipt: string): VisitPhotoReceiptPayload {
    const parts = String(receipt || '').split('.');
    if (parts.length !== 2 || parts.some((part) => !part || part.length > 4096)) {
      throw new ForbiddenException('Reçu photo invalide');
    }
    const expected = createHmac('sha256', this.secret()).update(parts[0]).digest('base64url');
    const actualBuffer = Buffer.from(parts[1]);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      throw new ForbiddenException('Reçu photo invalide');
    }
    let payload: VisitPhotoReceiptPayload;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch {
      throw new ForbiddenException('Reçu photo invalide');
    }
    if (payload?.v !== 1 || typeof payload.key !== 'string' || typeof payload.userId !== 'string' ||
        typeof payload.organizationId !== 'string' || typeof payload.nonce !== 'string' ||
        !Number.isInteger(payload.issuedAt) || !Number.isInteger(payload.expiresAt) ||
        payload.key.length > 512 || payload.nonce.length > 64) {
      throw new ForbiddenException('Reçu photo invalide');
    }
    const now = Date.now();
    if (payload.expiresAt <= now || payload.issuedAt > now + 60_000 || payload.expiresAt - payload.issuedAt > MAX_RECEIPT_TTL_MS) {
      throw new ForbiddenException('Reçu photo expiré');
    }
    return payload;
  }

  issueReceipt(user: User, key: string): string {
    if (!user.organizationId) throw new ForbiddenException('Organisation requise');
    const now = Date.now();
    return this.encode({
      v: 1,
      key,
      userId: user.id,
      organizationId: user.organizationId,
      issuedAt: now,
      expiresAt: now + this.ttlMs(),
      nonce: randomUUID(),
    });
  }

  async registerUploadedAsset(user: User, key: string, receipt: string): Promise<void> {
    const payload = this.verifyReceipt(user, key, receipt);
    try {
      await this.db.query(
        `INSERT INTO visit_photo_assets
          (id,organizationId,uploaderId,visitId,groupId,s3Key,receiptNonce,receiptIssuedAt,receiptExpiresAt,status)
         VALUES (?,?,?,NULL,NULL,?,?,?,?, 'UPLOADED')`,
        [randomUUID(), user.organizationId, user.id, key, payload.nonce,
          new Date(payload.issuedAt), new Date(payload.expiresAt)],
      );
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        const [existing] = await this.db.query(
          `SELECT id FROM visit_photo_assets WHERE organizationId=? AND s3Key=? AND uploaderId=? AND status<>'DETACHED' LIMIT 1`,
          [user.organizationId, key, user.id],
        );
        if (existing) return;
      }
      throw new BadRequestException('Impossible d’enregistrer la provenance de la photo');
    }
  }

  verifyReceipt(user: User, urlOrKey: string, receipt: string): VisitPhotoReceiptPayload {
    const key = urlOrKey.includes('://')
      ? visitPhotoKeyFromUrl(urlOrKey, this.config.get('AWS_S3_BUCKET'), this.config.get('AWS_REGION'))
      : urlOrKey;
    const payload = this.decode(receipt);
    if (payload.key !== key || payload.userId !== user.id || payload.organizationId !== user.organizationId) {
      throw new ForbiddenException('Reçu photo non autorisé');
    }
    return payload;
  }

  async assertReceiptsForAttach(
    executor: SqlExecutor,
    user: User,
    visitId: string,
    groupId: string,
    urls: string[],
    receipts: string[],
  ): Promise<string[]> {
    if (!Array.isArray(receipts) || receipts.length !== urls.length) {
      throw new BadRequestException('Un reçu signé est requis pour chaque photo');
    }
    const keys = urls.map((url, index) => {
      const key = visitPhotoKeyFromUrl(url, this.config.get('AWS_S3_BUCKET'), this.config.get('AWS_REGION'));
      this.verifyReceipt(user, key, receipts[index]);
      return key;
    });
    for (const key of keys) {
      await this.assets.assertAiAccess(user, key, { visitId });
      const [asset] = await executor.query(
        `SELECT id,organizationId,uploaderId,visitId,groupId,status
         FROM visit_photo_assets WHERE organizationId=? AND s3Key=? LIMIT 1 FOR UPDATE`,
        [user.organizationId, key],
      );
      if (!asset || asset.uploaderId !== user.id || asset.status === 'DETACHED') {
        throw new ForbiddenException('La provenance de la photo est inconnue ou révoquée');
      }
      if (asset.visitId && (asset.visitId !== visitId || asset.groupId !== groupId)) {
        throw new ConflictException('La photo est déjà rattachée à un autre groupe');
      }
    }
    return keys;
  }

  async assertGroupAssets(executor: SqlExecutor, user: User, visitId: string, groupId: string, urls: string[]): Promise<void> {
    for (const url of urls) {
      const key = visitPhotoKeyFromUrl(url, this.config.get('AWS_S3_BUCKET'), this.config.get('AWS_REGION'));
      await this.assets.assertAiAccess(user, key, { visitId });
      const [asset] = await executor.query(
        `SELECT id FROM visit_photo_assets
         WHERE organizationId=? AND visitId=? AND groupId=? AND s3Key=? AND status='ATTACHED' LIMIT 1`,
        [user.organizationId, visitId, groupId, key],
      );
      if (!asset && await this.isLegacyVisitReference(executor, user.organizationId, visitId, key)) continue;
      if (!asset) throw new ForbiddenException('Cette photo historique ne peut pas être réanalysée sans provenance serveur');
    }
  }

  private async bindVerifiedRegistryAsset(executor: SqlExecutor, organizationId: string, visitId: string, key: string): Promise<void> {
    const mode = this.registrySecurityMode();
    try {
      const registryRows = await executor.query(
        `SELECT id,organizationId,status,generation,objectType,visitId
         FROM uploaded_assets WHERE s3Key=? FOR UPDATE`,
        [key],
      );
      const verifiedRows = registryRows.filter((row: any) => row.generation === UploadedAssetGeneration.VERIFIED_V1);
      if (!verifiedRows.length) return;

      const verified = verifiedRows.find((row: any) => row.organizationId === organizationId);
      if (!verified || verified.status !== UploadedAssetStatus.ACTIVE || verified.objectType !== UploadedAssetType.PHOTO ||
          (verified.visitId && verified.visitId !== visitId)) {
        if (mode === 'ENFORCE_NEW_ONLY') {
          throw new ConflictException('La provenance commune de la photo est incompatible avec cette visite');
        }
        this.auditRegistryBinding(key, 'OBSERVE_MISMATCH_ALLOW');
        return;
      }
      if (verified.visitId === visitId) return;

      const result = await executor.query(
        `UPDATE uploaded_assets
         SET visitId=?,updatedAt=UTC_TIMESTAMP(6)
         WHERE id=? AND organizationId=? AND generation='VERIFIED_V1' AND status='ACTIVE'
           AND objectType='PHOTO' AND (visitId IS NULL OR visitId=?)`,
        [visitId, verified.id, organizationId, visitId],
      );
      if (result && typeof result.affectedRows === 'number' && result.affectedRows !== 1) {
        if (mode === 'ENFORCE_NEW_ONLY') {
          throw new ConflictException('La provenance commune de la photo a changé pendant le rattachement');
        }
        this.auditRegistryBinding(key, 'OBSERVE_BIND_CONFLICT_ALLOW');
      }
    } catch (error) {
      if (mode === 'ENFORCE_NEW_ONLY') throw error;
      this.auditRegistryBinding(key, 'OBSERVE_REGISTRY_ERROR_ALLOW');
    }
  }

  async attachInTransaction(executor: SqlExecutor, organizationId: string, visitId: string, groupId: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      const [asset] = await executor.query(
        `SELECT id,visitId,groupId,status FROM visit_photo_assets WHERE organizationId=? AND s3Key=? LIMIT 1 FOR UPDATE`,
        [organizationId, key],
      );
      if (!asset || asset.status === 'DETACHED' || (asset.visitId && (asset.visitId !== visitId || asset.groupId !== groupId))) {
        throw new ConflictException('La provenance de la photo a changé pendant le rattachement');
      }
      await this.bindVerifiedRegistryAsset(executor, organizationId, visitId, key);
      if (asset.visitId === visitId && asset.groupId === groupId && asset.status === 'ATTACHED') continue;
      await executor.query(
        `UPDATE visit_photo_assets SET visitId=?,groupId=?,status='ATTACHED',attachedAt=UTC_TIMESTAMP(6),updatedAt=UTC_TIMESTAMP(6)
         WHERE organizationId=? AND s3Key=? AND (visitId IS NULL OR (visitId=? AND groupId=?)) AND status<>'DETACHED'`,
        [visitId, groupId, organizationId, key, visitId, groupId],
      );
    }
  }

  async assertAttachedAsset(executor: SqlExecutor, organizationId: string, visitId: string, groupId: string, key: string): Promise<void> {
    const [asset] = await executor.query(
      `SELECT id FROM visit_photo_assets WHERE organizationId=? AND visitId=? AND groupId=? AND s3Key=? AND status='ATTACHED' LIMIT 1`,
      [organizationId, visitId, groupId, key],
    );
    if (!asset && await this.isLegacyVisitReference(executor, organizationId, visitId, key)) return;
    if (!asset) throw new ForbiddenException('Suppression refusée : provenance photo absente');
  }

  private async isLegacyVisitReference(executor: SqlExecutor, organizationId: string, visitId: string, key: string): Promise<boolean> {
    const [row] = await executor.query(
      `SELECT id FROM visits WHERE organizationId=? AND id=? AND JSON_SEARCH(photos,'one',CONCAT('%',?,'%')) IS NOT NULL LIMIT 1`,
      [organizationId, visitId, key],
    );
    return Boolean(row);
  }

  private registrySecurityMode(): 'OBSERVE' | 'ENFORCE_NEW_ONLY' {
    try {
      if (this.assets) return this.assets.mode();
    } catch {
      return 'OBSERVE';
    }
    const configured = String(this.config.get('ASSET_SECURITY_MODE', process.env.ASSET_SECURITY_MODE || 'OBSERVE')).trim().toUpperCase();
    return configured === 'ENFORCE_NEW_ONLY' ? 'ENFORCE_NEW_ONLY' : 'OBSERVE';
  }

  private auditRegistryBinding(key: string, decision: string): void {
    this.logger.log({
      event: 'ASSET_REGISTRY_BIND_OBSERVED',
      keyHash: createHash('sha256').update(key).digest('hex').slice(0, 16),
      decision,
    });
  }

  async detachInTransaction(executor: SqlExecutor, organizationId: string, visitId: string, groupId: string, key: string): Promise<void> {
    await executor.query(
      `UPDATE visit_photo_assets SET status='DETACHED',detachedAt=UTC_TIMESTAMP(6),updatedAt=UTC_TIMESTAMP(6)
       WHERE organizationId=? AND visitId=? AND groupId=? AND s3Key=? AND status='ATTACHED'`,
      [organizationId, visitId, groupId, key],
    );
  }

  async assertWorkerAsset(organizationId: string, visitId: string, groupId: string, key: string): Promise<void> {
    await this.assertAttachedAsset(this.db, organizationId, visitId, groupId, key);
  }

  async canPhysicallyDelete(organizationId: string, visitId: string, key: string): Promise<boolean> {
    if (!this.assets) return false;
    return this.assets.isVerifiedActiveForOrganization(organizationId, key, {
      visitId,
      objectType: UploadedAssetType.PHOTO,
    });
  }

  async assertDetachedForCleanup(organizationId: string, visitId: string, groupId: string, key: string): Promise<void> {
    const rows = await this.db.query(
      `SELECT visitId,groupId,status FROM visit_photo_assets WHERE s3Key=? LIMIT 20`,
      [key],
    );
    if (!rows.length || rows.some((row: any) => row.visitId !== visitId || row.groupId !== groupId || row.status !== 'DETACHED') ||
        !await this.canPhysicallyDelete(organizationId, visitId, key)) {
      throw new ForbiddenException('Nettoyage de photo non autorisé');
    }
  }

  async assertReceiptForDelete(user: User, url: string, receipt: string): Promise<void> {
    const key = visitPhotoKeyFromUrl(url, this.config.get('AWS_S3_BUCKET'), this.config.get('AWS_REGION'));
    this.verifyReceipt(user, key, receipt);
    const [asset] = await this.db.query(
      `SELECT id FROM visit_photo_assets WHERE organizationId=? AND uploaderId=? AND s3Key=? AND status='UPLOADED' LIMIT 1`,
      [user.organizationId, user.id, key],
    );
    if (!asset) throw new ForbiddenException('Suppression refusée : provenance photo absente');
  }
}
