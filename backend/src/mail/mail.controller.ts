import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { MailService } from './mail.service';
import * as fs from 'fs';
import { UploadService } from '../upload/upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import { User } from '../user/user.entity';
import { MailingListService } from '../mailing-list/mailing-list.service';
import { UploadedAssetService } from '../upload/uploaded-asset.service';

@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(
    private readonly mailService: MailService,
    private readonly uploadService: UploadService,
    private readonly mailingListService: MailingListService,
    private readonly uploadedAssetService: UploadedAssetService,
  ) { }

  private readonly logger = new Logger(MailController.name);

  @Post('send-report')
  @RequirePermission('reports', 'write')
  async sendReport(
    @CurrentUser() user: User,
    @Body() body: { email: string; subject: string; message: string; pdfContent?: string; pdfUrl?: string; reportId?: string; isHtmlContent?: boolean; fileName: string; missionId?: string; cc?: string[] },
  ) {
    const { email, subject, message, pdfUrl, isHtmlContent, fileName } = body;
    const hasExplicitCc = Array.isArray(body.cc);
    const orgCc = hasExplicitCc ? [] : await this.mailingListService.getCcEmailsForOrg(user?.organizationId, body.missionId);
    const extraCc = hasExplicitCc ? (body.cc || []) : [];
    const cc = Array.from(new Set([...orgCc, ...extraCc].filter((e) => e && e !== email)));
    if (pdfUrl) {
      await this.uploadedAssetService.assertReportAccess(user, pdfUrl, body.reportId);
      const pdfBuffer = await this.uploadService.downloadStreamFile(pdfUrl, user, {
        reportId: body.reportId,
      });
      return await this.mailService.sendPdfReport(email, subject, message, pdfBuffer, fileName || 'rapport.pdf', cc);

    } else if (body.pdfContent) {
      let pdfBuffer = null;
      if (body.isHtmlContent) {
        pdfBuffer = await this.mailService.generatePdfBuffer(body.pdfContent);
      } else {
        pdfBuffer = Buffer.from(body.pdfContent, 'base64');
      }
      return await this.mailService.sendPdfReport(email, subject, message, pdfBuffer, fileName || 'rapport.pdf', cc);

    } else {
      throw new Error('Aucun contenu PDF fourni');
    }
  }
}
