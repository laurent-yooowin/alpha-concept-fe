import { useState, useEffect } from 'react';
import { X, FileText, Calendar, CheckCircle, Clock, Send, AlertTriangle, Image as ImageIcon, Eye, Edit2, Download } from 'lucide-react';
import { reportsAPI, missionsAPI } from '../lib/api';
import { visitService } from '../services/visitService';
import { filesService } from '../services/filesService';
import { generatePdfService } from '../services/generatePdfService';
import { useAuth } from '../contexts/AuthContext';
import PhotoReportEditor from './PhotoReportEditor';
import Swal from 'sweetalert2';

interface Report {
  [key: string]: any;
  id: string;
  title: string;
  content: string;
  status: string;
  header?: string;
  footer?: string;
  conformityPercentage: number;
  createdAt: string;
  sentAt?: string;
  validatedAt?: string;
  recipientEmail?: string;
  observations?: string;
  remarquesAdmin?: string;
  visitId: string;
  visit?: any;
  missionId?: string;
  missionStatus?: string;
  missionDate?: string;
  missionTime?: string;
  contactEmail?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactPhone?: string | number;
  address?: string;
  client?: string;
  reportFileUrl?: string;
}

interface MissionReportModalProps {
  mission: { id: string; title: string; client: string; address: string };
  onClose: () => void;
  initialReportId?: string;
}

