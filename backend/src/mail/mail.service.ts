import { Injectable, Logger } from '@nestjs/common';
import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import * as puppeteer from 'puppeteer';
import { Readable } from 'stream';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) { }

  private readonly logger = new Logger(MailService.name);

  async sendPdfReport(to: string, subject: string, text: string, pdfBuffer: Readable, pdfName: string) {
    try {
      let options: ISendMailOptions = {
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
      };

      // if (from && from.trim() != '') {
      //   options.from = from;
      //   options.sender = from;
      // }

      await this.mailerService.sendMail(options);
      return { success: true, message: 'Email envoyé avec succès.' };
    } catch (error) {
      console.error('Erreur envoi mail:', error);
      throw new Error('Échec de l’envoi de l’email');
    }
  }

  /**
   * Génère un PDF à partir de HTML et retourne un Buffer
   */
  async generatePdfBuffer(htmlContent: string): Promise<Uint8Array<ArrayBufferLike>> {
    try {
      const browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();

      // Charger le HTML
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      // Générer le PDF
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });

      await browser.close();
      return pdfBuffer;
    } catch (error) {
      this.logger.error('Erreur lors de la génération du PDF', error);
      throw new Error('Échec de la génération du PDF');
    }
  }
}
