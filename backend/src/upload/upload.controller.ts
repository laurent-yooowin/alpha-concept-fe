import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  Body,
  Delete,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../user/user.entity';
// import { User } from 'src/user/user.entity';
import { DeleteFileDto, DownloadFileDto } from './upload.dto';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import { UploadedAssetType } from './uploaded-asset.entity';
import { effectivePermission } from '../common/guards/permissions.guard';
import { levelMeets } from '../common/permissions/permissions.types';

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) { }

  public logger = new Logger(UploadController.name);

  @Post('delete')
  async deleteFileByUrl(
    @CurrentUser() user: User,
    @Body() deleteFileDto: DeleteFileDto,
  ) {
    const { url, receipt } = deleteFileDto;
    // Whitelist of allowed prefixes — prevents arbitrary cross-tenant deletions
    // (e.g. organization logos must only be removed via the org service).
    const allowedPrefixes = ['uploads/', 'visits/photos/', 'reports_files/'];
    const key = url?.split('.com/')[1] || '';
    const permissionModule: 'visits' | 'reports' = key.startsWith('visits/photos/') ? 'visits' : 'reports';
    if (!levelMeets(effectivePermission(user, permissionModule), 'write')) {
      throw new ForbiddenException('Permission insuffisante pour supprimer cet objet');
    }
    if (!allowedPrefixes.some(p => key.startsWith(p))) {
      this.logger.warn('Blocked delete attempt outside whitelist');
      throw new BadRequestException('Suppression non autorisée pour ce chemin');
    }
    if (key.startsWith('visits/photos/')) {
      if (!receipt) throw new BadRequestException('Un reçu signé est requis pour supprimer une photo de visite');
      await this.uploadService.assertReceiptForDelete(user, url, receipt);
    }
    this.logger.log('Received authorized delete request');
    return await this.uploadService.deleteFile(url, { user });
  }

  @Post('single')
  @RequirePermission('reports', 'write')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const result = await this.uploadService.uploadFile(file, 'uploads', { user, objectType: UploadedAssetType.GENERIC });

    return {
      success: true,
      message: 'Fichier uploadé avec succès',
      data: result,
    };
  }

  @Post("reports_file")
  @RequirePermission('reports', 'write')
  @UseInterceptors(FileInterceptor("file", {
    limits: { fileSize: 30 * 1024 * 1024 },
  }))
  async uploadReportsFile(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("Aucun fichier fourni");
    }

    this.logger.log({
      event: "report_file_upload_received",
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    } as any);

    return await this.uploadService.uploadFile(file, "reports_files", { user, objectType: UploadedAssetType.REPORT_FILE });
  }

  @Post('client_reports_file')
  @RequirePermission('reports', 'write')
  @UseInterceptors(FileInterceptor('file'))
  async uploadClientReportsFile(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    return await this.uploadService.uploadFile(file, 'reports_files/client', { user, objectType: UploadedAssetType.REPORT_FILE });
  }

  @Post('multiple')
  @RequirePermission('reports', 'write')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultiple(@CurrentUser() user: User, @UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const results = await Promise.all(files.map((file) => this.uploadService.uploadFile(file, 'uploads', { user, objectType: UploadedAssetType.GENERIC })));

    return {
      success: true,
      message: `${results.length} fichier(s) uploadé(s) avec succès`,
      data: results,
    };
  }

  @Post('visit-photos')
  @RequirePermission('visits', 'write')
  @UseInterceptors(FilesInterceptor('photos', 20))
  async uploadVisitPhotos(@CurrentUser() user: User, @UploadedFiles() photos: Express.Multer.File[]) {
    if (!photos || photos.length === 0) {
      throw new BadRequestException('Aucune photo fournie');
    }

    const results = await this.uploadService.uploadVisitPhotos(photos, user);

    return {
      success: true,
      message: `${results.length} photo(s) uploadée(s) avec succès`,
      data: results,
    };
  }

  @Post('report-pdf')
  @RequirePermission('reports', 'write')
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB
    },
  }))
  async uploadVReportPdf(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File) {

    if (!file) {
      throw new BadRequestException('Aucun pdf fournie');
    }

    return await this.uploadService.uploadFile(file, 'reports_files/client', { user, objectType: UploadedAssetType.REPORT_PDF });
  }

  @Post('download')
  async downloadFile(
    @CurrentUser() user: User,
    @Body() downloadFileDto: DownloadFileDto,
    @Res() res: Response,
  ) {
    const { publicUrl, folder, isBase64 } = downloadFileDto;
    const downloadKey = publicUrl?.split('.com/')[1] || publicUrl || '';
    const permissionModule: 'visits' | 'reports' = downloadKey.startsWith('visits/photos/') ? 'visits' : 'reports';
    if (!levelMeets(effectivePermission(user, permissionModule), 'read')) {
      throw new ForbiddenException('Permission insuffisante pour télécharger cet objet');
    }
    this.logger.debug(downloadFileDto);
    const result = await this.uploadService.downloadFile(
      publicUrl,
      folder,
      isBase64 || false,
      user,
    );

    if (isBase64) {
      return res.status(HttpStatus.OK).json({
        success: true,
        message: 'Fichier téléchargé avec succès',
        data: {
          base64: result.data,
          contentType: result.contentType,
          fileName: result.fileName,
        },
      });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.send(result.data);
  }
}
