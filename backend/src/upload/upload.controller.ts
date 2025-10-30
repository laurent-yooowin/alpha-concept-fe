import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  UseGuards,
  Body,
  Delete,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { User } from 'src/user/user.entity';
import { DeleteFileDto, DownloadFileDto } from './upload.dto';

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) { }

  @Post('delete')
  async deleteFileByUrl(
    @Body() deleteFileDto: DeleteFileDto,
  ) {
    const { url } = deleteFileDto;
    console.log('Received URL to delete:', url);
    return await this.uploadService.deleteFile(url);
  }

  @Post('single')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const result = await this.uploadService.uploadFile(file, 'uploads');

    return {
      success: true,
      message: 'Fichier uploadé avec succès',
      data: result,
    };
  }

  @Post('reports_file')
  @UseInterceptors(FileInterceptor('file'))
  async uploadReportsFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    return await this.uploadService.uploadFile(file, 'reports_files');
  }

  @Post('client_reports_file')
  @UseInterceptors(FileInterceptor('file'))
  async uploadClientReportsFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    return await this.uploadService.uploadFile(file, 'reports_files/client');
  }

  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultiple(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const results = await this.uploadService.uploadMultipleFiles(files, 'uploads');

    return {
      success: true,
      message: `${results.length} fichier(s) uploadé(s) avec succès`,
      data: results,
    };
  }

  @Post('visit-photos')
  @UseInterceptors(FilesInterceptor('photos', 20))
  async uploadVisitPhotos(@UploadedFiles() photos: Express.Multer.File[]) {
    if (!photos || photos.length === 0) {
      throw new BadRequestException('Aucune photo fournie');
    }

    const results = await this.uploadService.uploadMultipleFiles(photos, 'visits/photos');

    return {
      success: true,
      message: `${results.length} photo(s) uploadée(s) avec succès`,
      data: results,
    };
  }

  @Post('download')
  async downloadFile(
    @Body() downloadFileDto: DownloadFileDto,
    @Res() res: Response,
  ) {
    const { publicUrl, folder, isBase64 } = downloadFileDto;

    const result = await this.uploadService.downloadFile(
      publicUrl,
      folder,
      isBase64 || false,
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
