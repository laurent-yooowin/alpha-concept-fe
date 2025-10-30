import { Injectable, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  private s3Client: S3Client;
  private bucketArn = process.env.AWS_S3_ACCESS_POINT;
  private region = process.env.AWS_REGION;
  private bucketName = process.env.AWS_S3_BUCKET;

  constructor() {
    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'uploads'): Promise<{ url: string; key: string }> {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    // Validate file type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'image/webp',
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Type de fichier non autorisé. Formats acceptés: images (JPEG, PNG, WebP), PDF, CSV, Excel');
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('Fichier trop volumineux. Taille maximale: 10MB');
    }

    // Generate unique file key
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${uuidv4()}.${fileExtension}`;

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

      // Construct public URL
      const publicUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${fileName}`;

      return {
        url: publicUrl,
        key: fileName,
      };
    } catch (error) {
      console.error('Erreur lors de l\'upload S3:', error);
      throw new BadRequestException('Échec de l\'upload du fichier vers S3');
    }
  }

  async deleteFile(url: string): Promise<{ fileName: string; message: string }> {
    if (!url || url.trim() === '' || !url.includes(`https://${this.bucketName}.s3.${this.region}.amazonaws.com/`)) {
      throw new BadRequestException('Aucune url fourni');
    }

    // Validate file type
    // const allowedMimeTypes = [
    //   'image/jpeg',
    //   'image/png',
    //   'image/jpg',
    //   'image/webp',
    //   'application/pdf',
    //   'text/csv',
    //   'application/vnd.ms-excel',
    //   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // ];

    // if (!allowedMimeTypes.includes(file.mimetype)) {
    //   throw new BadRequestException('Type de fichier non autorisé. Formats acceptés: images (JPEG, PNG, WebP), PDF, CSV, Excel');
    // }

    // Validate file size (max 10MB)
    // const maxSize = 10 * 1024 * 1024; // 10MB
    // if (file.size > maxSize) {
    //   throw new BadRequestException('Fichier trop volumineux. Taille maximale: 10MB');
    // }

    // Generate unique file key
    // const fileExtension = file.originalname.split('.').pop();
    const fileName = url.split('.com/')[1];
    if(!fileName){
      throw new BadRequestException('URL invalide');
    }

    try {
      // Upload to S3 using access point ARN
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
      });

      await this.s3Client.send(command);      

      return {
        fileName: fileName,  
        message: 'Fichier supprimé avec succès',
      };
    } catch (error) {
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

  async downloadFile(publicUrl: string, folder: string, isBase64: boolean = false): Promise<{ data: string | Buffer; contentType: string; fileName: string }> {
    try {
      let key: string;

      if (publicUrl.includes(`https://${this.bucketName}.s3.${this.region}.amazonaws.com/`)) {
        key = publicUrl.split('.com/')[1];
      } else {
        key = `${folder}/${publicUrl}`;
      }

      if (!key) {
        throw new BadRequestException('URL ou clé de fichier invalide');
      }

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
      const fileName = key.split('/').pop() || 'download';

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
      console.error('Erreur lors du téléchargement du fichier depuis S3:', error);
      throw new BadRequestException('Impossible de télécharger le fichier depuis S3');
    }
  }
}
