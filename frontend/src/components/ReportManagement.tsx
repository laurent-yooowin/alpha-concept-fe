import { useState, useEffect } from 'react';
import { missionsAPI, reportsAPI, usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Search, Filter, Eye, Edit2, CheckCircle, Send, Calendar, MapPin, Download } from 'lucide-react';
import { generatePdfService } from '../services/generatePdfService';
import { visitService } from '../services/visitService';
import Swal from 'sweetalert2';

interface Report {
  id: string;
  missionId: string;
  mission: string;
  visitId: string;
  title: string;
  address: string;
  client: string;
  content: string;
  observations: string | null;
  remarquesAdmin: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
  sentAt: string | null;
  sentToClientAt: string | null;
  header: string | null;
  footer: string | null;
  contactEmail: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | number | null;
  conformityPercentage: number | null;
}

export default function ReportManagement() {
  const { profile: currentUser } = useAuth();
  const [reports, setReports] = useState < Report[] > ([]);
  const [filteredReports, setFilteredReports] = useState < Report[] > ([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState < string > ('all');
  const [selectedReport, setSelectedReport] = useState < Report | null > (null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editedHeader, setEditedHeader] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [editedFooter, setEditedFooter] = useState('');
  const [editedObservations, setEditedObservations] = useState('');
  const [adminRemarks, setAdminRemarks] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  // const [photos, setPhotos] = useState([]);

  const context = useAuth();

  const isAdmin = currentUser?.role === 'ROLE_ADMIN';

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const [reportData] = await Promise.all([
        reportsAPI.getAll()
      ]);

      reportData.map((report: Report) => {
        report.createdAt = new Date(report.createdAt).toLocaleString('fr-FR');

        if (report.updatedAt) {
          report.updatedAt = new Date(report.updatedAt).toLocaleString('fr-FR');
        }

        if (report.validatedAt) {
          report.validatedAt = new Date(report.validatedAt).toLocaleString('fr-FR');
        }

        if (report.sentAt) {
          report.sentAt = new Date(report.sentAt).toLocaleString('fr-FR');
        }

        if (report.sentToClientAt) {
          report.sentToClientAt = new Date(report.sentToClientAt).toLocaleString('fr-FR');
        }

        const mission: any = report.mission;
        if (mission) {
          report.title = mission.title;
          report.address = mission.address;
          report.client = mission.client;
          report.mission = mission.title;
          report.contactEmail = mission.contactEmail;
          report.contactFirstName = mission.contactFirstName;
          report.contactLastName = mission.contactLastName;
          report.contactPhone = mission.contactPhone;
          // const clientUser = usersData.find((u: any) => u.id === mission.client_id);
          // report.client = clientUser ? `${clientUser.firstName} ${clientUser.lastName}` : 'Inconnu';
        }
        // report.content = report.header + '\n' + report.content + '\n' + report.footer || '';

        return report;
      });

      setReports(reportData);
      setFilteredReports(reportData);
    } catch (error) {
      console.error('Error fetching reports:', error);
    }
    setLoading(false);
  };

  const exportToCSV = async () => {
    try {
      const [allMissions, allUsers] = await Promise.all([
        missionsAPI.getAll(),
        usersAPI.getAll(),
      ]);

      const csvData = filteredReports.map(report => {
        const mission = allMissions.find((m: any) => m.id === report.missionId);
        const user = mission ? allUsers.find((u: any) => u.id === mission.userId) : null;

        return {
          'Statut': report.status,
          'Mission': mission?.title || '',
          'Client': mission?.client || '',
          'Référence Client': mission?.refClient || '',
          'Adresse': mission?.address || '',
          'Date': mission?.date ? new Date(mission.date).toLocaleDateString('fr-FR') : '',
          'Heure': mission?.time || '',
          'Type': mission?.type || '',
          'Coordonnateur Prénom': user?.firstName || '',
          'Coordonnateur Nom': user?.lastName || '',
          'Email Coordonnateur': user?.email || '',
          'Conformité (%)': report.conformityPercentage || '',
          'Date Création': report.createdAt,
          'Date Validation': report.validatedAt || '',
          'Date Envoi Client': report.sentToClientAt || '',
        };
      });

      const headers = Object.keys(csvData[0] || {});
      const csvContent = [
        headers.join(','),
        ...csvData.map(row =>
          headers.map(header => {
            const value = row[header as keyof typeof row];
            const stringValue = String(value || '');
            return stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')
              ? `"${stringValue.replace(/"/g, '""')}"`
              : stringValue;
          }).join(',')
        )
      ].join('\n');

      const BOM = '\uFEFF';
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `rapports_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      Swal.fire({
        icon: 'success',
        title: 'Export réussi',
        text: `${csvData.length} rapport(s) exporté(s)`,
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      Swal.fire({
        icon: 'error',
        title: 'Erreur',
        text: 'Erreur lors de l\'export CSV',
      });
    }
  };

  const openViewModal = (report: Report) => {
    setSelectedReport(report);
    setEditedContent(report.content || '');
    setEditedHeader(report.header || '');
    setEditedFooter(report.footer || '');
    setEditedObservations(report.observations || '');
    setAdminRemarks(report.remarquesAdmin || '');
    setIsEditing(false);
    setShowViewModal(true);
  };

  const handleValidateReport = async () => {
    if (!selectedReport ) return;

    try {
      await reportsAPI.update(selectedReport.id, {
        content: editedContent,
        observations: editedObservations,
        remarquesAdmin: adminRemarks,
        status: 'valide',
      });

      setShowViewModal(false);
      setSelectedReport(null);
      fetchReports();
    } catch (error) {
      console.error('Error validating report:', error);
      alert('Erreur lors de la validation');
    }
  };

  const handleSendToClient = async () => {
    if (!selectedReport) return;
    let photos: any[] = [];
    try {
      const visitResponse = await visitService.getVisit(selectedReport.visitId);
      // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
      if (visitResponse && visitResponse.photos) {
        photos = visitResponse.photos
          .map((photo: any) => {
            const riskLevelMap: { [key: string]: 'low' | 'medium' | 'high' } = {
              'faible': 'low',
              'moyen': 'medium',
              'eleve': 'high',
              'low': 'low',
              'medium': 'medium',
              'high': 'high'
            };

            const observationText = photo.analysis?.observation || '';
            const recommendationText = photo.analysis?.recommendation || '';

            return {
              id: photo.id || `photo-${Date.now()}-${Math.random()}`,
              uri: photo.uri || photo.s3Url,
              s3Url: photo.s3Url,
              timestamp: new Date(photo.createdAt || Date.now()),
              aiAnalysis: photo.analysis ? {
                observations: observationText ? observationText.split('. ').filter((s: string) => s.length > 0) : [],
                recommendations: recommendationText ? recommendationText.split('. ').filter((s: string) => s.length > 0) : [],
                riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
                confidence: (photo.analysis.confidence || 0),
                references: photo.aiAnalysis?.references.join(', ') || ''
              } : undefined,
              comment: photo.comment || '',
              validated: photo.validated || true
            };
          });
      }
    } catch (error) {
      console.log('Could not load visit photos:', error);
    }
    try {
      const pdfData: any = {
        title: selectedReport.title,
        mission: selectedReport.mission,
        client: selectedReport.client,
        date: selectedReport.createdAt,
        conformity: selectedReport.conformityPercentage,
        header: selectedReport.header || '',
        content: selectedReport.content || 'Contenu non disponible',
        footer: selectedReport.footer || '',
        observations: selectedReport.observations || '',
        photos: photos,
      };

      const pdfHtml = await generatePdfService.generateReportPDF(pdfData);

      const confirm = await Swal.fire({
        title: 'Confirmer l’envoi du rapport',
        text: `Voulez-vous vraiment envoyer le rapport PDF au client ${selectedReport.contactFirstName} ?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Oui, envoyer',
        cancelButtonText: 'Annuler',
      });

      if (!confirm.isConfirmed) return;

      try {
        setLoading(true);

        const resp = await generatePdfService.generateWebPDFBase64(pdfHtml || '', `${pdfData.title}.pdf`);
        if (!resp) {
          Swal.fire({
            title: 'Erreur',
            text: 'Échec de l’envoi du mail.',
            icon: 'error',
          });
          return;
        }

        const message = `
          Bonjour ${pdfData.client},

          Veuillez trouver ci-joint le rapport CSPS concernant la mission ${pdfData.mission} réalisée le ${pdfData.date}.

          Nous restons à votre disposition pour toute question ou précision complémentaire.

          Cordialement,
          Alpha concept.
          ${context.profile?.firstName}
          Mail: ${context.profile?.email}
          Téléphone: ${context.profile?.phone}
          Adresse: ${context.profile?.address}      
        `;

        const subject = `Rapport CSPS – ${pdfData.mission} – ${pdfData.date}`;

        const pdfUrl = resp?.url;

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
          Swal.fire({
            title: 'Mail envoyé !',
            text: `Le rapport PDF a bien été envoyé au client ${pdfData.client}.`,
            icon: 'success',
            confirmButtonText: 'OK',
          });

          await reportsAPI.update(selectedReport.id, {
            status: 'envoye_au_client',
            // sentToClientAt: new Date().toISOString(),
          });
        } else {
          Swal.fire({
            title: 'Erreur',
            text: 'Échec de l’envoi du mail.',
            icon: 'error',
          });
        }
      } catch (err: any) {
        Swal.fire({
          title: 'Erreur',
          text: 'Échec de l’envoi du mail.',
          icon: 'error',
        });
      } finally {
        setLoading(false);
      }

      setShowViewModal(false);
      setSelectedReport(null);
      fetchReports();
      // alert('Rapport envoyé au client avec succès');
    } catch (error) {
      console.error('Error sending report:', error);
      alert('Erreur lors de l\'envoi');
    }
  };

  // Update photo data from edited report content
  const updatePhotosFromEditedContent = (photos: any[]) => {
    const updatedPhotos = photos.map((photo, index) => {
      const photoSectionRegex = new RegExp(
        `Photo ${index + 1}[\\s\\S]*?(?=Photo ${index + 2}|$)`,
        'i'
      );
      const photoSection = selectedReport?.content.match(photoSectionRegex)?.[0] || '';

      if (photoSection) {
        const obsRegex = /Observations:\s*([\s\S]*?)(?=\n\s*Recommandations:|$)/i;
        const recRegex = /Recommandations:\s*([\s\S]*?)(?=\n\s*💬|$)/i;
        const comRegex = /💬\s*Commentaires du coordonnateur:\s*([\s\S]*)/i;
        const refsRegex = /🏛️\s*Références :\s*([\s\S]*)/i;

        const observationsMatch = photoSection.match(obsRegex);
        const recommendationsMatch = photoSection.match(recRegex);
        const commentsMatch = photoSection.match(comRegex);
        const refsMatch = photoSection.match(refsRegex);

        const observations = observationsMatch?.[1]
          ?.split('•')
          .map(s => s.trim())
          .filter(s => s.length > 0) || photo.aiAnalysis?.observations || [];

        const recommendations = recommendationsMatch?.[1]
          ?.split('•')
          .map(s => s.trim())
          .filter(s => s.length > 0) || photo.aiAnalysis?.recommendations || [];

        const comments = commentsMatch?.[1]?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || photo.comment?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || '';

        const references = refsMatch?.[1].replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || photo.comment?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || '';

        return {
          ...photo,
          aiAnalysis: photo.aiAnalysis ? {
            ...photo.aiAnalysis,
            observations,
            recommendations,
            references,
          } : undefined,
          comment: comments,
        };
      }
      return photo;
    });
    return updatedPhotos;
    // setPhotos(updatedPhotos);
  };

  const handleSaveEdits = async () => {
    if (!selectedReport) return;
    let photos = [];
    
    try {
      const visitResponse = await visitService.getVisit(selectedReport.visitId);
      // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
      if (visitResponse && visitResponse.photos) {
        photos = updatePhotosFromEditedContent(visitResponse.photos);
      }
      await reportsAPI.update(selectedReport.id, {
        content: editedContent,
        header: editedHeader,
        footer: editedFooter,
        observations: editedObservations,
        remarquesAdmin: adminRemarks,
      });

      await visitService.update(visitResponse.id, {
        photos: photos
      });

      setIsEditing(false);
      fetchReports();
      Swal.fire({
        title: 'Rapport sauvegardé !',
        text: `Les modifications du rapport sont sauvegardé avec succès.`,
        icon: 'success',
        confirmButtonText: 'OK',
      });
    } catch (error) {
      console.error('Error saving edits:', error);
      Swal.fire({
        title: 'Erreur !',
        text: `Erreur lors de l\'enregistrement du rapport`,
        icon: 'error',
        confirmButtonText: 'OK',
      });
    }
  };

  const filterReports = (status: string, term: string) => {
    if (status === 'all' && term.trim() === '') {
      setFilteredReports(reports);
      return;
    }
    const reportsFilter = reports.filter(report => {
      const matchesSearch =
        report.title?.toLowerCase().includes(searchTerm?.toLowerCase()) ||
        report.client?.toLowerCase().includes(searchTerm?.toLowerCase()) ||
        report.address?.toLowerCase().includes(searchTerm?.toLowerCase());
      // || report.content?.toLowerCase().includes(searchTerm?.toLowerCase());

      const matchesStatus = status === 'all' || report.status === status;

      return matchesSearch && matchesStatus;
    });
    const reportsCopy: Report[] = [];
    Object.assign(reportsCopy, reportsFilter);
    setFilteredReports(reportsCopy);
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'brouillon': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'envoye': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'valide': return 'bg-green-100 text-green-700 border-green-200';
      case 'envoye_au_client': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'brouillon': return 'Brouillon';
      case 'envoye': return 'Soumis';
      case 'valide': return 'Validé';
      case 'envoye_au_client': return 'Envoyé au client';
      default: return status;
    }
  };

  if (loading) {
    return <div className="text-center py-12">Chargement...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Gestion des rapports</h1>
          <p className="text-slate-600 mt-1">{reports.length} rapport(s) au total</p>
        </div>
        {filteredReports.length > 0 && (
          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="w-5 h-5" />
            Exporter CSV
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par chantier, client, contenu..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); filterReports(statusFilter, e.target.value); }}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); filterReports(e.target.value, searchTerm); }}
              className="pl-10 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none appearance-none bg-white"
            >
              <option value="all">Tous les statuts</option>
              <option value="brouillon">Brouillon</option>
              <option value="envoye">Soumis</option>
              <option value="valide">Validé</option>
              <option value="envoye_au_client">Envoyé au client</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Chantier</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Client</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Date</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Statut</th>
                <th className="text-right px-6 py-3 text-sm font-semibold text-slate-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredReports.map((report) => (
                <tr key={report.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-slate-900">{report.title}</p>
                      <div className="flex items-center gap-1 text-sm text-slate-600 mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {report.address}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    {report.client}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 text-sm text-slate-700">
                      <Calendar className="w-3.5 h-3.5" />
                      {report.createdAt}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(report.status)}`}>
                      {getStatusLabel(report.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openViewModal(report)}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Voir"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showViewModal && selectedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-4xl w-full my-8">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Rapport SPS</h2>
                <p className="text-sm text-slate-600 mt-1">
                  {selectedReport.title}
                </p>
              </div>
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(selectedReport.status)}`}>
                {getStatusLabel(selectedReport.status)}
              </span>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              <div className="bg-slate-50 p-4 rounded-lg">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-600">Client</p>
                    <p className="font-medium text-slate-900">
                      {selectedReport.client}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600">Date de création</p>
                    <p className="font-medium text-slate-900">
                      {selectedReport.createdAt}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Contenu du rapport</label>
                {isEditing ? (
                  <>
                    <p className="mb-1 text-sm text-slate-500">En-tête</p>
                    <textarea
                      value={editedHeader}
                      onChange={(e) => setEditedHeader(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                    <br />
                    <p className="mb-1 text-sm text-slate-500">Contenu principal</p>
                    <textarea
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      rows={20}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                    <br />
                    <p className="mb-1 text-sm text-slate-500">Conclusion</p>
                    <textarea
                      value={editedFooter}
                      onChange={(e) => setEditedFooter(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap text-slate-900">
                    {editedHeader + '\n' + editedContent + '\n' + editedFooter}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Observations</label>
                {isEditing ? (
                  <textarea
                    value={editedObservations}
                    onChange={(e) => setEditedObservations(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  />
                ) : (
                  <div className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap text-slate-900">
                    {editedObservations || 'Aucune observation'}
                  </div>
                )}
              </div>

              {false && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Remarques administrateur</label>
                  {isEditing ? (
                    <textarea
                      value={adminRemarks}
                      onChange={(e) => setAdminRemarks(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                      placeholder="Ajoutez des remarques internes..."
                    />
                  ) : (
                    <div className="p-4 bg-amber-50 rounded-lg whitespace-pre-wrap text-slate-900 border border-amber-200">
                      {adminRemarks || 'Aucune remarque'}
                    </div>
                  )}
                </div>
              )}

              {selectedReport.validatedAt && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-900">
                    <strong>Validé le:</strong> {selectedReport.validatedAt}
                  </p>
                </div>
              )}

              {selectedReport.sentToClientAt && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <p className="text-sm text-emerald-900">
                    <strong>Envoyé au client le:</strong> {selectedReport.sentToClientAt}
                  </p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-200 flex gap-3">
              <button
                onClick={() => {
                  setShowViewModal(false);
                  setSelectedReport(null);
                  setIsEditing(false);
                }}
                className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
              >
                Fermer
              </button>

              {true && (
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
                        {selectedReport && selectedReport.status !== 'envoye_au_client' && (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-6 py-3 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                        >
                          <Edit2 className="w-4 h-4" />
                          Modifier
                        </button>
                      )}

                      {/* {selectedReport.status === 'envoye' && isAdmin && false && (
                        <button
                          onClick={handleValidateReport}
                          className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors font-medium"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Valider
                        </button>
                      )} */}

                        {selectedReport && !isAdmin && selectedReport.status !== 'envoye_au_client' && (
                        <button
                          onClick={handleSendToClient}
                          className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium"
                        >
                          <Send className="w-4 h-4" />
                          Envoyer au client
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
