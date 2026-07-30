import { BadRequestException, Injectable } from '@nestjs/common';
import { Report } from './report.entity';
import { UploadService } from '../upload/upload.service';
import { MailService } from '../mail/mail.service';
import { createHash } from 'crypto';

export const REPORT_PDF_TEMPLATE_VERSION = 'backend-v4-first-page-margin';

@Injectable()
export class ReportPdfTemplateService {
  constructor(
    private readonly uploadService: UploadService,
    private readonly mailService: MailService,
  ) {}
  private slug(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    if (!text || ['null', 'undefined'].includes(text.toLowerCase())) return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private buildDefaultFileName(report: Report): string {
    const mission: any = report.mission || {};
    const visit: any = report.visit || {};
    const rawType = this.slug(mission.reportType || mission.type);
    const reportType = rawType.includes('reunion') ? 'reunion' : 'vc';

    const explicitCity = String(mission.city || '').trim();
    const address = String(mission.address || '').trim();
    const addressParts = address.split(',').map((part) => part.trim()).filter(Boolean);
    let citySource = explicitCity;
    if (!citySource && addressParts.length > 1) {
      citySource = addressParts.at(-1) || '';
    } else if (!citySource) {
      citySource = address.match(/\b\d{5}\s+([^,]+)$/)?.[1]?.trim() || '';
    }

    const visitDate = visit.visitDate || visit.createdAt || report.createdAt;
    const dateParts: string[] = [];
    if (visitDate) {
      const date = new Date(visitDate);
      if (!Number.isNaN(date.getTime())) {
        dateParts.push(
          String(date.getDate()).padStart(2, '0'),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getFullYear()),
        );
      }
    }

    const parts = [
      'CR',
      reportType,
      this.slug(mission.client),
      this.slug(citySource.replace(/\b\d{5}\b/g, ' ')),
      this.slug(mission.title),
      ...dateParts,
    ];
    return `${parts.filter(Boolean).join('_')}.pdf`;
  }
  private normalizeFileName(requestedFileName: string | undefined, report: Report): string {
    const safeBaseName = (requestedFileName || this.buildDefaultFileName(report))
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u0000-\u001f]/g, '')
      .trim() || 'rapport';
    return `${safeBaseName}.pdf`;
  }

  private resolveOrganization(report: Report): any {
    const mission: any = report.mission || {};
    const visit: any = report.visit || {};
    const organizationId = visit.organizationId || report.organizationId || mission.organizationId;
    const organizations = [
      visit.organization,
      report.organization,
      mission.organization,
    ].filter(Boolean);

    if (organizationId) {
      return organizations.find((organization) => organization.id === organizationId) || {};
    }

    return organizations[0] || {};
  }

  private sourceHash(report: Report): string {
    const mission: any = report.mission || {};
    const visit: any = report.visit || {};
    const organization = this.resolveOrganization(report);
    const source = {
      templateVersion: REPORT_PDF_TEMPLATE_VERSION,
      report: {
        title: report.title,
        header: report.header,
        content: report.content,
        footer: report.footer,
      },
      mission: {
        title: mission.title,
        client: mission.client,
        address: mission.address,
        type: mission.type,
      },
      visit: {
        visitDate: visit.visitDate,
        photos: visit.photos,
      },
      organization: {
        id: organization.id,
        logoS3Key: organization.logoS3Key,
        primaryColor: organization.primaryColor,
        secondaryColor: organization.secondaryColor,
      },
    };
    return createHash('sha256').update(JSON.stringify(source)).digest('hex');
  }

  private escape(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private text(value: unknown): string {
    return this.escape(value).replace(/\r?\n/g, '<br>');
  }

  private values(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    const text = String(value ?? '').trim();
    if (!text) return [];
    return text.split(/\n|\.\s+/).map((item) => item.trim()).filter(Boolean);
  }

  private list(items: string[]): string {
    if (!items.length) return '<p class="empty-value">Non renseigné</p>';
    return `<ul class="analysis-list">${items.map((item) => `<li>${this.escape(item)}</li>`).join('')}</ul>`;
  }

  private isDirective(photo: any): boolean {
    return photo?.isDirectiveOnly === true ||
      photo?.isDirectiveOnly === 'true' ||
      (!photo?.uri && !photo?.s3Url && Boolean(String(photo?.userDirectives ?? '').trim()));
  }

  private riskLabel(value: unknown): string {
    const risk = String(value ?? '').toLowerCase();
    if (risk === 'eleve' || risk === 'high') return 'ÉLEVÉ';
    if (risk === 'moyen' || risk === 'medium') return 'MOYEN';
    if (risk === 'faible' || risk === 'low') return 'FAIBLE';
    return risk ? risk.toUpperCase() : 'N/A';
  }

  private riskClass(value: unknown): string {
    const risk = String(value ?? '').toLowerCase();
    if (risk === 'eleve' || risk === 'high') return 'risk-high';
    if (risk === 'moyen' || risk === 'medium') return 'risk-medium';
    return 'risk-low';
  }

  private async imageDataUrl(url?: string | null): Promise<string> {
    if (!url) return '';
    try {
      const file = await this.uploadService.downloadFile(url, '', true);
      const base64 = Buffer.isBuffer(file.data) ? file.data.toString('base64') : String(file.data ?? '');
      return base64 ? `data:${file.contentType || 'image/jpeg'};base64,${base64}` : '';
    } catch {
      return '';
    }
  }

  async render(report: Report): Promise<string> {
    const mission: any = report.mission || {};
    const visit: any = report.visit || {};
    const organization = this.resolveOrganization(report);
    const photos: any[] = Array.isArray(visit.photos) ? visit.photos : [];
    const groups = new Map<string, any[]>();

    photos.forEach((photo, index) => {
      const groupId = photo?.groupId || photo?.id || `group-${index}`;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId)!.push(photo);
    });

    const logo = await this.imageDataUrl(organization.logoS3Key);
    const groupHtml: string[] = [];
    let groupIndex = 0;

    for (const groupPhotos of groups.values()) {
      groupIndex += 1;
      const directiveOnly = groupPhotos.every((photo) => this.isDirective(photo));
      const actualPhotos = groupPhotos.filter((photo) => !this.isDirective(photo) && photo?.s3Url);
      const imageUrls = await Promise.all(actualPhotos.map((photo) => this.imageDataUrl(photo.s3Url)));
      const images = imageUrls.filter(Boolean);
      const analysisPhoto = groupPhotos.find((photo) => photo?.analysis) || groupPhotos[0] || {};
      const analysis = analysisPhoto.analysis || {};
      const observations = this.values(analysis.observation ?? analysis.observations);
      const recommendations = this.values(analysis.recommendation ?? analysis.recommendations);
      const references = this.values(analysis.references);
      const comments = groupPhotos
        .map((photo) => String(photo?.comment ?? '').trim())
        .filter(Boolean);
      const photoLabel = directiveOnly
        ? 'Sans photo'
        : `${actualPhotos.length} photo${actualPhotos.length > 1 ? 's' : ''}`;
      const imageGrid = images.length === 1
        ? `<div class="photo-grid-single" style="display:flex;justify-content:center;">
            <div class="photo-container-normalized" style="max-width:400px;">
              <img src="${images[0]}" class="photo-image-normalized" alt="Photo 1">
            </div>
          </div>`
        : images.length > 1
          ? `<div class="photo-grid-multi">${images.map((src, index) => `
              <div class="photo-grid-cell">
                <div class="photo-container-normalized">
                  <img src="${src}" class="photo-image-normalized" alt="Photo ${index + 1}">
                  <span class="photo-index-badge">${index + 1}</span>
                </div>
              </div>`).join('')}</div>`
          : '';
      const hasAnalysis = Boolean(observations.length || recommendations.length || references.length);

      groupHtml.push(`
        <div class="photo-section">
          <div class="photo-header">
            <h3 class="photo-title">${directiveOnly ? '📝' : '📸'} Rapport ${groupIndex} - ${photoLabel}</h3>
          </div>
          ${imageGrid}
          ${hasAnalysis ? `<div class="analysis-section">
            <div class="analysis-block"><h4 class="analysis-heading">🔍 Observations</h4>${this.list(observations)}</div>
            <div class="analysis-block"><h4 class="analysis-heading">⚠️ Recommandations</h4>${this.list(recommendations)}</div>
            ${references.length ? `<div class="analysis-block"><h4 class="comment-heading">🏛️ Références</h4>${this.list(references)}</div>` : ''}
          </div>` : ''}
          ${comments.length ? `<div class="comment-section">
            <h4 class="comment-heading">💬 Commentaires du coordonnateur</h4>
            ${comments.map((comment) => `<p class="comment-text">${this.text(comment)}</p>`).join('')}
          </div>` : ''}
        </div>`);
    }

    const visitDate = visit.visitDate || visit.createdAt || report.createdAt;
    const formattedDate = visitDate
      ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(visitDate))
      : '';
    const generatedAt = new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Europe/Paris',
    }).format(new Date());
    const missionType = String(mission.type || '').trim();

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 8mm 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1E293B; background: #FFFFFF; padding: 20px; }
    .first-page { height: calc(281mm - 40px); overflow: hidden; break-after: page; page-break-after: always; }
    .first-page-content { width: 100%; transform-origin: top left; }
    .observations-title { margin-top: 0; }
    .conclusion-section { break-inside: avoid-page; page-break-inside: avoid; }
    .section-header, .photo-header, .analysis-heading, .comment-heading { break-after: avoid-page; page-break-after: avoid; }
    .photo-grid-single, .photo-grid-cell, .analysis-list li, .comment-section { break-inside: avoid-page; page-break-inside: avoid; }
    .report-header { text-align: center; background: linear-gradient(135deg, #1E293B 0%, #334155 100%); color: #FFFFFF; padding: 30px 20px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 6px rgba(0,0,0,.1); }
    .report-title { font-size: 28px; font-weight: bold; margin-bottom: 10px; letter-spacing: .5px; }
    .report-subtitle { font-size: 18px; opacity: .9; margin-top: 5px; }
    .info-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 15px; margin-bottom: 30px; padding: 20px; background: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0; }
    .info-item { padding: 12px; background: #FFFFFF; border-radius: 8px; border-left: 4px solid #3B82F6; }
    .info-grid-header { display: grid; grid-template-columns: 40% 60%; gap: 10px; padding: 10px; border-radius: 12px; border: 1px solid #E2E8F0; align-items: center; justify-items: center; }
    .info-header { padding: 12px; }
    .info-label { font-size: 12px; font-weight: 600; color: #64748B; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
    .info-value { font-size: 16px; font-weight: 600; color: #1E293B; }
    .section-header { background: linear-gradient(90deg,#3B82F6 0%,#2563EB 100%); color: #FFFFFF; display: flex; align-items: center; justify-content: flex-start; height: 54px; padding: 0 20px; line-height: 1.2; border-radius: 8px; margin: 30px 0 20px; font-size: 18px; font-weight: bold; box-shadow: 0 2px 4px rgba(59,130,246,.2); }
    .content-section { padding: 25px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; margin-bottom: 20px; white-space: pre-wrap; line-height: 1.8; font-size: 14px; color: #334155; }
    .photo-section { break-inside: auto; page-break-inside: auto; background: #FFFFFF; border: 2px solid #E2E8F0; border-radius: 12px; padding: 15px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
    .photo-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 2px solid #F1F5F9; }
    .photo-title { font-size: 18px; font-weight: bold; color: #1E293B; }
    .photo-grid-single { margin-top: 15px; }
    .photo-grid-multi { display: flex; flex-direction: row; flex-wrap: wrap; gap: 10px; margin-top: 15px; }
    .photo-grid-cell { width: calc(50% - 5px); flex-shrink: 0; flex-grow: 0; }
    .photo-container-normalized { position: relative; width: 100%; padding-top: 66.67%; border-radius: 8px; overflow: hidden; background: #F1F5F9; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .photo-grid-single .photo-container-normalized { max-width: 648px; }
    .photo-image-normalized { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    .photo-index-badge { position: absolute; top: 8px; left: 8px; background: rgba(30,41,59,.75); color: #FFFFFF; font-size: 11px; font-weight: bold; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
    .logo-image { width: 200px; height: 160px; display: block; max-height: 200px; object-fit: contain; background: #F8FAFC; border-radius: 12px; }
    .analysis-section { margin-top: 10px; }
    .analysis-block { min-height: 86px; break-inside: auto; page-break-inside: auto; background: #F8FAFC; padding: 15px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #3B82F6; orphans: 2; widows: 2; }
    .analysis-heading { font-size: 14px; font-weight: bold; color: #1E293B; margin-bottom: 10px; display: flex; align-items: center; }
    .analysis-list { margin-left: 20px; color: #475569; }
    .analysis-list li { margin-bottom: 6px; line-height: 1.5; font-size: 13px; }
    .empty-value { color: #94A3B8; font-style: italic; }
    .comment-section { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; border-radius: 8px; margin-top: 15px; }
    .comment-heading { font-size: 14px; font-weight: bold; color: #92400E; margin-bottom: 8px; }
    .comment-text { color: #78350F; font-size: 13px; line-height: 1.6; }
    .footer { margin-top: 16px; padding: 8px 12px 12px; background: #F8FAFC; border-top: 2px solid #3B82F6; border-radius: 8px; text-align: center; }
    .footer-text { font-size: 9px; color: #64748B; margin: 0 0 2px; line-height: 1.25; }
    .footer-confidential { font-size: 10px; font-weight: bold; color: #1E293B; margin: 0; line-height: 1.25; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="first-page" data-organization-id="${this.escape(organization.id)}">
    <div class="first-page-content">
      <div class="report-header">
        <div class="info-grid-header">
          <div class="info-header">${logo ? `<img class="logo-image" src="${logo}" alt="Logo">` : ''}</div>
          <div class="info-header"><div class="report-title">${this.escape(report.title || mission.title || 'Rapport')}</div><div class="report-subtitle">Rapport de Visite${missionType ? ` ${this.escape(missionType)}` : ''}</div></div>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-item"><div class="info-label">Mission</div><div class="info-value">${this.escape(mission.title)}</div></div>
        <div class="info-item"><div class="info-label">Client</div><div class="info-value">${this.escape(mission.client)}</div></div>
        <div class="info-item"><div class="info-label">Type</div><div class="info-value">${this.escape(missionType)}</div></div>
        <div class="info-item"><div class="info-label">Date</div><div class="info-value">${this.escape(formattedDate)}</div></div>
      </div>
      ${report.header ? `<div class="section-header">📋 En-tête</div><div class="content-section">${this.text(report.header)}</div>` : ''}
    </div>
  </div>
  <script>
    (() => {
      const page = document.querySelector('.first-page');
      const content = document.querySelector('.first-page-content');
      if (!page || !content || content.scrollHeight <= page.clientHeight) return;
      const availableHeight = page.clientHeight;
      let low = 0.1;
      let high = 1;
      let best = low;
      for (let index = 0; index < 14; index += 1) {
        const scale = (low + high) / 2;
        content.style.width = (100 / scale) + '%';
        if (content.scrollHeight * scale <= availableHeight) {
          best = scale;
          low = scale;
        } else {
          high = scale;
        }
      }
      content.style.width = (100 / best) + '%';
      content.style.transform = 'scale(' + best + ')';
    })();
  </script>
  <div class="observations-section">
    <div class="section-header observations-title">📸 Observations Principales</div>
    ${groupHtml.length ? groupHtml.join('') : '<div class="content-section">Aucun rapport de visite détaillé.</div>'}
  </div>
  ${report.footer ? `<div class="conclusion-section"><div class="section-header conclusion-title">✅ Conclusion</div><div class="content-section">${this.text(String(report.footer).replace(/^CONCLUSION:\s*/i, ''))}</div></div>` : ''}
  <div class="footer">
    <p class="footer-text">Rapport généré le ${this.escape(generatedAt)}</p>
    <p class="footer-confidential">Document confidentiel - Tous droits réservés</p>
  </div>
</body>
</html>`;
  }

  async generate(
    report: Report,
    requestedFileName?: string,
    forceRegenerate = false,
  ): Promise<{
    url: string;
    key: string;
    size: number;
    fileName: string;
    pdf: Buffer;
    cached: boolean;
  }> {
    const fileName = this.normalizeFileName(requestedFileName, report);
    const reportSourceHash = this.sourceHash(report);

    if (!forceRegenerate && report.reportFileUrl) {
      try {
        const info = await this.uploadService.getFileInfo(report.reportFileUrl);
        if (
          info &&
          info.metadata.reportsourcehash === reportSourceHash &&
          info.metadata.templateversion === REPORT_PDF_TEMPLATE_VERSION &&
          info.fileName === fileName
        ) {
          const stored = await this.uploadService.downloadFile(report.reportFileUrl, '', false);
          const pdf = Buffer.isBuffer(stored.data) ? stored.data : Buffer.from(stored.data);
          return {
            url: report.reportFileUrl,
            key: info.key,
            size: pdf.length,
            fileName,
            pdf,
            cached: true,
          };
        }
      } catch {
        // A missing or unreadable legacy object is regenerated below.
      }
    }

    const html = await this.render(report);
    const pdf = Buffer.from(await this.mailService.generatePdfBuffer(html));

    if (pdf.length < 1024 || !pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      throw new BadRequestException('Le PDF généré est invalide ou vide');
    }

    const upload = await this.uploadService.uploadBuffer(
      pdf,
      fileName,
      'application/pdf',
      'reports_files/client',
      {
        metadata: {
          reportsourcehash: reportSourceHash,
          templateversion: REPORT_PDF_TEMPLATE_VERSION,
        },
      },
    );

    return {
      ...upload,
      size: pdf.length,
      fileName,
      pdf,
      cached: false,
    };
  }
}
