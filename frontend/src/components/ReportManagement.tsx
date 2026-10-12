import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { mailingListAPI, missionsAPI, reportsAPI, usersAPI, visitsAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Search, Filter, Eye, Edit2, CheckCircle, Send, Calendar, MapPin, Download, Loader2, Plus, X } from 'lucide-react';
import { generatePdfService } from '../services/generatePdfService';
import { filesService } from '../services/filesService';
import Swal from 'sweetalert2';
import PhotoReportEditor from './PhotoReportEditor';
import { changedReportGroups, ReportPhotoEditSource, ChangedReportGroup } from './reportEdits';
import { isFinalReportStatus } from './reportFinalStatus';
import { formatReportDate, withoutLegacyGeneratedFooterDate, withoutLegacyGeneratedHeaderDate } from './reportDatePresentation';

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
  reportFileUrl?: string | null;
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
  visit: any;
  missionStatus: string;
  missionDate: string;
  missionTime: string;
  missionType?: string;
}

interface MailingEntry {
  id: string;
  email: string;
  name?: string | null;
  missionId?: string | null;
}

export default function ReportManagement() {
  const { profile: currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [filteredReports, setFilteredReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editedHeader, setEditedHeader] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [editedFooter, setEditedFooter] = useState('');
  const [editedObservations, setEditedObservations] = useState('');
  const [adminRemarks, setAdminRemarks] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [cursorPos, setCursorPos] = useState<number | null>(null);
  const [photos, setPhotos] = useState<ReportPhotoEditSource[]>([]);
  const [savingEdits, setSavingEdits] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [showRecipientsModal, setShowRecipientsModal] = useState(false);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [mailingEntries, setMailingEntries] = useState<MailingEntry[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [newRecipientEmail, setNewRecipientEmail] = useState('');
  const [newRecipientName, setNewRecipientName] = useState('');
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [pdfFileName, setPdfFileName] = useState('');

  const editedContentRef = useRef<HTMLTextAreaElement | null>(null);
  const isAdmin = currentUser?.role === 'ROLE_ADMIN';
  const getReportMissionType = (report: Report | null) => (
    report?.missionType ||
    report?.visit?.mission?.type ||
    (report as any)?.type ||
    'SPS'
  );
  const getSuggestedPdfFileName = (report: Report) => generatePdfService.getSuggestedReportFilename({
    reportType: 'vc',
    client: report.client,
    address: report.address,
    project: report.mission || report.title,
    date: report.visit?.visitDate || report.visit?.createdAt || report.createdAt,
  });

  const normalizePdfFileName = (value: string, fallback: string) => {
    const baseName = value.trim()
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return `${baseName || fallback.replace(/\.pdf$/i, '')}.pdf`;
  };

  useEffect(() => {
    fetchReports();
  }, []);

  useEffect(() => {
    const reportId = searchParams.get('reportId');
    if (!reportId || !reports.length) return;
    const report = reports.find((candidate) => candidate.id === reportId);
    if (report) {
      openViewModal(report);
      navigate(window.location.pathname, { replace: true });
    }
  }, [reports, searchParams, navigate]);

  // useLayoutEffect pour repositionner le curseur après le rendu
  useLayoutEffect(() => {
    if (cursorPos !== null && editedContentRef.current) {
      editedContentRef.current.selectionStart = cursorPos;
      editedContentRef.current.selectionEnd = cursorPos;
      setCursorPos(null); // reset
    }
  }, [editedContent, cursorPos]);

  const processData = (reports: Report[]) => {
    return reports.map((report: Report) => {
      report.createdAt = new Date(report.createdAt).toLocaleDateString('fr-FR');

      if (report.updatedAt) {
        report.updatedAt = new Date(report.updatedAt).toLocaleDateString('fr-FR');
      }

      if (report.validatedAt) {
        report.validatedAt = new Date(report.validatedAt).toLocaleDateString('fr-FR');
      }

      if (report.sentAt) {
        report.sentAt = new Date(report.sentAt).toLocaleDateString('fr-FR');
      }

      if (report.sentToClientAt) {
        report.sentToClientAt = new Date(report.sentToClientAt).toLocaleDateString('fr-FR');
      }

      const mission: any = report.mission;
      if (mission) {
        report.title = mission.title;
        report.address = mission.address;
        report.client = mission.client;
        report.mission = mission.title;
        report.missionId = mission.id;
        report.contactEmail = mission.contactEmail;
        report.contactFirstName = mission.contactFirstName;
        report.contactLastName = mission.contactLastName;
        report.contactPhone = mission.contactPhone;
        report.missionStatus = mission.status;
        report.missionDate = mission.date;
        report.missionTime = mission.time;
        // const clientUser = usersData.find((u: any) => u.id === mission.client_id);
        // report.client = clientUser ? `${clientUser.firstName} ${clientUser.lastName}` : 'Inconnu';
      }
      // report.content = report.header + '\n' + report.content + '\n' + report.footer || '';

      return report;
    });
  }
  const fetchReports = async () => {
    setReports([]);
    setLoading(true);
    try {
      const [reportData] = await Promise.all([
        reportsAPI.getAll()
      ]);
      const reportsData = processData(reportData);
      setReports(reportsData);
      setFilteredReports(reportsData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching reports:', error);
      setLoading(false);
    }
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
          'Chantier': mission?.title || '',
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

  function openViewModal(report: Report) {
    setSelectedReport(report);
    setPhotos(report.visit?.photos || []);
    setEditedContent(report.content || '');
    setEditedHeader(withoutLegacyGeneratedHeaderDate(report.header || ''));
    setEditedFooter(withoutLegacyGeneratedFooterDate(report.footer || ''));
    setEditedObservations(report.observations || '');
    setAdminRemarks(report.remarquesAdmin || '');
    setIsEditing(false);
    setShowViewModal(true);
  }

  const handleValidateReport = async () => {
    if (!selectedReport) return;

    try {
      await reportsAPI.update(selectedReport.id, {
        content: editedContent,
        observations: editedObservations,
        remarquesAdmin: adminRemarks,
        status: 'valide',
      });

      Swal.fire({ icon: 'success', title: 'Rapport validé', timer: 1500, showConfirmButton: false });
      setShowViewModal(false);
      setSelectedReport(null);
      await fetchReports();
    } catch (error) {
      console.error('Error validating report:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la validation' });
    }
  };

  const handleDownloadRowPdf = async (report: Report, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDownloadingReportId(report.id);
    try {
      const downloaded = await generatePdfService.downloadReportPDF(report, getSuggestedPdfFileName(report));
      if (!downloaded) throw new Error('Aucun PDF disponible');
      Swal.fire({ icon: 'success', title: 'PDF téléchargé', timer: 2000, showConfirmButton: false });
    } catch (error) {
      console.error('Error generating PDF:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la génération du PDF' });
    } finally {
      setDownloadingReportId(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedReport) return;
    setGeneratingPdf(true);
    try {
      const downloaded = await generatePdfService.downloadReportPDF(selectedReport, getSuggestedPdfFileName(selectedReport));
      if (!downloaded) throw new Error('Aucun PDF disponible');
      Swal.fire({ icon: 'success', title: 'PDF téléchargé', timer: 2000, showConfirmButton: false });
    } catch (error) {
      console.error('Error generating PDF:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la génération du PDF' });
    } finally {
      setGeneratingPdf(false);
    }
  };

  const terminateReportFn = async () => {
    setShowViewModal(false);
    setSelectedReport(null);
    await fetchReports();
  }

  const validateSentReport = async () => {
    Swal.fire({
      title: 'Rapport envoyé au client',
      text: `Le rapport a été envoyé au client avec succès.`,
      icon: 'success',
      confirmButtonText: 'OK',
    }).then(async () => {
      await terminateReportFn();
    });
  };

  const handleSendToClient = async () => {
    if (!selectedReport || isFinalReportStatus(selectedReport.status) ||
      selectedReport.missionStatus == 'terminee' || selectedReport.missionStatus == 'archivee') return;
    setRecipientsLoading(true);
    setShowRecipientsModal(true);
    setRecipientSearch('');
    setNewRecipientEmail('');
    setNewRecipientName('');
    setPdfFileName(getSuggestedPdfFileName(selectedReport));
    try {
      const data = await mailingListAPI.getByMission(selectedReport.missionId);
      const entries = Array.isArray(data) ? data : [];
      setMailingEntries(entries);
      setSelectedRecipientIds(entries.map((entry: MailingEntry) => entry.id));
    } catch (error: any) {
      setMailingEntries([]);
      setSelectedRecipientIds([]);
      Swal.fire({
        title: 'Erreur',
        text: error?.message || 'Impossible de charger la liste de diffusion',
        icon: 'error',
      });
    } finally {
      setRecipientsLoading(false);
    }
  };

  const toggleRecipient = (id: string) => {
    setSelectedRecipientIds((prev) => (
      prev.includes(id) ? prev.filter((entryId) => entryId !== id) : [...prev, id]
    ));
  };

  const handleAddRecipient = async () => {
    if (!selectedReport || !newRecipientEmail.trim()) return;
    setAddingRecipient(true);
    try {
      const created = await mailingListAPI.create({
        missionId: selectedReport.missionId,
        email: newRecipientEmail.trim(),
        name: newRecipientName.trim(),
      });
      setMailingEntries((prev) => [created, ...prev]);
      setSelectedRecipientIds((prev) => [...prev, created.id]);
      setNewRecipientEmail('');
      setNewRecipientName('');
      setRecipientSearch('');
    } catch (error: any) {
      Swal.fire({
        title: 'Erreur',
        text: error?.message || "Impossible d'ajouter l'email",
        icon: 'error',
      });
    } finally {
      setAddingRecipient(false);
    }
  };

  const confirmSendToSelectedRecipients = async () => {
    if (!selectedReport) return;
    const selectedCc = mailingEntries
      .filter((entry) => selectedRecipientIds.includes(entry.id))
      .map((entry) => entry.email);
    const fileName = normalizePdfFileName(pdfFileName, getSuggestedPdfFileName(selectedReport));
    setPdfFileName(fileName);
    setShowRecipientsModal(false);
    await sendReportToClient(selectedCc, fileName);
  };

  const sendReportToClient = async (selectedCc: string[], fileName: string) => {
    if (!selectedReport || isFinalReportStatus(selectedReport.status) ||
      selectedReport.missionStatus == 'terminee' || selectedReport.missionStatus == 'archivee') return;

    try {

      try {
        setLoading(true);


        const message = `Bonjour ${selectedReport?.contactFirstName},
Veuillez trouver ci-joint le rapport de visite suivant:

Chantier: ${selectedReport?.mission}
Date d'attribution: ${selectedReport.missionDate} ${selectedReport.missionTime && selectedReport.missionTime.trim() != '' ? ' à ' + selectedReport.missionTime : ''}
Date de visite: ${new Date(selectedReport?.visit?.createdAt || '').toLocaleDateString('fr-FR')}
Adresse chantier: ${selectedReport.address} 
Nombre de photos: ${selectedReport?.visit?.photos?.length}

Le rapport complet avec les photos est disponible en pièce jointe PDF.

Cordialement.
${currentUser && `Coordonnateur: ${currentUser.firstName} ${currentUser.lastName}`}
`;
        const missionType = getReportMissionType(selectedReport);
        const subject = `Rapport ${missionType} – ${selectedReport.mission} – ${selectedReport.createdAt || ''}`;

        const response = await generatePdfService.generateStoreAndSendReportPDF(
          selectedReport.id,
          {
            fileName,
            email: selectedReport.contactEmail || '',
            subject,
            message,
            cc: selectedCc,
          },
        );

        if (response.ok || response.success) {
          await validateSentReport();
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
          text: err instanceof Error ? err.message : 'Échec de l’envoi du mail.',
          icon: 'error',
        });
      } finally {
        setLoading(false);
      }

      // setShowViewModal(false);
      // setSelectedReport(null);
      // await fetchReports();
      // alert('Rapport envoyé au client avec succès');
    } catch (error) {
      console.error('Error sending report:', error);
      alert('Erreur lors de l\'envoi');
    }
  };

  const handleSaveEdits = async (contentToSave: string, changedGroups: ChangedReportGroup[]) => {
    if (!selectedReport) return;
    setSavingEdits(true);
    try {
      if (changedGroups.length) await visitsAPI.analysisGroups.updateMany(selectedReport.visitId, changedGroups);
      await reportsAPI.update(selectedReport.id, {
        ...(changedGroups.length ? {} : { content: contentToSave }),
        header: editedHeader,
        footer: editedFooter,
        observations: editedObservations,
        remarquesAdmin: adminRemarks,
      });
      const currentReport = processData([await reportsAPI.getById(selectedReport.id)])[0];
      setSelectedReport(currentReport);
      setPhotos(currentReport.visit?.photos || []);
      setEditedContent(currentReport.content || '');
      setEditedHeader(withoutLegacyGeneratedHeaderDate(currentReport.header || ''));
      setEditedFooter(withoutLegacyGeneratedFooterDate(currentReport.footer || ''));
      setEditedObservations(currentReport.observations || '');
      setAdminRemarks(currentReport.remarquesAdmin || '');
      setIsEditing(false);
      await fetchReports();
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
    } finally {
      setSavingEdits(false);
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
      case 'annule': return 'bg-slate-100 text-red-700 border-red-200';
      case 'envoye_au_client': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'brouillon': return 'Brouillon';
      case 'envoye': return 'Soumis';
      case 'valide': return 'Validé';
      case 'annule': return 'Annulé';
      case 'envoye_au_client': return 'Envoyé au client';
      default: return status;
    }
  };

  const downloadImages = async (url: string) => {
    try {
      const response = await filesService.downloadFile(url, 'reports', true);
      // console.log('response for download >>> : ', response);
      // const blob = await response.data.data.blob();
      // const url = window.URL.createObjectURL(blob);
      const { base64, contentType } = response.data;
      return base64?.startsWith('data:image') ? base64 : `data:${contentType || 'image/jpeg'};base64,${base64}`;
    } catch (error) {
      console.error('Erreur lors du téléchargement de l\'image:', error);
    }

  }

  const handleSave = async () => {
    if (!selectedReport || savingEdits) return;
    const changedGroups = changedReportGroups(selectedReport.visit?.photos || [], photos);
    await handleSaveEdits(editedContent, changedGroups);
  };

  const filteredMailingEntries = mailingEntries.filter((entry) => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return true;
    return entry.email.toLowerCase().includes(q) || (entry.name || '').toLowerCase().includes(q);
  });

  const selectedRecipientsCount = selectedRecipientIds.length;

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
              <option value="annule">Annulé</option>
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
                <th className="text-center px-4 py-3 text-sm font-semibold text-slate-900">Fichier PDF</th>
                <th className="text-right px-6 py-3 text-sm font-semibold text-slate-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredReports.map((report) => (
                <tr key={report.id}
                  className={`${report.missionStatus == "terminee" ? 'bg-green-100 text-green-700 hover:bg-slate-50 transition-colors' : "hover:bg-slate-50 transition-colors"}`}
                  style={{ cursor: "pointer" }}
                >
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
                  <td className="px-6 py-4 items-center" style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      onClick={(e) => handleDownloadRowPdf(report, e)}
                      disabled={downloadingReportId === report.id}
                      className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                      title="Télécharger PDF"
                    >
                      {downloadingReportId === report.id ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Download className="w-5 h-5 text-blue-600 hover:scale-110 transition cursor-pointer" />
                      )}
                    </button>
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
          <div className="bg-white rounded-xl max-w-6xl w-full my-8">
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
                    <p className="text-slate-600">Date du chantier</p>
                    <p className="font-medium text-slate-900">
                      {formatReportDate(selectedReport.missionDate) || '—'}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Contenu du rapport</label>
                {isEditing ? (
                  <>
                    {/* <p className="mb-1 text-sm text-slate-500">En-tête</p>
                    <textarea
                      value={editedHeader}
                      onChange={(e) => setEditedHeader(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                    <br />
                    <p className="mb-1 text-sm text-slate-500">Contenu principal</p>
                    <textarea
                      ref={editedContentRef}
                      value={editedContent}
                      onChange={handleChange}
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
                    /> */}

                    <PhotoReportEditor
                      initialPhotos={selectedReport.visit?.photos || []}
                      downloadImages={downloadImages}
                      isEditing={isEditing}
                      editedFooter={editedFooter}
                      editedHeader={editedHeader}
                      headerDates={[
                        { label: 'Date de la visite', value: formatReportDate(selectedReport.visit?.visitDate) },
                        { label: 'Date du rapport', value: formatReportDate(selectedReport.createdAt) },
                      ]}
                      onPhotosChange={setPhotos}
                      onHeaderChange={setEditedHeader}
                      onFooterChange={setEditedFooter}
                    />
                  </>
                ) : (
                  // <div className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap text-slate-900">
                  //   {editedHeader + '\n' + editedContent + '\n' + editedFooter}
                  // </div>
                  <PhotoReportEditor
                    initialPhotos={selectedReport.visit?.photos || []}
                    downloadImages={downloadImages}
                    onSave={handleSave}
                    isEditing={isEditing}
                    editedFooter={editedFooter}
                    editedHeader={editedHeader}
                    headerDates={[
                      { label: 'Date de la visite', value: formatReportDate(selectedReport.visit?.visitDate) },
                      { label: 'Date du rapport', value: formatReportDate(selectedReport.createdAt) },
                    ]}
                  />
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

              {/* {<div>
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
                </div>} */}

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

            <div className="p-6 border-t border-slate-200 flex flex-wrap gap-3">
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

              {/* PDF Download - always available */}
              <button
                onClick={handleDownloadPdf}
                disabled={generatingPdf}
                className="flex items-center gap-2 bg-slate-700 text-white px-6 py-3 rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-50"
              >
                {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {generatingPdf ? 'Génération...' : 'Télécharger PDF'}
              </button>

              {isEditing ? (
                <>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={savingEdits}
                    className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {savingEdits ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </>
              ) : (
                <>
                  {/* Modifier - when not sent/terminated/cancelled */}
                  {selectedReport && !isFinalReportStatus(selectedReport.status) &&
                    selectedReport.status !== 'annule' &&
                    selectedReport.missionStatus !== 'terminee' &&
                    selectedReport.missionStatus !== 'archivee' &&
                    selectedReport.missionStatus !== 'annulee' && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-6 py-3 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                      >
                        <Edit2 className="w-4 h-4" />
                        Modifier
                      </button>
                    )}

                  {/* Soumettre - for brouillon status */}
                  {/* {selectedReport && selectedReport.status === 'brouillon' &&
                    selectedReport.missionStatus !== 'terminee' && (
                      <button
                        onClick={handleSubmitReport}
                        className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                      >
                        <FileCheck className="w-4 h-4" />
                        Soumettre
                      </button>
                    )} */}

                  {/* Valider - admin only, for envoye status */}
                  {selectedReport && selectedReport.status === 'envoye' && isAdmin && (
                    <button
                      onClick={handleValidateReport}
                      className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors font-medium"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Valider
                    </button>
                  )}

                  {/* Envoyer au client */}
                  {selectedReport &&
                    !isFinalReportStatus(selectedReport.status) &&
                    selectedReport.missionStatus !== 'terminee' &&
                    selectedReport.missionStatus !== 'archivee' &&
                    selectedReport.status !== 'annule' && (
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
            </div>
          </div>
        </div>
      )}

      {showRecipientsModal && selectedReport && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Liste de diffusion du chantier</h3>
                <p className="text-sm text-slate-500">
                  {selectedReport.mission} · {selectedRecipientsCount} sélectionné(s)
                </p>
              </div>
              <button
                onClick={() => setShowRecipientsModal(false)}
                disabled={loading}
                className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nom du fichier PDF</label>
                <input type="text" value={pdfFileName} onChange={(e) => setPdfFileName(e.target.value)} placeholder="rapport.pdf" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue" />
                <p className="mt-1 text-xs text-slate-500">L’extension .pdf sera ajoutée automatiquement.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={newRecipientEmail}
                    onChange={(e) => setNewRecipientEmail(e.target.value)}
                    placeholder="nouvel.email@domaine.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nom</label>
                  <input
                    type="text"
                    value={newRecipientName}
                    onChange={(e) => setNewRecipientName(e.target.value)}
                    placeholder="Nom facultatif"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddRecipient}
                  disabled={addingRecipient || !newRecipientEmail.trim()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg hover:opacity-90 text-sm disabled:opacity-60"
                >
                  {addingRecipient ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Ajouter
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  placeholder="Rechercher dans la liste..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue"
                />
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Emails de diffusion</span>
                  <button
                    type="button"
                    onClick={() => {
                      const allVisibleIds = filteredMailingEntries.map((entry) => entry.id);
                      const allVisibleSelected = allVisibleIds.every((id) => selectedRecipientIds.includes(id));
                      setSelectedRecipientIds((prev) => (
                        allVisibleSelected
                          ? prev.filter((id) => !allVisibleIds.includes(id))
                          : Array.from(new Set([...prev, ...allVisibleIds]))
                      ));
                    }}
                    className="text-sm text-prosps-blue hover:underline"
                  >
                    Tout sélectionner
                  </button>
                </div>

                {recipientsLoading ? (
                  <div className="p-8 flex justify-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : filteredMailingEntries.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    {mailingEntries.length === 0 ? 'Aucun email dans la liste de diffusion de ce chantier.' : 'Aucun email ne correspond à la recherche.'}
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {filteredMailingEntries.map((entry) => (
                      <label key={entry.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedRecipientIds.includes(entry.id)}
                          onChange={() => toggleRecipient(entry.id)}
                          className="w-4 h-4 rounded border-slate-300 text-prosps-blue focus:ring-prosps-blue"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800 truncate">{entry.email}</span>
                          {entry.name && <span className="block text-xs text-slate-500 truncate">{entry.name}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRecipientsModal(false)}
                disabled={loading}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmSendToSelectedRecipients}
                disabled={loading || recipientsLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg hover:opacity-90 text-sm disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {loading ? 'Envoi...' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
