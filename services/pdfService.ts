// import * as FileSystem from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import * as Print from 'expo-print';

export interface ReportData {
  title: string;
  mission: string;
  client: string;
  date: string;
  conformity: number;
  content: string;
  heaer: string;
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
        console.log('htmlContent >>>', htmlContent)
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
      await Promise.all(
        (reportData.photos || []).map(async (photo, index) => {
          let base64Img = '';
          try {
            const fileUri = FileSystem.cacheDirectory + `temp_${Math.random()}.jpg`;
            const { uri } = await FileSystem.downloadAsync(photo.s3Url, fileUri);
            base64Img = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

            const riskColor = getRiskColor(photo.aiAnalysis?.riskLevel || 'moyen');
            const riskLabel = getRiskLabel(photo.aiAnalysis?.riskLevel || 'moyen');

            const divContent = `
              <div class="photo-section">
                <div class="photo-header">
                  <h3 class="photo-title">📸 Photo ${index + 1}</h3>
                  <span class="risk-badge" style="background-color: ${riskColor};">
                    ${riskLabel}
                  </span>
                </div>

                <div class="photo-container">
                  <img src="data:image/jpeg;base64,${base64Img}" class="photo-image" />
                </div>

                ${photo.aiAnalysis ? `
                  <div class="analysis-section">
                    <div class="analysis-block">
                      <h4 class="analysis-heading">🔍 Observations</h4>
                      <ul class="analysis-list">
                        ${photo.aiAnalysis.observations.map(obs => `<li>${obs}</li>`).join('')}
                      </ul>
                    </div>

                    <div class="analysis-block">
                      <h4 class="analysis-heading">⚠️ Recommandations</h4>
                      <ul class="analysis-list">
                        ${photo.aiAnalysis.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                      </ul>
                    </div>
                  </div>
                ` : ''}

                ${photo.comment ? `
                  <div class="comment-section">
                    <h4 class="comment-heading">💬 Commentaires du coordonnateur</h4>
                    <p class="comment-text">${photo.comment}</p>
                  </div>
                ` : ''}
              </div>
            `;

            divs.push({
              index: index,
              divContent: divContent,
            });
          } catch (err) {
            console.warn('Erreur conversion image en base64:', err);
          }
        })
      ).then(() => {
        divs.sort((a, b) => a.index - b.index);
        divs.forEach(div => {
          reportContent += div.divContent;
        });
      });
    }

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
            font-size: 14px;
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
            padding: 20px;
            margin-bottom: 25px;
            page-break-inside: avoid;
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
            max-height: 500px;
            object-fit: contain;
            background: #F8FAFC;
          }

          .analysis-section {
            margin-top: 20px;
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

            .photo-section {
              page-break-inside: avoid;
            }

            .section-header {
              page-break-after: avoid;
            }
          }
        </style>
      </head>
      <body>
        <div class="report-header">
          <div class="report-title">${reportData.title}</div>
          <div class="report-subtitle">Rapport de Visite SPS</div>
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

          <div class="info-item">
            <div class="info-label">Conformité</div>
            <div class="info-value">${reportData.conformity}%</div>
          </div>

          <div class="conformity-section">
            <div class="info-label">Niveau de Conformité Global</div>
            <div class="conformity-bar">
              <div class="conformity-fill" style="width: ${reportData.conformity}%;">
                ${reportData.conformity}%
              </div>
            </div>
          </div>
        </div>

        ${reportData.heaer ? `
          <div class="section-header">📋 En-tête</div>
          <div class="content-section">${reportData.heaer}</div>
        ` : ''}

        <div class="section-header">📸 Observations Principales</div>
        ${reportContent}

        ${reportData.footer ? `
          <div class="section-header">✅ Conclusion</div>
          <div class="content-section">${reportData.footer}</div>
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
    console.log('pdfPath >>> ', pdfPath);
    return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
  },
};
