import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Report } from './report.entity';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { MissionService } from '../missions/mission.service';
import { MissionModule } from '../missions/mission.module';
import { UploadModule } from '../upload/upload.module';
import { ReportPdfTemplateService } from './report-pdf-template.service';
import { MailModule } from '../mail/mail.module';
import { PreventionQueueModule } from '../prevention/queue/prevention-queue.module';

@Module({
  imports: [
    forwardRef(() => MissionModule),
    UploadModule,
    MailModule,
    TypeOrmModule.forFeature([Report]),
    PreventionQueueModule.register(),
  ],
  controllers: [ReportController],
  providers: [ReportService, ReportPdfTemplateService],
  exports: [ReportService],

})
export class ReportModule { }
