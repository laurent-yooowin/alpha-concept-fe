import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';
import { VisitPhotoAssetService } from '../../upload/visit-photo-asset.service';
import { UploadedAssetService } from '../../upload/uploaded-asset.service';
import { UploadedAssetType } from '../../upload/uploaded-asset.entity';

const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_PHOTO_DOWNLOAD_MS = 15_000;
const MAX_GROUP_DOWNLOAD_MS = 90_000;

export interface PreventionDownloadedPhoto {
  contentType: string;
  base64: string;
}

function matchesImageSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (contentType === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (contentType === 'image/avif') return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' &&
    ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12));
  return false;
}

@Injectable()
export class PreventionPhotoDownloadService {
  private readonly s3: S3Client;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    @Optional() private readonly photoAssets?: VisitPhotoAssetService,
    @Optional() private readonly assets?: UploadedAssetService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async downloadGroup(organizationId: string, visitId: string, sourceGroupId: string): Promise<PreventionDownloadedPhoto[]> {
    const [visit] = await this.db.query(
      'SELECT photos FROM visits WHERE organizationId=? AND id=? LIMIT 1',
      [organizationId, visitId],
    );
    if (!visit) throw new BadRequestException('Prevention visit not found');
    let entries: unknown = visit.photos;
    if (typeof entries === 'string') {
      try { entries = JSON.parse(entries); } catch { throw new BadRequestException('Invalid stored visit photos'); }
    }
    if (!Array.isArray(entries)) throw new BadRequestException('Invalid stored visit photos');
    const group = entries.filter((entry: any, index: number) => entry && typeof entry === 'object' &&
      !Array.isArray(entry) && (entry.groupId || entry.id || `entry-${index}`) === sourceGroupId && entry.isDirectiveOnly !== true);
    if (group.length > MAX_PHOTOS) throw new BadRequestException('Too many Prevention group photos');

    const bucket = this.config.get<string>('AWS_S3_BUCKET');
    const region = this.config.get<string>('AWS_REGION');
    if (!bucket || !region) throw new Error('Prevention photo bucket is not configured');
    const result: PreventionDownloadedPhoto[] = [];
    let totalBytes = 0;
    let groupExpired = false;
    let activeController: AbortController | null = null;
    let activeBody: { destroy?: () => void } | null = null;
    const groupTimeout = setTimeout(() => {
      groupExpired = true;
      activeController?.abort();
      activeBody?.destroy?.();
    }, MAX_GROUP_DOWNLOAD_MS);
    try {
    for (const entry of group) {
      if (groupExpired) throw new Error('Prevention group photo download timed out');
      if (typeof entry.s3Url !== 'string' || !entry.s3Url) throw new BadRequestException('Missing persisted visit photo URL');
      let url: URL;
      try { url = new URL(entry.s3Url); } catch { throw new BadRequestException('Invalid persisted visit photo URL'); }
      let key: string;
      try { key = decodeURIComponent(url.pathname.slice(1)); }
      catch { throw new BadRequestException('Invalid persisted visit photo URL'); }
      if (url.protocol !== 'https:' || url.hostname !== `${bucket}.s3.${region}.amazonaws.com` ||
        url.search || url.hash || url.port || !/^visits\/photos\/[0-9a-f-]{36}\.(?:jpe?g|jfif|png|webp|avif)$/i.test(key)) {
        throw new BadRequestException('Photo is outside the configured visit photo bucket');
      }
      // The worker has no HTTP user context. Check the tenant-bound registry
      // before consulting legacy provenance or touching S3.
      if (this.assets) await this.assets.assertWorkerAccess(organizationId, key, 'PREVENTION_WORKER_PHOTO_DOWNLOAD', {
        visitId,
        objectType: UploadedAssetType.PHOTO,
      });
      if (this.photoAssets) await this.photoAssets.assertWorkerAsset(organizationId, visitId, sourceGroupId, key);
      const controller = new AbortController();
      activeController = controller;
      const photoTimeout = setTimeout(() => {
        controller.abort();
        activeBody?.destroy?.();
      }, MAX_PHOTO_DOWNLOAD_MS);
      try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: controller.signal });
      activeBody = (response.Body as { destroy?: () => void } | undefined) ?? null;
      const contentType = response.ContentType ?? '';
      const remaining = MAX_TOTAL_BYTES - totalBytes;
      const limit = Math.min(MAX_PHOTO_BYTES, remaining);
      if (!/^image\/(?:jpeg|png|webp|avif)$/i.test(contentType) || !response.Body ||
        (response.ContentLength !== undefined && response.ContentLength > limit)) {
        (response.Body as { destroy?: () => void } | undefined)?.destroy?.();
        throw new BadRequestException('Invalid or oversized Prevention visit photo');
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
          bytes += chunk.length;
          if (bytes > limit) throw new BadRequestException('Prevention photo byte limit exceeded');
          chunks.push(Buffer.from(chunk));
        }
      } catch (error) {
        (response.Body as { destroy?: () => void }).destroy?.();
        throw error;
      }
      const contents = Buffer.concat(chunks, bytes);
      if (groupExpired || controller.signal.aborted) throw new Error('Prevention photo download timed out');
      if (!matchesImageSignature(contents, contentType.toLowerCase())) {
        throw new BadRequestException('Prevention visit photo does not match its image type');
      }
      totalBytes += bytes;
      result.push({ contentType, base64: contents.toString('base64') });
      } finally {
        clearTimeout(photoTimeout);
        activeBody = null;
        activeController = null;
      }
    }
    } finally {
      clearTimeout(groupTimeout);
    }
    return result;
  }
}
