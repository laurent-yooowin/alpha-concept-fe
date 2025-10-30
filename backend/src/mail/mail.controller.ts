import { Controller, Post, Body, Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import * as fs from 'fs';
import { UploadService } from '../upload/upload.service';
// import { uploadService } from '@/services/uploadService';

@Controller('mail')
export class MailController {
  constructor(
    private readonly mailService: MailService,
    private readonly uploadService: UploadService,
  ) { }

  private readonly logger = new Logger(MailController.name);

  @Post('send-report')
  async sendReport(@Body() body: { email: string; subject: string; message: string; pdfContent?: string; pdfUrl?: string; isHtmlContent?: boolean; fileName: string }) {
    const { email, subject, message, pdfUrl, isHtmlContent, fileName } = body;
    if (pdfUrl) {
      // 1️⃣ Télécharger le PDF depuis S3 ou URL
      // const res = await fetch(pdfUrl);
      // const arrayBuffer = await res.arrayBuffer();
      // const pdfBuffer = Buffer.from(arrayBuffer);
      const pdfBuffer = await this.uploadService.downloadStreamFile(pdfUrl);
      this.logger.log('Downloaded PDF buffer size:', pdfBuffer?.length);
      // 2️⃣ Envoyer le mail
      return await this.mailService.sendPdfReport(email, subject, message, pdfBuffer, fileName || 'rapport.pdf');

    } else if (body.pdfContent) {
      let pdfBuffer = null;
      if (body.isHtmlContent) {
        pdfBuffer = await this.mailService.generatePdfBuffer(body.pdfContent);
      } else {
        // Décoder le contenu base64
        pdfBuffer = Buffer.from(body.pdfContent, 'base64');
      }
      // Envoyer le mail
      return await this.mailService.sendPdfReport(email, subject, message, pdfBuffer, fileName || 'rapport.pdf');

    } else {
      throw new Error('Aucun contenu PDF fourni');
    }
  }
}
