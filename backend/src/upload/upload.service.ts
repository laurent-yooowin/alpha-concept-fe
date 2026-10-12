import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import { User } from '../user/user.entity';
import { VisitPhotoAssetService } from './visit-photo-asset.service';
import { UploadedAssetService } from './uploaded-asset.service';
import { UploadedAssetType } from './uploaded-asset.entity';

@Injectable()
export class UploadService {
  private readonly defaultAllowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/jpg',
    'image/webp',
    'image/avif',
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  private s3Client: S3Client;
  private bucketArn = process.env.AWS_S3_ACCESS_POINT;
  private region = process.env.AWS_REGION;
  private bucketName = process.env.AWS_S3_BUCKET;
  public logger = new Logger('UploadService');

  constructor(private readonly photoAssets: VisitPhotoAssetService, private readonly assets: UploadedAssetService) {
    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async uploadVisitPhotos(files: Express.Multer.File[], user: User): Promise<Array<{ url: string; key: string; receipt: string }>> {
    if (!user?.organizationId) throw new BadRequestException('Organisation requise');
    if (!files || files.length === 0) throw new BadRequestException('Aucune photo fournie');
    const results: Array<{ url: string; key: string; receipt: string }> = [];
    for (const file of files) {
      const uploaded = await this.uploadFile(file, 'visits/photos', { user, objectType: UploadedAssetType.PHOTO, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/avif'], acceptedFormatsLabel: 'images JPEG, PNG, WebP ou AVIF' });
      const receipt = this.photoAssets.issueReceipt(user, uploaded.key);
      try {
        await this.photoAssets.registerUploadedAsset(user, uploaded.key, receipt);
      } catch (error) {
        await this.assets.markDetached(user.organizationId, uploaded.key).catch(() => undefined);
        await this.deleteFile(uploaded.url).catch(() => undefined);
        throw error;
      }
      results.push({ ...uploaded, receipt });
    }
    return results;
  }

  async assertReceiptForDelete(user: User, url: string, receipt: string): Promise<void> {
    return this.photoAssets.assertReceiptForDelete(user, url, receipt);
  }

  /** Internal cleanup after the visit command has detached an authorized photo. */
  async deleteDetachedVisitPhoto(url: string, organizationId: string, visitId: string, groupId: string): Promise<void> {
    const key = this.assets.keyFromUrl(url);
    await this.photoAssets.assertDetachedForCleanup(organizationId, visitId, groupId, key);
    await this.deleteFile(url);
    await this.assets.markDetached(organizationId, key);
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'uploads',
    options?: { allowedMimeTypes?: string[]; acceptedFormatsLabel?: string; user?: User; organizationId?: string | null; uploaderId?: string | null; objectType?: UploadedAssetType },
  ): Promise<{ url: string; key: string }> {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    // Validate file type
    const allowedMimeTypes =
      options?.allowedMimeTypes ?? this.defaultAllowedMimeTypes;

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Type de fichier non autorisé. Formats acceptés: ${
          options?.acceptedFormatsLabel ?? 'images (JPEG, PNG, WebP, AVIF), PDF, CSV, Excel'
        }`,
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 30 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('Fichier trop volumineux. Taille maximale: 10MB');
    }

    // Generate unique file key
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${uuidv4()}.${fileExtension}`;

    let uploadedToS3 = false;
    try {
      // Upload to S3 using access point ARN
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: `${fileName}`,
        Body: file.buffer,
        ContentType: file.mimetype,
        // ACL: 'public-read',
      });

      await this.s3Client.send(command);
      uploadedToS3 = true;

      // Construct public URL
      const publicUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${fileName}`;

      if (options?.organizationId || options?.user?.organizationId) {
        await this.assets.registerVerified({
          user: options.user,
          organizationId: options.organizationId || options.user!.organizationId!,
          uploaderId: options.uploaderId ?? options.user?.id ?? null,
          objectType: options.objectType || this.objectTypeForFolder(folder),
          sourceRef: 'UPLOAD',
        }, fileName);
      }

      return {
        url: publicUrl,
        key: fileName,
      };
    } catch (error) {
      let cleanupFailed = false;
      if (uploadedToS3) {
        await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: fileName }))
          .catch(() => { cleanupFailed = true; });
      }
      const errorCode = String((error as any)?.code ?? (error as any)?.name ?? 'UNKNOWN')
        .replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
      this.logger.error(`ASSET_UPLOAD_FAILED stage=${uploadedToS3 ? 'REGISTRY' : 'S3_PUT'} code=${errorCode} cleanupFailed=${cleanupFailed}`);
      throw new BadRequestException(uploadedToS3
        ? 'Échec de l’enregistrement du fichier après upload S3'
        : 'Échec de l’upload du fichier vers S3');
    }
  }

  /** Upload a server-generated document without routing it through Multer. */
  async uploadBuffer(
    buffer: Buffer,
    fileName: string,
    contentType: string,
    folder: string = 'uploads',
    options?: { metadata?: Record<string, string>; organizationId?: string | null; uploaderId?: string | null; objectType?: UploadedAssetType },
  ): Promise<{ url: string; key: string }> {
    if (!buffer?.length) {
      throw new BadRequestException('Le fichier généré est vide');
    }
    if (buffer.length > 50 * 1024 * 1024) {
      throw new BadRequestException('Fichier trop volumineux. Taille maximale: 50MB');
    }

    const extension = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'bin';
    const key = `${folder}/${uuidv4()}.${extension}`;

    let uploadedToS3 = false;
    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        Metadata: {
          originalfilename: encodeURIComponent(fileName),
          ...options?.metadata,
        },
      }));
      uploadedToS3 = true;

      if (options?.organizationId) {
        await this.assets.registerVerified({
          organizationId: options.organizationId,
          uploaderId: options.uploaderId ?? null,
          objectType: options.objectType || this.objectTypeForFolder(folder),
          sourceRef: 'SERVER_GENERATED',
        }, key);
      }

      return {
        url: `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`,
        key,
      };
    } catch (error) {
      if (uploadedToS3) await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key })).catch(() => undefined);
      this.logger.error('Erreur lors de l\'upload du document généré', error);
      throw new BadRequestException('Échec de l\'upload du fichier vers S3');
    }
  }

  private objectTypeForFolder(folder: string): UploadedAssetType {
    const normalized = String(folder || '').toLowerCase();
    if (normalized.startsWith('visits/photos')) return UploadedAssetType.PHOTO;
    if (normalized.includes('reports_files')) return UploadedAssetType.REPORT_FILE;
    return UploadedAssetType.GENERIC;
  }

  async getFileInfo(publicUrl: string): Promise<{
    key: string;
    size: number;
    contentType: string;
    fileName: string;
    metadata: Record<string, string>;
    lastModified?: Date;
  } | null> {
    if (!publicUrl) return null;
    const cleanUrl = publicUrl.split('?')[0];
    let key = cleanUrl;
    if (cleanUrl.includes('.amazonaws.com/')) {
      key = cleanUrl.split('.amazonaws.com/')[1];
    }
    try {
      key = decodeURIComponent(key);
    } catch {}
    if (!key) return null;

    try {
      const response = await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
      const metadata = response.Metadata || {};
      let fileName = key.split('/').pop() || 'download';
      const encodedName = metadata.originalfilename || response.ContentDisposition
        ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      if (encodedName) {
        try {
          fileName = decodeURIComponent(encodedName);
        } catch {}
      }
      return {
        key,
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        fileName,
        metadata,
        lastModified: response.LastModified,
      };
    } catch (error: any) {
      if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw new BadRequestException('Impossible de vérifier le fichier dans S3');
    }
  }

  async deleteFile(url: string, options?: { user?: User; visitId?: string; groupId?: string; executor?: { query(sql: string, parameters?: any[]): Promise<any[]> } }): Promise<{ fileName: string; message: string }> {
    if (!url || url.trim() === '' || !url.includes(`https://${this.bucketName}.s3.${this.region}.amazonaws.com/`)) {
      throw new BadRequestException('Aucune url fourni');
    }

    // Validate file type
    // const allowedMimeTypes = [
    //   'image/jpeg',
    //   'image/png',
    //   'image/jpg',
    //   'image/webp',
    //   'image/avif',
    //   'application/pdf',
    //   'text/csv',
    //   'application/vnd.ms-excel',
    //   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // ];

    // if (!allowedMimeTypes.includes(file.mimetype)) {
    //   throw new BadRequestException('Type de fichier non autorisé. Formats acceptés: images (JPEG, PNG, WebP, AVIF), PDF, CSV, Excel');
    // }

    // Validate file size (max 10MB)
    // const maxSize = 10 * 1024 * 1024; // 10MB
    // if (file.size > maxSize) {
    //   throw new BadRequestException('Fichier trop volumineux. Taille maximale: 10MB');
    // }

    // Generate unique file key
    // const fileExtension = file.originalname.split('.').pop();
    const cleanUrl = String(url || '').includes('://') ? String(url).split('?')[0] : url;
    const fileName = this.assets.keyFromUrl(cleanUrl);

    if (options?.user) await this.assets.assertDeleteAccess(options.user, fileName, {
      visitId: options.visitId,
      groupId: options.groupId,
    });

    if (options?.user && options.visitId && options.groupId) {
      if (options.executor) {
        await this.photoAssets.assertAttachedAsset(options.executor, options.user.organizationId, options.visitId, options.groupId, fileName);
      } else {
        await this.photoAssets.assertWorkerAsset(options.user.organizationId, options.visitId, options.groupId, fileName);
      }
    }

    try {
      // Upload to S3 using access point ARN
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
      });

      await this.s3Client.send(command);
      if (options?.user) await this.assets.markDetached(options.user.organizationId, fileName);

      return {
        fileName: fileName,
        message: 'Fichier supprimé avec succès',
      };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      console.error('Erreur lors du delete du fichier dans S3: ', error);
      throw new BadRequestException('Erreur lors du delete du fichier dans S3 !');
    }
  }

  async uploadMultipleFiles(files: Express.Multer.File[], folder: string = 'uploads'): Promise<Array<{ url: string; key: string }>> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const uploadPromises = files.map(file => this.uploadFile(file, folder));
    return Promise.all(uploadPromises);
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      console.error('Erreur lors de la génération de l\'URL signée:', error);
      throw new BadRequestException('Impossible de générer l\'URL signée');
    }
  }

  async downloadFile(publicUrl: string, folder: string, isBase64: boolean = false, user?: User, context?: { visitId?: string; reportId?: string; objectType?: UploadedAssetType }): Promise<{ data: string | Buffer; contentType: string; fileName: string }> {
    try {
      // Signed URLs are used for organization logos. Strip only their query
      // string, then let the registry service validate the trusted S3 host and
      // normalize the key; arbitrary .amazonaws.com hosts are not accepted.
      const cleanUrl = String(publicUrl || '').includes('://')
        ? String(publicUrl).split('?')[0]
        : publicUrl;
      const key = this.assets.keyFromUrl(cleanUrl);

      this.logger.debug('Derived S3 key for download');

      if (!key) {
        throw new BadRequestException('URL ou clé de fichier invalide');
      }

      if (user) await this.assets.assertDownloadAccess(user, key, context);

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new BadRequestException('Fichier introuvable');
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const contentType = response.ContentType || 'application/octet-stream';
      let fileName = key.split('/').pop() || 'download';
      const encodedMetadataName = response.Metadata?.originalfilename;
      const encodedDispositionName = response.ContentDisposition
        ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const quotedDispositionName = response.ContentDisposition
        ?.match(/filename="?([^";]+)"?/i)?.[1];

      try {
        const encodedName = encodedMetadataName || encodedDispositionName;
        if (encodedName) {
          fileName = decodeURIComponent(encodedName);
        } else if (quotedDispositionName) {
          fileName = quotedDispositionName;
        }
      } catch {}

      if (isBase64) {
        const base64Data = buffer.toString('base64');
        return {
          data: base64Data,
          contentType,
          fileName,
        };
      }

      return {
        data: buffer,
        contentType,
        fileName,
      };
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      console.error('Erreur lors du téléchargement du fichier depuis S3:', error);
      throw new BadRequestException('Impossible de télécharger le fichier depuis S3');
    }
  }

  async downloadStreamFile(publicUrl: string, user?: User, context?: { visitId?: string; reportId?: string; objectType?: UploadedAssetType }): Promise<Readable> {
    try {
      const cleanUrl = String(publicUrl || '').includes('://')
        ? String(publicUrl).split('?')[0]
        : publicUrl;
      const key = this.assets.keyFromUrl(cleanUrl);
      this.logger.debug('Derived S3 key for stream download');

      if (!key) {
        throw new BadRequestException('URL ou clé de fichier invalide');
      }
      if (user) await this.assets.assertDownloadAccess(user, key, context);

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new BadRequestException('Fichier introuvable');
      }
      return response.Body as Readable;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      console.error('Erreur lors du téléchargement du fichier depuis S3:', error);
      throw new BadRequestException('Impossible de télécharger le fichier depuis S3');
    }
  }
}
