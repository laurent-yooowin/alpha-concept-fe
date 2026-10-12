import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { memoryStorage } from 'multer';
import { VisitPhotoAssetService } from './visit-photo-asset.service';
import { UploadedAssetService } from './uploaded-asset.service';
import { LegacyAssetBackfillService } from './legacy-asset-backfill.service';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 20,
      },
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, VisitPhotoAssetService, UploadedAssetService, LegacyAssetBackfillService],
  exports: [UploadService, VisitPhotoAssetService, UploadedAssetService, LegacyAssetBackfillService],
})
export class UploadModule {}