export default function MissionReportModal({ mission, onClose, initialReportId }: MissionReportModalProps) {
  const { profile: currentUser } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  // Full report detail states
  const [reportPhotos, setReportPhotos] = useState<any[]>([]);
  const [editedHeader, setEditedHeader] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [editedFooter, setEditedFooter] = useState('');
  const [editedObservations, setEditedObservations] = useState('');
  const [adminRemarks, setAdminRemarks] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [sendingToClient, setSendingToClient] = useState(false);
  const [initialReportOpened, setInitialReportOpened] = useState(false);

  const isAdmin = currentUser?.role === 'ROLE_ADMIN';

  useEffect(() => {
    fetchReports();
  }, []);

  // Auto-open initial report detail when reports are loaded
  useEffect(() => {
    if (initialReportId && !initialReportOpened && !loading && reports.length > 0) {
      setInitialReportOpened(true);
      const target = reports.find(r => r.id === initialReportId);
      if (target) {
        openReportDetail(target);
      }
    }
  }, [initialReportId, loading, reports]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const allReports = await reportsAPI.getAll();
      const missionReports = Array.isArray(allReports)
        ? allReports.filter((r: Report) => {
          const reportMissionId = r.missionId || (r.mission as any)?.id;
          return reportMissionId === mission.id;
        })
        : [];
      // Process reports
      const processed = missionReports.map((report: any) => {
        const missionData = report.mission;
        if (missionData && typeof missionData === 'object') {
          report.title = report.title || missionData.title;
          report.address = missionData.address;
          report.client = missionData.client;
          report.missionId = missionData.id;
          report.contactEmail = missionData.contactEmail;
          report.contactFirstName = missionData.contactFirstName;
          report.contactLastName = missionData.contactLastName;
          report.contactPhone = missionData.contactPhone;
          report.missionStatus = missionData.status;
          report.missionDate = missionData.date;
          report.missionTime = missionData.time;
        }
        return report;
      });
      setReports(processed);
    } catch (error) {
      console.error('Error fetching reports:', error);
    }
    setLoading(false);
  };

  const openReportDetail = async (report: Report) => {
    try {
      const fullReport = await reportsAPI.getById(report.id);
      const missionData = fullReport.mission;
      if (missionData && typeof missionData === 'object') {
        fullReport.title = fullReport.title || missionData.title;
        fullReport.address = missionData.address;
        fullReport.client = missionData.client;
        fullReport.missionId = missionData.id;
        fullReport.contactEmail = missionData.contactEmail;
        fullReport.contactFirstName = missionData.contactFirstName;
        fullReport.contactLastName = missionData.contactLastName;
        fullReport.contactPhone = missionData.contactPhone;
        fullReport.missionStatus = missionData.status;
        fullReport.missionDate = missionData.date;
        fullReport.missionTime = missionData.time;
      }
      setSelectedReport(fullReport);
      setReportPhotos(fullReport.visit?.photos || []);
      setEditedHeader(fullReport.header || '');
      setEditedContent(fullReport.content || '');
      setEditedFooter(fullReport.footer || '');
      setEditedObservations(fullReport.observations || '');
      setAdminRemarks(fullReport.remarquesAdmin || '');
      setIsEditing(false);
    } catch (error) {
      console.error('Error loading report:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Impossible de charger le rapport' });
    }
  };

  const downloadImages = async (url: string) => {
    try {
      const response = await filesService.downloadFile(url, 'reports', true);
      const { base64 } = response.data;
      return base64;
    } catch (error) {
      console.error('Erreur téléchargement image:', error);
    }
  };

  const handleSaveEdits = async () => {
    if (!selectedReport) return;
    try {
      const resp = await reportsAPI.update(selectedReport.id, {
        content: editedContent,
        header: editedHeader,
        footer: editedFooter,
        observations: editedObservations,
        remarquesAdmin: adminRemarks,
      });
      if (selectedReport.visitId) {
        await visitService.update(selectedReport.visitId, { photos: reportPhotos });
      }
      setSelectedReport(prev => prev ? { ...prev, ...resp } : null);
      setIsEditing(false);
      Swal.fire({ icon: 'success', title: 'Rapport sauvegardé', timer: 1500, showConfirmButton: false });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la sauvegarde' });
    }
  };

  const handleSendToClient = async () => {
    if (!selectedReport || selectedReport.status === 'envoye_au_client' || selectedReport.missionStatus === 'terminee') return;

    let photos: any[] = [];
    try {
      const visitResponse = selectedReport.visit;
      if (visitResponse?.photos) {
        visitResponse.photos.forEach((photo: any) => {
          const riskLevelMap: { [key: string]: string } = {
            'faible': 'low', 'moyen': 'medium', 'eleve': 'high',
            'low': 'low', 'medium': 'medium', 'high': 'high'
          };
          const observationText = photo.analysis?.observation || '';
          const recommendationText = photo.analysis?.recommendation || '';
          const refText = photo.analysis?.references || '';
          const observations = Array.isArray(observationText) ? observationText : observationText.split('. ');
          const recommendations = Array.isArray(recommendationText) ? recommendationText : recommendationText.split('. ');
          const refs = Array.isArray(refText) ? refText : refText.split('. ');

          photos.push({
            ...photo,
            id: photo.id || `photo-${Date.now()}-${Math.random()}`,
            groupId: photo.groupId || photo.id,
            isDirectiveOnly: photo.isDirectiveOnly || false,
            uri: photo.uri || photo.s3Url,
            s3Url: photo.s3Url,
            timestamp: new Date(photo.createdAt || Date.now()),
            aiAnalysis: photo.analysis ? {
              observations: observations.filter((s: string) => s.length > 0),
              recommendations: recommendations.filter((s: string) => s.length > 0),
              riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
              confidence: photo.analysis.confidence || 0,
              references: refs.filter((s: string) => s.length > 0),
            } : undefined,
            comment: photo.comment || '',
            validated: photo.validated || true
          });
        });
      }
    } catch (error) {
      console.log('Could not load visit photos:', error);
    }

    try {
      const pdfData: any = {
        title: selectedReport.title || mission.title,
        mission: mission.title,
        client: mission.client,
        date: selectedReport.createdAt || '',
        conformity: selectedReport.conformityPercentage,
        header: selectedReport.header || '',
        content: selectedReport.content || 'Contenu non disponible',
        footer: selectedReport.footer || '',
        observations: selectedReport.observations || '',
        photos,
      };

      const pdfHtml = await generatePdfService.generateReportPDF(pdfData);
      setSendingToClient(true);

      const resp = await generatePdfService.generateWebPDFBase64(pdfHtml || '', `${pdfData.mission}.pdf`);
      if (!resp) {
        Swal.fire({ icon: 'error', title: 'Erreur', text: 'Échec de la génération du PDF' });
        setSendingToClient(false);
        return;
      }

      const message = `Bonjour ${selectedReport.contactFirstName || ''},
Veuillez trouver ci-joint le rapport de visite suivant:

Chantier: ${mission.title}
Date d'attribution: ${selectedReport.missionDate || ''} ${selectedReport.missionTime ? ' à ' + selectedReport.missionTime : ''}
Date de visite: ${new Date(selectedReport.visit?.createdAt || '').toLocaleDateString('fr-FR')}
Adresse chantier: ${mission.address}
Nombre de photos: ${selectedReport.visit?.photos?.length || 0}

Le rapport complet avec les photos est disponible en pièce jointe PDF.

Cordialement.
${currentUser ? `Coordonnateur: ${currentUser.firstName} ${currentUser.lastName}` : ''}`;

      const subject = `Rapport CSPS – ${pdfData.mission} – ${pdfData.date}`;
      const pdfUrl = (resp as any)?.url;

      const confirm = await Swal.fire({
        title: 'Confirmer l\'envoi du rapport',
        text: `Voulez-vous vraiment envoyer le rapport PDF au client ${selectedReport.contactFirstName || ''} ?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Oui, envoyer',
        cancelButtonText: 'Annuler',
      });

      if (!confirm.isConfirmed) {
        setSendingToClient(false);
        return;
      }

      const response = await generatePdfService.sendReportPDFByEmail(
        selectedReport.contactEmail || '',
        subject,
        message,
        '',
        pdfUrl || '',
        false,
        `${pdfData.mission.replace(/\s+/g, '_')}_rapport_CSPS.pdf`
      );

      if (response.ok || response.success) {
        await reportsAPI.update(selectedReport.id, {
          status: 'envoye_au_client',
          recipientEmail: selectedReport.contactEmail,
          reportFileUrl: pdfUrl,
        });
        Swal.fire({
          title: 'Rapport envoyé',
          text: `Le rapport a été envoyé au client avec succès.`,
          icon: 'success',
          confirmButtonText: 'OK',
        }).then(async () => {
          setSelectedReport(null);
          await fetchReports();
        });
      } else {
        Swal.fire({ icon: 'error', title: 'Erreur', text: 'Échec de l\'envoi du mail.' });
      }
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Échec de l\'envoi du mail.' });
    } finally {
      setSendingToClient(false);
    }
  };

  const downloadReportFile = async (fileUrl: string) => {
    try {
      const response = await filesService.downloadFile(fileUrl, 'reports', true);
      const { base64, contentType, fileName } = response.data;
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'document.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erreur téléchargement:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'brouillon': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'envoye': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'valide': return 'bg-green-100 text-green-700 border-green-200';
      case 'refuse': return 'bg-red-100 text-red-700 border-red-200';
      case 'envoye_au_client': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'annule': return 'bg-red-100 text-red-700 border-red-200';
      case 'archive': return 'bg-slate-100 text-slate-600 border-slate-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'brouillon': return 'Brouillon';
      case 'envoye': return 'Soumis';
      case 'valide': return 'Validé';
      case 'refuse': return 'Refusé';
      case 'envoye_au_client': return 'Envoyé au client';
      case 'annule': return 'Annulé';
      case 'archive': return 'Archivé';
      default: return status;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-blue-600" />
              Rapports du chantier
            </h2>
            <p className="text-slate-600 mt-1">{mission.title} — {mission.client}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-slate-500">Chargement...</div>
          ) : reports.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">Aucun rapport pour ce chantier</p>
            </div>
          ) : selectedReport ? (
            /* ─── FULL REPORT DETAIL VIEW ─── */
            <div>
              <button
                onClick={() => { setSelectedReport(null); setIsEditing(false); }}
                className="text-s text-prosps-blue hover:underline mb-4 flex items-center gap-1"
              >
                ← Retour à la liste
              </button>

              {/* Report header info */}
              <div className="bg-slate-50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-900 text-lg">{selectedReport.title || mission.title}</h3>
                  <div className="flex items-center gap-2">
                    {selectedReport.reportFileUrl && (
                      <button
                        onClick={() => downloadReportFile(selectedReport.reportFileUrl!)}
                        className="flex items-center gap-1 text-s text-red-600 hover:underline"
                      >
                        <Download className="w-4 h-4" /> PDF
                      </button>
                    )}
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-s font-medium border ${getStatusColor(selectedReport.status)}`}>
                      {getStatusLabel(selectedReport.status)}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-s">
                  <div>
                    <span className="text-slate-500">Client:</span>
                    <span className="ml-1 font-medium text-slate-900">{selectedReport.client || mission.client}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Date:</span>
                    <span className="ml-1 font-medium text-slate-900">{new Date(selectedReport.createdAt).toLocaleDateString('fr-FR')}</span>
                  </div>
                  {selectedReport.conformityPercentage != null && (
                    <div>
                      <span className="text-slate-500">Conformité:</span>
                      <span className="ml-1 font-medium text-slate-900">{selectedReport.conformityPercentage}%</span>
                    </div>
                  )}
                  {selectedReport.sentToClientAt && (
                    <div>
                      <span className="text-slate-500">Envoyé le:</span>
                      <span className="ml-1 font-medium text-emerald-700">{new Date(selectedReport.sentToClientAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Report content with PhotoReportEditor */}
              <div className="mb-6">
                <label className="block text-s font-medium text-slate-700 mb-2">Contenu du rapport</label>
                <PhotoReportEditor
                  initialPhotos={selectedReport.visit?.photos || []}
                  downloadImages={downloadImages}
                  isEditing={isEditing}
                  editedFooter={editedFooter}
                  editedHeader={editedHeader}
                  onPhotosChange={isEditing ? setReportPhotos : undefined}
                  onHeaderChange={isEditing ? setEditedHeader : undefined}
                  onFooterChange={isEditing ? setEditedFooter : undefined}
                />
              </div>

              {/* Observations */}
              <div className="mb-6">
                <label className="block text-s font-medium text-slate-700 mb-2">Observations</label>
                {isEditing ? (
                  <textarea
                    value={editedObservations}
                    onChange={(e) => setEditedObservations(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  />
                ) : (
                  <div className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap text-slate-900 text-s">
                    {editedObservations || 'Aucune observation'}
                  </div>
                )}
              </div>

              {/* Admin remarks */}
              {selectedReport.remarquesAdmin && !isEditing && (
                <div className="mb-6">
                  <label className="block text-s font-medium text-slate-700 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Remarques admin
                  </label>
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-s text-amber-800 whitespace-pre-wrap">
                    {selectedReport.remarquesAdmin}
                  </div>
                </div>
              )}

              {/* Validated / Sent info */}
              {selectedReport.validatedAt && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg mb-4">
                  <p className="text-s text-green-900"><strong>Validé le:</strong> {new Date(selectedReport.validatedAt).toLocaleDateString('fr-FR')}</p>
                </div>
              )}
              {selectedReport.sentToClientAt && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
                  <p className="text-s text-emerald-900"><strong>Envoyé au client le:</strong> {new Date(selectedReport.sentToClientAt).toLocaleDateString('fr-FR')}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={() => { setSelectedReport(null); setIsEditing(false); }}
                  className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  Retour
                </button>

                {selectedReport.status !== 'envoye_au_client' && selectedReport.status !== 'annule' && selectedReport.missionStatus !== 'terminee' && (
                  <>
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => setIsEditing(false)}
                          className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                        >
                          Annuler
                        </button>
                        <button
                          onClick={handleSaveEdits}
                          className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Enregistrer
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setIsEditing(true)}
                          className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-6 py-3 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                        >
                          <Edit2 className="w-4 h-4" />
                          Modifier
                        </button>
                        {!isAdmin && selectedReport.status !== 'envoye_au_client' && selectedReport.missionStatus !== 'terminee' && selectedReport.missionStatus !== 'archivee' && (
                          <button
                            onClick={handleSendToClient}
                            disabled={sendingToClient}
                            className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" />
                            {sendingToClient ? 'Envoi...' : 'Envoyer au client'}
                          </button>
                        )}
                        {isAdmin && selectedReport.status !== 'envoye_au_client' && selectedReport.missionStatus !== 'terminee' && selectedReport.missionStatus !== 'archivee' && (
                          <button
                            onClick={handleSendToClient}
                            disabled={sendingToClient}
                            className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" />
                            {sendingToClient ? 'Envoi...' : 'Envoyer au client'}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            /* ─── REPORTS LIST ─── */
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  onClick={() => openReportDetail(report)}
                  className={"border rounded-lg p-4 hover:bg-slate-50 cursor-pointer transition-colors" +
                    (report?.status == 'envoye_au_client' ? ' border-green-400' : (report?.status == 'annule' ? ' border-red-400' : ' border-blue-400'))}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-slate-900">{report.title || mission.title}</h3>
                      <div className="flex items-center gap-4 mt-2 text-s text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(report.createdAt).toLocaleDateString('fr-FR')}
                        </span>
                        {report.conformityPercentage != null && (
                          <span>Conformité: {report.conformityPercentage}%</span>
                        )}
                        {report.visit?.photos && (
                          <span className="flex items-center gap-1">
                            <ImageIcon className="w-3.5 h-3.5" />
                            {report.visit.photos.filter((p: any) => !p.isDirectiveOnly).length} photo(s)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {report.reportFileUrl && (
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadReportFile(report.reportFileUrl!); }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Télécharger PDF"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-s font-medium border ${getStatusColor(report.status)}`}>
                        {getStatusLabel(report.status)}
                      </span>
                      <span className="text-s text-prosps-blue font-medium">Détails →</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
