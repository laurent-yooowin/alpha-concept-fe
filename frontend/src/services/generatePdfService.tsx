import { apiRequest, apiUploadsRequest } from "../lib/api";
import { filesService } from "./filesService";
import html2pdf from 'html2pdf.js';

export const generatePdfService = {

  async generateHTMLContent(reportData: any) {
    // 1️⃣ Convertir chaque image en base64
    let reportContent = '';
    const divs = [];

    const getRiskColor = (riskLevel: string) => {
      switch (riskLevel.toLowerCase()) {
        case 'high':
        case 'eleve':
          return '#EF4444';
        case 'medium':
        case 'moyen':
          return '#F59E0B';
        case 'low':
        case 'faible':
          return '#10B981';
        default:
          return '#64748B';
      }
    };

    const getRiskLabel = (riskLevel: string) => {
      switch (riskLevel.toLowerCase()) {
        case 'high':
        case 'eleve':
          return 'ÉLEVÉ';
        case 'medium':
        case 'moyen':
          return 'MOYEN';
        case 'low':
        case 'faible':
          return 'FAIBLE';
        default:
          return riskLevel.toUpperCase();
      }
    };

    if (reportData.photos && reportData.photos.length > 0) {
      // Group photos by groupId (fallback to individual)
      const photoGroups: { [key: string]: { index: number; photos: any[] } } = {};
      let groupOrder = 0;
      (reportData.photos || []).forEach((photo: any, idx: number) => {
        const gid = photo.groupId || `single_${idx}`;
        if (!photoGroups[gid]) {
          photoGroups[gid] = { index: groupOrder++, photos: [] };
        }
        photoGroups[gid].photos.push(photo);
      });

      // Download all images in parallel (skip directive-only photos)
      const photoBase64Map = new Map<number, string>();
      await Promise.all(
        (reportData.photos || []).map(async (photo: any, idx: number) => {
          if (photo.isDirectiveOnly) {
            photoBase64Map.set(idx, '');
            return;
          }
          try {
            const pdfData = await filesService.downloadFile(photo.s3Url, 'visits/photos/', true);
            photoBase64Map.set(idx, pdfData.data?.base64 || '');
          } catch (err) {
            console.warn('Erreur conversion image en base64:', err);
            photoBase64Map.set(idx, '');
          }
        })
      );

      // Build HTML for each group
      const groupEntries = Object.entries(photoGroups).sort((a, b) => a[1].index - b[1].index);
      let globalPhotoIdx = 0;

      for (const [groupId, groupData] of groupEntries) {
        const photos = groupData.photos;
        const groupIdx = groupData.index + 1;
        const isSinglePhoto = photos.length === 1;

        const isDirectiveOnlyGroup = photos.every((p: any) => p.isDirectiveOnly);

        // Build photo grid — skip entirely for directive-only groups
        let photoGridHtml = '';
        if (!isDirectiveOnlyGroup) {
          if (isSinglePhoto) {
            const base64 = photoBase64Map.get(reportData.photos.indexOf(photos[0])) || '';
            photoGridHtml = `
              <div class="photo-grid-single" style="display:flex;justify-content:center;">
                <div class="photo-container-normalized" style="max-width:400px;">
                  <img src="data:image/jpeg;base64,${base64}" class="photo-image-normalized" />
                </div>
              </div>`;
          } else {
            photoGridHtml = `<div class="photo-grid-multi">`;
            for (let i = 0; i < photos.length; i++) {
              const base64 = photoBase64Map.get(reportData.photos.indexOf(photos[i])) || '';
              photoGridHtml += `
                <div class="photo-grid-cell">
                  <div class="photo-container-normalized">
                    <img src="data:image/jpeg;base64,${base64}" class="photo-image-normalized" />
                    <span class="photo-index-badge">${i + 1}</span>
                  </div>
                </div>`;
            }
            photoGridHtml += `</div>`;
          }
        }

        // Aggregate analysis from first photo with analysis (group shares one report)
        const analysisPhoto = photos.find((p: any) => p.aiAnalysis) || photos[0];
        const analysis = analysisPhoto?.aiAnalysis;

        // Aggregate comments
        const allComments = photos
          .map((p: any) => {
            const c = p.userComments && p.userComments.trim() !== "" ? p.userComments : p.comment;
            return c;
          })
          .filter((c: string) => c && c.trim() !== '');
        const commentsHtml = allComments.length > 0
          ? allComments.map((c: string) => `<p class="comment-text">${c}</p>`).join('')
          : '';

        const photoCountLabel = isDirectiveOnlyGroup
          ? 'Pas de photo'
          : `${photos.length} photo(s)`;
        const headerIcon = isDirectiveOnlyGroup ? '📝' : '📸';

        const divContent = `<div class="photo-section">
            <div class="photo-header">
              <h3 class="photo-title">${headerIcon} Rapport ${groupIdx} — ${photoCountLabel}</h3>
            </div>

            ${photoGridHtml}

            ${analysis ? `
              <div class="analysis-section">
                <div class="analysis-block">
                  <h4 class="analysis-heading">🔍 Observations</h4>
                  <ul class="analysis-list">
                    ${analysis.observations?.map((obs: string) => `<li>${obs}</li>`).join('') || ''}
                  </ul>
                </div>
                <div class="analysis-block">
                  <h4 class="analysis-heading">⚠️ Recommandations</h4>
                  <ul class="analysis-list">
                    ${analysis.recommendations?.map((rec: string) => `<li>${rec}</li>`).join('') || ''}
                  </ul>
                </div>
                ${analysis.references && analysis.references.length > 0 ? `
                  <div class="analysis-block">
                    <h4 class="comment-heading">🏛️ Références</h4>
                    <ul class="analysis-list">
                      ${analysis.references.map((ref: string) => `<li>${ref}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}
              </div>
            ` : ''}

            ${commentsHtml ? `
              <div class="comment-section">
                <h4 class="comment-heading">💬 Commentaires du coordonnateur</h4>
                ${commentsHtml}
              </div>
            ` : ''}
          </div>`;

        divs.push({ index: groupData.index, divContent });
      }

      divs.sort((a, b) => a.index - b.index);
      divs.forEach(div => {
        reportContent += div.divContent;
      });
    }

    const logoBase64 = await filesService.downloadFile("https://alpha-concept.s3.eu-central-1.amazonaws.com/reports_files/logo_alpha.jpg", '/reports_files', true);
    const logoBase64Img = logoBase64 && logoBase64.data ? logoBase64.data.base64 : '';
    const logoImage = `
      <img src="data:image/jpeg;base64,${logoBase64Img}" class="logo-image" />    
    `;

    return `
    <!DOCTYPE html>
    <html>    
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @page {
          margin: 15mm;
          size: A4;
        }
    
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
    
        body {
          font-family: 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #1E293B;
          background: #FFFFFF;
          padding: 20px;
        }
    
        .report-header {
          text-align: center;
          background: linear-gradient(135deg, #1E293B 0%, #334155 100%);
          color: #FFFFFF;
          padding: 30px 20px;
          border-radius: 12px;
          margin-bottom: 30px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
    
        .report-title {
          font-size: 28px;
          font-weight: bold;
          margin-bottom: 10px;
          letter-spacing: 0.5px;
        }
    
        .report-subtitle {
          font-size: 18px;
          opacity: 0.9;
          margin-top: 5px;
        }
    
        .info-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
          margin-bottom: 30px;
          padding: 20px;
          background: #F8FAFC;
          border-radius: 12px;
          border: 1px solid #E2E8F0;
        }
    
        .info-item {
          padding: 12px;
          background: #FFFFFF;
          border-radius: 8px;
          border-left: 4px solid #3B82F6;
        }
    
        .info-grid-header {
          display: grid;
          grid-template-columns: 40% 60%;
          gap: 10px;      
          padding: 10px;      
          border-radius: 12px;
          border: 1px solid #E2E8F0;
          align-items: center;
          justify-items: center;
        }
    
        .info-header {
          padding: 12px;
        }
    
        .info-label {
          font-size: 12px;
          font-weight: 600;
          color: #64748B;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
    
        .info-value {
          font-size: 16px;
          font-weight: 600;
          color: #1E293B;
        }
    
        .conformity-section {
          grid-column: 1 / -1;
          padding: 15px;
          background: #FFFFFF;
          border-radius: 8px;
        }
    
        .conformity-bar {
          width: 100%;
          height: 30px;
          background: #E2E8F0;
          border-radius: 15px;
          overflow: hidden;
          margin-top: 10px;
          position: relative;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }
    
        .conformity-fill {
          height: 100%;
          background: linear-gradient(90deg, #10B981 0%, #059669 100%);
          transition: width 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 15px;
          color: #FFFFFF;
          font-weight: bold;
          font-size: 14px;
        }
    
        .section-header {
          background: linear-gradient(90deg, #3B82F6 0%, #2563EB 100%);
          color: #FFFFFF;
          padding: 15px 20px;
          border-radius: 8px;
          margin: 30px 0 20px 0;
          font-size: 18px;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
        }
    
        .content-section {
          padding: 25px;
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          margin-bottom: 20px;
          white-space: pre-wrap;
          line-height: 1.8;
          font-size: 14px;
          color: #334155;
        }
    
        .photo-section {
          background: #FFFFFF;
          border: 2px solid #E2E8F0;
          border-radius: 12px;
          padding: 15px;
          margin-bottom: 10px;      
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
    
        .photo-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 2px solid #F1F5F9;
        }
    
        .photo-title {
          font-size: 18px;
          font-weight: bold;
          color: #1E293B;
        }
    
        .risk-badge {
          padding: 6px 16px;
          border-radius: 20px;
          color: #FFFFFF;
          font-weight: bold;
          font-size: 12px;
          letter-spacing: 0.5px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
        }
    
        .photo-container {
          margin: 15px 0;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
    
        .photo-image {
          width: 100%;
          height: auto;
          display: block;
          max-height: 400px;
          object-fit: contain;
          background: #F8FAFC;
        }

        /* Grid layouts for grouped photos */
        .photo-grid-single {
          margin-top: 15px;
        }

        .photo-grid-multi {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 15px;
        }

        .photo-grid-cell {
          width: calc(50% - 5px);
          flex-shrink: 0;
          flex-grow: 0;
        }

        .photo-container-normalized {
          position: relative;
          width: 100%;
          /* 9:6 aspect ratio = 2:3 width:height → padding-top 66.67% */
          padding-top: 66.67%;
          border-radius: 8px;
          overflow: hidden;
          background: #F1F5F9;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .photo-grid-single .photo-container-normalized {
          /* Full width single photo, still 9x6 ratio */
          max-width: 648px; /* 9in * 72dpi */
        }

        .photo-image-normalized {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .photo-index-badge {
          position: absolute;
          top: 8px;
          left: 8px;
          background: rgba(30, 41, 59, 0.75);
          color: #FFFFFF;
          font-size: 11px;
          font-weight: bold;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
    
        .logo-image {
          width: 200px;
          height: 160px;
          display: block;
          max-height: 200px;
          object-fit: contain;
          background: #F8FAFC;
          border-radius: 12px;
        }
    
        .analysis-section {
          margin-top: 10px;
        }
    
        .analysis-block {
          background: #F8FAFC;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 12px;
          border-left: 4px solid #3B82F6;
        }
    
        .analysis-heading {
          font-size: 14px;
          font-weight: bold;
          color: #1E293B;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
        }
    
        .analysis-list {
          margin-left: 20px;
          color: #475569;
        }
    
        .analysis-list li {
          margin-bottom: 6px;
          line-height: 1.5;
          font-size: 13px;
        }
    
        .comment-section {
          background: #FEF3C7;
          border-left: 4px solid #F59E0B;
          padding: 15px;
          border-radius: 8px;
          margin-top: 15px;
        }
    
        .comment-heading {
          font-size: 14px;
          font-weight: bold;
          color: #92400E;
          margin-bottom: 8px;
        }
    
        .comment-text {
          color: #78350F;
          font-size: 13px;
          line-height: 1.6;
        }
    
        .footer {
          margin-top: 40px;
          padding: 20px;
          background: #F8FAFC;
          border-top: 3px solid #3B82F6;
          border-radius: 12px;
          text-align: center;
        }
    
        .footer-text {
          font-size: 11px;
          color: #64748B;
          margin: 5px 0;
        }
    
        .footer-confidential {
          font-weight: bold;
          color: #1E293B;
          margin-top: 10px;
        }
    
        @media print {
          body {
            padding: 0;
          }
        }
      </style>
    </head>
    
    <body>
      <div class="report-header">
        <div class="info-grid-header">
          <div class="info-header">
            ${logoImage}   
          </div>    
          <div class="info-header">
            <div class="report-title">${reportData.title}</div>
            <div class="report-subtitle">Rapport de Visite SPS</div>
          </div>
        </div>
      </div>
    
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Mission</div>
          <div class="info-value">${reportData.mission}</div>
        </div>
    
        <div class="info-item">
          <div class="info-label">Client</div>
          <div class="info-value">${reportData.client}</div>
        </div>
    
        <div class="info-item">
          <div class="info-label">Date</div>
          <div class="info-value">${reportData.date}</div>
        </div>    
      </div>
    
      ${reportData.header ? `
      <div class="section-header">📋 En-tête</div>
      <div class="content-section">${reportData.header}</div>
      ` : ''}
    
      <div class="section-header">📸 Observations Principales</div>
      ${reportContent}
    
      ${reportData.footer ? `
      <div class="section-header">✅ Conclusion</div>
      <div class="content-section">${reportData.footer?.replaceAll('CONCLUSION:\n', '')}</div>
      ` : ''}
    
      <div class="footer">
        <p class="footer-text">Rapport généré le ${new Date().toLocaleDateString('fr-FR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })} à ${new Date().toLocaleTimeString('fr-FR')}</p>
        <p class="footer-confidential">Document confidentiel - Tous droits réservés</p>
      </div>
    </body>
    
    </html>
  `;
  },

  async generateWebPDF(htmlContent: string, filename: string) {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      // printWindow.print();
      return 'web-print';
    }
    return null;
  },

  async generateWebPDFBase64(htmlContent: string, filename: string): Promise<Blob | null> {
    try {
      // Crée un élément temporaire pour le HTML
      const element = document.createElement('div');
      element.innerHTML = htmlContent;
      document.body.appendChild(element);

      // Options html2pdf
      const options = {
        margin: 10,
        filename: 'report.pdf',
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
      };

      // Générer le PDF en Blob
      const pdfBlob: Blob = await html2pdf().set(options).from(element).outputPdf('blob');

      // Supprimer l’élément temporaire
      document.body.removeChild(element);
      const filenameForm = filename.replaceAll(' ', '');
      // Préparer le formData pour l’upload
      const formData = new FormData();
      formData.append('file', pdfBlob, filenameForm);

      // Appeler l’API upload
      const response = await apiUploadsRequest('/upload/report-pdf', {
        method: 'POST',
        body: formData,
      });

      return response;
    } catch (err) {
      console.error('Erreur génération/upload PDF :', err);
      throw err;
    }
  },

  async generateReportPDF(reportData: any) {
    try {
      const htmlContent = await this.generateHTMLContent(reportData);
      await this.generateWebPDF(htmlContent, reportData.title);
      return htmlContent;
    } catch (error) {
      console.error('Error generating PDF:', error);
      return null;
    }
  },

  async sendReportPDFByEmail(email: string, subject: string, message: string, pdfContent: string, pdfUrl?: string, isHtmlContent?: boolean, fileName: string = 'report.pdf') {
    const url = `/mail/send-report`;
    const data = {
      email: email,
      pdfContent: pdfContent,
      pdfUrl: pdfUrl,
      subject: subject,
      message: message,
      isHtmlContent: isHtmlContent,
      fileName: fileName,
    };

    return apiRequest(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },


};