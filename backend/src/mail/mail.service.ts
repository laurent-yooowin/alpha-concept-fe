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
  async sendOtpCode(to: string, code: string, firstName?: string) {
    try {
      const name = firstName || 'Utilisateur';
      await this.mailerService.sendMail({
        to,
        subject: 'Code de vérification - Report BTP',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1E40AF; margin: 0;">Report BTP</h1>
            </div>
            <h2 style="color: #1E293B;">Bonjour ${name},</h2>
            <p style="color: #475569; font-size: 16px;">
              Vous avez demandé la réinitialisation de votre mot de passe. Voici votre code de vérification :
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <div style="display: inline-block; background: linear-gradient(135deg, #3B82F6, #1D4ED8); color: white; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 16px 32px; border-radius: 12px;">
                ${code}
              </div>
            </div>
            <p style="color: #475569; font-size: 14px;">
              Ce code est valide pendant <strong>15 minutes</strong>.
            </p>
            <p style="color: #94A3B8; font-size: 12px; margin-top: 30px;">
              Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.
            </p>
          </div>
        `,
      });
      return { success: true };
    } catch (error) {
      this.logger.error('Erreur envoi OTP:', error);
      throw new Error('Échec de l\'envoi du code de vérification');
    }
  }

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
