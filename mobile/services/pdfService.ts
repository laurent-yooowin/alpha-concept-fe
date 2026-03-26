// import * as FileSystem from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import * as Print from 'expo-print';
import { AIAnalysis } from './aiService';
import { uploadService } from './uploadService';

export interface ReportData {
  title: string;
  mission: string;
  client: string;
  date: string;
  conformity: number;
  content: string;
  header: string;
  footer: string;
  photos?: any[];
}

export const pdfService = {
  async generateReportPDF(reportData: ReportData): Promise<string | null> {
    try {
      const htmlContent = await this.generateHTMLContent(reportData);

      if (Platform.OS === 'web') {
        return await this.generateWebPDF(htmlContent, reportData.title);
      } else {
        // 
        // console.log('htmlContent >>>', htmlContent)
        return await this.generateNativePDF(htmlContent, reportData.title);
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      return null;
    }
  },

  async injectPhotos(reportContent: string, photos: { s3Url: string; comment?: string }[]) {
    let finalContent = reportContent;

    for (const photo of photos) {
      try {
        const fileUri = FileSystem.cacheDirectory + `temp_${Math.random()}.jpg`;
        // Télécharger l'image depuis S3
        const { uri } = await FileSystem.downloadAsync(photo.s3Url, fileUri);
        // Lire le fichier en base64
        const base64Img = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

        // Construire le bloc HTML de la photo en gardant le texte original
        const photoHTML = `
        <div style="margin: 10px 0; page-break-inside: avoid;">
          <p>📸 Photo: ${photo.s3Url}</p>
          <img src="data:image/jpeg;base64,${base64Img}" style="max-width: 100%; height: auto; border-radius: 8px;" />
          ${photo.comment ? `<p style="margin-top: 4px; font-size: 12px; color: #666;"><strong>Commentaire:</strong> ${photo.comment}</p>` : ''}
        </div>
      `;

        // Remplacer l’URL seule par le bloc complet (texte + image + commentaire)
        finalContent = finalContent.replace(photo.s3Url, photoHTML);
      } catch (err) {
        console.warn('Erreur conversion image en base64:', err);
      }
    }

    return finalContent;
  },

  async generateHTMLContent(reportData: ReportData): string {
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
      // Group photos by groupId
      const photoGroups: { [key: string]: { photos: any[], index: number } } = {};
      let groupOrder = 0;
      (reportData.photos || []).forEach((photo) => {
        const gid = photo.groupId || photo.id || `photo-${Math.random()}`;
        if (!photoGroups[gid]) {
          photoGroups[gid] = { photos: [], index: groupOrder++ };
        }
        photoGroups[gid].photos.push(photo);
      });

      await Promise.all(
        Object.entries(photoGroups).map(async ([groupId, group]) => {
          try {
            // Download all photos in the group
            const photoImagesHtml: string[] = [];
            for (const photo of group.photos) {
              let base64Img = '';
              try {
                const imgResp = await uploadService.downloadFile(photo.s3Url, '/visits', true);
                if (imgResp && imgResp.data && imgResp.data.data) {
                  base64Img = imgResp.data.data.base64;
                }
              } catch (err) {
                console.warn('Erreur download photo:', err);
              }
              if (base64Img) {
                photoImagesHtml.push(`<img src="data:image/jpeg;base64,${base64Img}" class="photo-image" />`);
              }
            }

            const firstPhoto = group.photos[0];
            const comments = firstPhoto.comment && firstPhoto.comment.trim() !== "" ? firstPhoto.comment : '';
            const riskColor = getRiskColor(firstPhoto.aiAnalysis?.riskLevel || 'moyen');
            const riskLabel = getRiskLabel(firstPhoto.aiAnalysis?.riskLevel || 'moyen');

            // Build photo grid HTML
            const photoGridHtml = photoImagesHtml.length > 1
              ? `<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
                  ${photoImagesHtml.map((img, idx) => `
                    <div style="width: 48%; position: relative;">
                      ${img.replace('class="photo-image"', 'style="width: 100%; height: auto; border-radius: 8px; max-height: 300px; object-fit: cover;"')}
                      <span style="position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.6); color: white; border-radius: 8px; padding: 2px 8px; font-size: 11px; font-weight: bold;">#${idx + 1}</span>
                    </div>
                  `).join('')}
                </div>`
              : photoImagesHtml.length === 1
                ? `<div class="photo-container">${photoImagesHtml[0]}</div>`
                : '';

            const isDirectiveOnlyGroup = group.photos.every((p: any) => p.isDirectiveOnly);
            const photoCountLabel = isDirectiveOnlyGroup
              ? 'Pas de photo'
              : `${group.photos.length} photo${group.photos.length > 1 ? 's' : ''}`;
            const headerIcon = isDirectiveOnlyGroup ? '📝' : '📸';

            const divContent = `<div class="photo-section">
                <div class="photo-header">
                  <h3 class="photo-title">${headerIcon} Rapport ${group.index + 1} — ${photoCountLabel}</h3>
                </div>

                ${photoGridHtml}
                ${firstPhoto.aiAnalysis ? `
                  <div class="analysis-section">
                    <div class="analysis-block">
                      <h4 class="analysis-heading">🔍 Observations</h4>
                      <ul class="analysis-list">
                        ${firstPhoto.aiAnalysis?.observations?.map(obs => `<li>${obs}</li>`).join('')}
                      </ul>
                    </div>

                    <div class="analysis-block">
                      <h4 class="analysis-heading">⚠️ Recommandations</h4>
                      <ul class="analysis-list">
                        ${firstPhoto.aiAnalysis?.recommendations?.map(rec => `<li>${rec}</li>`).join('')}
                      </ul>
                    </div>

                    ${firstPhoto.aiAnalysis.references ? `
                      <div class="analysis-block">
                        <h4 class="comment-heading">🏛️ Références</h4>
                        <ul class="analysis-list">
                          ${firstPhoto.aiAnalysis?.references?.map(rec => `<li>${rec}</li>`).join('')}
                        </ul>                        
                      </div>
                    ` : ''}
                  </div>
                    ` : ''}                    
                  ${comments ? `
                    <div class="comment-section">
                      <h4 class="comment-heading">💬 Commentaires du coordonnateur</h4>
                      <p class="comment-text">${comments}</p>
                    </div>
                  ` : ''}
              </div> `;

            divs.push({
              index: group.index,
              divContent: divContent,
            });
          } catch (err) {
            console.warn('Erreur conversion groupe en base64:', err);
          }
        })
      ).then(() => {
        divs.sort((a, b) => a.index - b.index);
        divs.forEach(div => {
          reportContent += div.divContent;
        });
      });
    }

    const logoBase64 = await uploadService.downloadFile("https://alpha-concept.s3.eu-central-1.amazonaws.com/reports_files/logo_alpha.jpg", '/reports_files', true);
    const logoBase64Img = logoBase64 && logoBase64.data ? logoBase64.data.data.base64 : '';
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
      margin: 8mm 6mm 10mm 6mm;
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
      padding: 8px 4px;
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
    try {
      // 1️⃣ Générer le PDF
      const { uri } = await Print.printToFileAsync({
        html: htmlContent,
        base64: false,
      });

      // 2️⃣ Nettoyer le nom de fichier
      const safeName = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf';

      let pdfPath: string;

      // 3️⃣ Déterminer où enregistrer le fichier selon la plateforme
      if (Platform.OS === 'web') {
        // Sur Web : impossible d'utiliser FileSystem, on crée un blob et on déclenche le téléchargement
        const response = await fetch(uri);
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = safeName;
        link.click();
        pdfPath = uri; // on retourne l'URI du blob
        console.log('✅ PDF généré pour Web, téléchargement lancé');
      } else {
        // iOS / Android : utiliser FileSystem
        const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
        pdfPath = `${baseDir}${safeName}`;
        await FileSystem.copyAsync({ from: uri, to: pdfPath });
        console.log('✅ PDF généré à :', pdfPath);

        // 4️⃣ Partage via le système natif
        // const canShare = await Sharing.isAvailableAsync();
        // if (canShare) {
        //   await Sharing.shareAsync(pdfPath, {
        //     dialogTitle: 'Enregistrer ou partager le PDF',
        //   });
        // } else {
        //   console.warn('Le partage n’est pas disponible sur cet appareil.');
        // }
      }

      return pdfPath;
    } catch (error) {
      console.error('❌ Erreur lors de la génération / partage du PDF :', error);
      return null;
    }
  },
  async generateNativePDF1(htmlContent: string, filename: string): Promise<string | null> {
    const htmlToBase64 = btoa(unescape(encodeURIComponent(htmlContent)));
    const pdfPath = `${FileSystem.cacheDirectory}${filename.replace(/[^a-z0-9]/gi, '_')}.pdf`;

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
    // console.log('pdfPath >>> ', pdfPath);
    return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
  },
};
