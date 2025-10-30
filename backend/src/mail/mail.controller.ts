import { Controller, Post, Body } from '@nestjs/common';
import { MailService } from './mail.service';
import * as fs from 'fs';

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) { }

  @Post('send-report')
  async sendReport(@Body() body: { email: string; subject: string; message: string; pdfUrl: string }) {
    const { email, subject, message, pdfUrl } = body;

    // 1️⃣ Télécharger le PDF depuis S3 ou URL
    const res = await fetch(pdfUrl);
    const arrayBuffer = await res.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // 2️⃣ Envoyer le mail
    return await this.mailService.sendPdfReport(email, subject, message, pdfBuffer, 'rapport.pdf');
  }
}
