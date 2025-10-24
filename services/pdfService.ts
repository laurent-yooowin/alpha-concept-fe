import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export interface ReportData {
  title: string;
  mission: string;
  client: string;
  date: string;
  conformity: number;
  content: string;
  photos?: { uri: string; comment?: string }[];
}

export const pdfService = {
  async generateReportPDF(reportData: ReportData): Promise<string | null> {
    try {
      const htmlContent = this.generateHTMLContent(reportData);

      if (Platform.OS === 'web') {
        return await this.generateWebPDF(htmlContent, reportData.title);
      } else {
        return await this.generateNativePDF(htmlContent, reportData.title);
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      return null;
    }
  },

  generateHTMLContent(reportData: ReportData): string {
    const photosHTML = reportData.photos?.map((photo, index) => `
      <div style="margin: 20px 0; page-break-inside: avoid;">
        <img src="${photo.uri}" style="max-width: 100%; height: auto; border-radius: 8px;" />
        ${photo.comment ? `<p style="margin-top: 8px; font-size: 12px; color: #666;"><strong>Commentaire:</strong> ${photo.comment}</p>` : ''}
      </div>
    `).join('') || '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            @page {
              margin: 20mm;
            }
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
            }
            h1 {
              color: #1E293B;
              border-bottom: 3px solid #3B82F6;
              padding-bottom: 10px;
              margin-bottom: 20px;
            }
            h2 {
              color: #3B82F6;
              margin-top: 30px;
              margin-bottom: 15px;
            }
            .info-section {
              background: #F1F5F9;
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              margin: 8px 0;
            }
            .info-label {
              font-weight: bold;
              color: #64748B;
            }
            .info-value {
              color: #1E293B;
            }
            .conformity-bar {
              width: 100%;
              height: 20px;
              background: #E2E8F0;
              border-radius: 10px;
              overflow: hidden;
              margin: 10px 0;
            }
            .conformity-fill {
              height: 100%;
              background: linear-gradient(90deg, #10B981, #059669);
            }
            .content-section {
              margin: 30px 0;
              padding: 20px;
              background: #FFFFFF;
              border: 1px solid #E2E8F0;
              border-radius: 8px;
            }
            .footer {
              margin-top: 50px;
              padding-top: 20px;
              border-top: 1px solid #E2E8F0;
              text-align: center;
              font-size: 12px;
              color: #64748B;
            }
          </style>
        </head>
        <body>
          <h1>${reportData.title}</h1>

          <div class="info-section">
            <div class="info-row">
              <span class="info-label">Mission:</span>
              <span class="info-value">${reportData.mission}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Client:</span>
              <span class="info-value">${reportData.client}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Date:</span>
              <span class="info-value">${reportData.date}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Conformité:</span>
              <span class="info-value">${reportData.conformity}%</span>
            </div>
            <div class="conformity-bar">
              <div class="conformity-fill" style="width: ${reportData.conformity}%"></div>
            </div>
          </div>

          <h2>Contenu du Rapport</h2>
          <div class="content-section">
            <p style="white-space: pre-wrap;">${reportData.content}</p>
          </div>

          ${reportData.photos && reportData.photos.length > 0 ? `
            <h2>Photos (${reportData.photos.length})</h2>
            ${photosHTML}
          ` : ''}

          <div class="footer">
            <p>Rapport généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
            <p>Document confidentiel - Tous droits réservés</p>
          </div>
        </body>
      </html>
    `;
  },

  async generateWebPDF(htmlContent: string, filename: string): Promise<string | null> {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.print();
      return 'web-print';
    }
    return null;
  },

  async generateNativePDF(htmlContent: string, filename: string): Promise<string | null> {
    const htmlToBase64 = btoa(unescape(encodeURIComponent(htmlContent)));
    const pdfPath = `${FileSystem.documentDirectory}${filename.replace(/[^a-z0-9]/gi, '_')}.pdf`;

    const htmlUri = `data:text/html;base64,${htmlToBase64}`;

    return pdfPath;
  },

  async sharePDF(filePath: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        return;
      }

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(filePath);
      } else {
        console.log('Sharing is not available on this platform');
      }
    } catch (error) {
      console.error('Error sharing PDF:', error);
      throw error;
    }
  },

  createMailtoLinkWithAttachment(email: string, subject: string, body: string, pdfPath?: string): string {
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body + (pdfPath ? '\n\n[PDF joint au rapport]' : ''));

    return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
  },
};
