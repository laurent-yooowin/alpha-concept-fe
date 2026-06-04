import { Injectable, Logger } from '@nestjs/common';
import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import * as puppeteer from 'puppeteer';
import { Readable } from 'stream';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) { }

  private readonly logger = new Logger(MailService.name);

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private legalAttachments(cguContent?: string | null, privacyContent?: string | null) {
    const attachments: ISendMailOptions['attachments'] = [];
    if (cguContent?.trim()) {
      attachments.push({
        filename: 'CGU.md',
        content: cguContent,
        contentType: 'text/markdown; charset=utf-8',
      });
    }
    if (privacyContent?.trim()) {
      attachments.push({
        filename: 'Politique-confidentialite.md',
        content: privacyContent,
        contentType: 'text/markdown; charset=utf-8',
      });
    }
    return attachments;
  }

  async sendLegalValidationRequest(params: {
    to: string;
    organizationName: string;
    loginUrl: string;
    adminEmail: string;
    temporaryPassword?: string;
    cguContent?: string | null;
    privacyContent?: string | null;
  }) {
    const attachments = this.legalAttachments(params.cguContent, params.privacyContent);
    const missingDocs = [
      params.cguContent?.trim() ? null : 'CGU',
      params.privacyContent?.trim() ? null : 'politique de confidentialité',
    ].filter(Boolean);
    const missingDocsMessage = missingDocs.length
      ? `
          <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:10px; padding:14px 16px; margin:18px 0;">
            <p style="margin:0; color:#92400e;">
              <strong>Document(s) à compléter : ${missingDocs.join(', ')}.</strong><br />
              Ces éléments devront être renseignés depuis le portail avant validation définitive.
            </p>
          </div>
        `
      : `
          <p style="color:#475569; font-size:15px; line-height:1.6;">
            Les documents actuellement configurés sont joints à ce message. Vous pourrez les relire, les ajuster si nécessaire,
            puis les valider depuis votre portail.
          </p>
        `;

    await this.mailerService.sendMail({
      to: params.to,
      subject: `Action requise - Validation des documents légaux ${params.organizationName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1e293b;">
          <div style="border-bottom:1px solid #e2e8f0; padding-bottom:18px; margin-bottom:22px;">
            <h1 style="color:#1e40af; margin:0; font-size:24px;">ReportBTP</h1>
            <p style="margin:6px 0 0; color:#64748b; font-size:14px;">Validation des documents légaux</p>
          </div>

          <p style="color:#1e293b; font-size:16px; line-height:1.6;">Bonjour,</p>
          <p style="color:#475569; font-size:15px; line-height:1.6;">
            Le portail de l'organisation <strong>${this.escapeHtml(params.organizationName)}</strong> a été préparé dans ReportBTP.
            Afin de finaliser sa mise en service, une validation des Conditions Générales d'Utilisation et de la politique de
            confidentialité est requise.
          </p>
          ${missingDocsMessage}

          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:18px; margin:22px 0;">
            <p style="margin:0 0 12px; color:#334155; font-size:15px;"><strong>Accès au portail</strong></p>
            <p style="margin:0 0 8px; color:#475569; font-size:14px;"><strong>Identifiant :</strong> ${this.escapeHtml(params.adminEmail)}</p>
            ${params.temporaryPassword ? `<p style="margin:0 0 8px; color:#475569; font-size:14px;"><strong>Mot de passe temporaire :</strong> ${this.escapeHtml(params.temporaryPassword)}</p>` : ''}
            <p style="margin:14px 0 0;">
              <a href="${params.loginUrl}" style="display:inline-block; background:#1e40af; color:#ffffff; text-decoration:none; padding:11px 16px; border-radius:8px; font-weight:bold;">
                Accéder au portail
              </a>
            </p>
            <p style="margin:12px 0 0; color:#64748b; font-size:12px;">
              Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br />
              <a href="${params.loginUrl}" style="color:#1e40af;">${params.loginUrl}</a>
            </p>
          </div>

          <p style="color:#475569; font-size:15px; line-height:1.6;">
            Après authentification, une fenêtre de validation s'affichera automatiquement. Vous devrez relire les documents,
            compléter les éventuelles informations manquantes, puis cliquer sur <strong>Valider</strong>.
          </p>
          <p style="color:#64748b; font-size:13px; line-height:1.5; margin-top:24px;">
            Cet email est généré automatiquement par ReportBTP. Pour toute question, veuillez contacter votre interlocuteur ReportBTP.
          </p>
        </div>
      `,
      attachments,
    });
  }

  async sendLegalValidationConfirmation(params: {
    to: string[];
    organizationName: string;
    cguContent: string;
    privacyContent: string;
  }) {
    const recipients = Array.from(new Set(params.to.filter(Boolean)));
    if (recipients.length === 0) return { success: true };

    await this.mailerService.sendMail({
      to: recipients,
      subject: `Confirmation - Documents légaux validés ${params.organizationName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1e293b;">
          <div style="border-bottom:1px solid #e2e8f0; padding-bottom:18px; margin-bottom:22px;">
            <h1 style="color:#1e40af; margin:0; font-size:24px;">ReportBTP</h1>
            <p style="margin:6px 0 0; color:#64748b; font-size:14px;">Confirmation de validation</p>
          </div>

          <p style="color:#1e293b; font-size:16px; line-height:1.6;">Bonjour,</p>
          <p style="color:#475569; font-size:15px; line-height:1.6;">
            Les Conditions Générales d'Utilisation et la politique de confidentialité de
            <strong>${this.escapeHtml(params.organizationName)}</strong> ont été validées avec succès.
          </p>
          <div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:10px; padding:14px 16px; margin:18px 0;">
            <p style="margin:0; color:#047857; font-size:15px;">
              Le statut de validation de l'organisation est désormais <strong>terminé</strong>.
            </p>
          </div>
          <p style="color:#475569; font-size:15px; line-height:1.6;">
            Les versions validées sont jointes à ce message pour archivage et suivi.
          </p>
          <p style="color:#64748b; font-size:13px; line-height:1.5; margin-top:24px;">
            Cet email est généré automatiquement par ReportBTP.
          </p>
        </div>
      `,
      attachments: this.legalAttachments(params.cguContent, params.privacyContent),
    });

    return { success: true };
  }

  async sendPdfReport(to: string, subject: string, text: string, pdfBuffer: Readable, pdfName: string, cc?: string[]) {
    try {
      let options: ISendMailOptions = {
        to,
        cc: cc && cc.length ? cc : undefined,
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
