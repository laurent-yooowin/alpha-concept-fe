import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) { }

  async sendPdfReport(to: string, subject: string, text: string, pdfBuffer: Buffer, pdfName: string) {
    try {
      await this.mailerService.sendMail({
        to,
        subject,
        text,
        attachments: [
          {
            filename: pdfName,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
      return { success: true, message: 'Email envoyé avec succès.' };
    } catch (error) {
      console.error('Erreur envoi mail:', error);
      throw new Error('Échec de l’envoi de l’email');
    }
  }
}
