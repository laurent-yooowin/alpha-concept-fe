import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { missionsAPI, reportsAPI, usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Search, Filter, Eye, Edit2, CheckCircle, Send, Calendar, MapPin, Download, FileText, FileCheck, Clock, Loader2 } from 'lucide-react';
import { generatePdfService } from '../services/generatePdfService';
import { visitService } from '../services/visitService';
import { filesService } from '../services/filesService';
import Swal from 'sweetalert2';
import PhotoReportEditor from './PhotoReportEditor';

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
  const [cursorPos, setCursorPos] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const editedContentRef = useRef(null);
  const isAdmin = currentUser?.role === 'ROLE_ADMIN';

  useEffect(() => {
    fetchReports();
  }, []);

  // useLayoutEffect pour repositionner le curseur après le rendu
  useLayoutEffect(() => {
    if (cursorPos !== null && editedContentRef.current) {
      editedContentRef.current.selectionStart = cursorPos;
      editedContentRef.current.selectionEnd = cursorPos;
      setCursorPos(null); // reset
    }
  }, [editedContent, cursorPos]);

  const processData = (reports) => {
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

  const openViewModal = (report: Report) => {
    setSelectedReport(report);
    setPhotos(report.visit?.photos || []);
    setEditedContent(report.content || '');
    setEditedHeader(report.header || '');
    setEditedFooter(report.footer || '');
    setEditedObservations(report.observations || '');
    setAdminRemarks(report.remarquesAdmin || '');
    setIsEditing(false);
    setShowViewModal(true);
  };

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

  const handleSubmitReport = async () => {
    if (!selectedReport) return;
    const confirm = await Swal.fire({
      title: 'Soumettre le rapport',
      text: 'Voulez-vous soumettre ce rapport pour validation ?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Soumettre',
      cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    try {
      await reportsAPI.update(selectedReport.id, {
        content: editedContent,
        header: editedHeader,
        footer: editedFooter,
        observations: editedObservations,
        status: 'envoye',
      });

      Swal.fire({ icon: 'success', title: 'Rapport soumis', timer: 1500, showConfirmButton: false });
      setShowViewModal(false);
      setSelectedReport(null);
      await fetchReports();
    } catch (error) {
      console.error('Error submitting report:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la soumission' });
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedReport) return;
    setGeneratingPdf(true);
    try {
      const visitPhotos = selectedReport.visit?.photos || [];
      const photosForPdf = visitPhotos.map((photo: any) => {
        const riskLevelMap: { [key: string]: string } = {
          'faible': 'low', 'moyen': 'medium', 'eleve': 'high',
          'low': 'low', 'medium': 'medium', 'high': 'high'
        };
        const obs = photo.analysis?.observation || [];
        const recs = photo.analysis?.recommendation || [];
        const refs = photo.analysis?.references || [];
        return {
          ...photo,
          aiAnalysis: photo.analysis ? {
            observations: Array.isArray(obs) ? obs : [obs],
            recommendations: Array.isArray(recs) ? recs : [recs],
            references: Array.isArray(refs) ? refs : [refs],
            riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
            confidence: photo.analysis.confidence || 0,
          } : undefined,
          comment: photo.comment || '',
        };
      });

      const pdfData = {
        title: selectedReport.title,
        mission: selectedReport.mission,
        client: selectedReport.client,
        date: selectedReport.createdAt || '',
        conformity: selectedReport.conformityPercentage,
        header: selectedReport.header || editedHeader || '',
        content: selectedReport.content || editedContent || '',
        footer: selectedReport.footer || editedFooter || '',
        observations: selectedReport.observations || editedObservations || '',
        photos: photosForPdf,
      };

      await generatePdfService.generateReportPDF(pdfData);
      Swal.fire({ icon: 'success', title: 'PDF généré', text: 'Le PDF a été ouvert dans un nouvel onglet', timer: 2000, showConfirmButton: false });
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

  const terminateMision = async () => {
    try {
      if (selectedReport?.missionStatus === 'terminee') return;

      const hasUnsentReports = reports.some(
        r =>
          r.missionId === selectedReport?.missionId &&
          r.status !== 'envoye_au_client' &&
          r.id != selectedReport.id
      );

      // Cas : rapports non envoyés → confirmation
      if (hasUnsentReports) {
        const result = await Swal.fire({
          title: 'Attention !',
          text: `Le chantier ${selectedReport?.mission} a un ou plusieurs rapports non envoyés.

Si vous clôturez le chantier, les rapports non envoyés seront annulés.`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Oui',
          cancelButtonText: 'Non',
          confirmButtonColor: '#dc3545',
          cancelButtonColor: '#6c757d',
          reverseButtons: true,
        });

        if (!result.isConfirmed) {
          await terminateReportFn();
          return;
        } else {
          // Clôture de la mission
          await missionsAPI.update(selectedReport?.missionId, {
            status: 'terminee',
          });
          await terminateReportFn();

          // Succès
          await Swal.fire({
            title: 'Chantier clôturé',
            text: `Le chantier ${selectedReport?.mission} est clôturé.
La gestion et la modification des rapports ne sont plus autorisées pour ce chantier.`,
            icon: 'success',
          });
        }
      } else {
        // Clôture de la mission
        await missionsAPI.update(selectedReport?.missionId, {
          status: 'terminee',
        });
        await terminateReportFn();

        // Succès
        await Swal.fire({
          title: 'Chantier clôturé',
          text: `Le chantier ${selectedReport?.mission} est clôturé.
La gestion et la modification des rapports ne sont plus autorisées pour ce chantier.`,
          icon: 'success',
        });
      }



    } catch (error) {
      console.error(error);
      await terminateReportFn();
      await Swal.fire({
        title: 'Erreur',
        text: "Une erreur est survenue lors de la clôture du chantier. Veuillez réessayer.",
        icon: 'error',
      });
    }
  };

  const validateSentReport = async (clientEmail: string, reportFileUrl: string) => {
    try {
      await reportsAPI.update(selectedReport.id, {
        status: 'envoye_au_client',
        recipientEmail: clientEmail,
        reportFileUrl: reportFileUrl,
      });

      Swal.fire({
        title: 'Rapport envoyé au client',
        text: `Le rapport a été envoyé au client avec succès.`,
        icon: 'success',
        confirmButtonText: 'OK',
      }).then(async () => {
        await terminateReportFn();
      });

    } catch (error) {
      await terminateReportFn();
      Swal.fire({
        title: 'Mail envoyé !',
        text: `Erreur lors de la mise à jours du rapport, veuillez contacter le support .`,
        icon: 'error',
      });
    }

  }

  const handleSendToClient = async () => {
    if (!selectedReport || selectedReport.status == 'envoye_au_client' ||
      selectedReport.missionStatus == 'terminee' || selectedReport.missionStatus == 'archivee') return;

    let photos: any[] = [];
    try {
      // const visitResponse = await visitService.getVisit(selectedReport.visitId);
      const visitResponse = selectedReport.visit;
      // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
      if (visitResponse && visitResponse.photos) {
        visitResponse.photos
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
            const refText = photo.analysis?.references || '';

            const observations = Array.isArray(observationText) ? observationText : observationText.split('. ');
            const recommendations = Array.isArray(recommendationText) ? recommendationText : recommendationText.split('. ');
            const refs = Array.isArray(refText) ? refText : refText.split('. ');

            const ret = {
              ...photo,
              id: photo.id || `photo-${Date.now()}-${Math.random()}`,
              uri: photo.uri || photo.s3Url,
              s3Url: photo.s3Url,
              timestamp: new Date(photo.createdAt || Date.now()),
              aiAnalysis: photo.analysis ? {
                observations: observations ? observations.filter((s: string) => s.length > 0) : [],
                recommendations: recommendations ? recommendations.filter((s: string) => s.length > 0) : [],
                riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
                confidence: (photo.analysis.confidence || 0),
                references: refs ? refs.filter((s: string) => s.length > 0) : [],
              } : undefined,
              comment: photo.comment || '',
              validated: photo.validated || true
            };
            photos.push(ret);
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
        date: selectedReport.createdAt || '',
        conformity: selectedReport.conformityPercentage,
        header: selectedReport.header || '',
        content: selectedReport.content || 'Contenu non disponible',
        footer: selectedReport.footer || '',
        observations: selectedReport.observations || '',
        photos: photos,
      };

      const pdfHtml = await generatePdfService.generateReportPDF(pdfData);
      try {
        setLoading(true);

        const resp = await generatePdfService.generateWebPDFBase64(pdfHtml || '', `${pdfData.mission}.pdf`);
        if (!resp) {
          Swal.fire({
            title: 'Erreur',
            text: 'Échec de l’envoi du mail.',
            icon: 'error',
          });
          return;
        }

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
        const subject = `Rapport CSPS – ${pdfData.mission} – ${pdfData.date}`;

        const pdfUrl = (resp as any)?.url;

        const confirm = await Swal.fire({
          title: 'Confirmer l’envoi du rapport',
          text: `Voulez-vous vraiment envoyer le rapport PDF au client ${selectedReport.contactFirstName} ?`,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Oui, envoyer',
          cancelButtonText: 'Annuler',
        });

        if (!confirm.isConfirmed) {
          return;
        } else {
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
            await validateSentReport(selectedReport?.contactEmail, pdfUrl);
          } else {
            Swal.fire({
              title: 'Erreur',
              text: 'Échec de l’envoi du mail.',
              icon: 'error',
            });
          }
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

      // setShowViewModal(false);
      // setSelectedReport(null);
      // await fetchReports();
      // alert('Rapport envoyé au client avec succès');
    } catch (error) {
      console.error('Error sending report:', error);
      alert('Erreur lors de l\'envoi');
    }
  };

  // Update photo data from edited report content
  const updatePhotosFromEditedContent = (photos: any[]) => {
    const updatedPhotos: any = [];
    photos.map((photo, index) => {
      const photoSectionRegex = new RegExp(
        `Photo ${index + 1}[\\s\\S]*?(?=Photo ${index + 2}|$)`,
        'i'
      );
      const photoSection = editedContent?.match(photoSectionRegex)?.[0] || '';

      if (photoSection) {
        const obsRegex = /Observations:\s*([\s\S]*?)(?=\n\s*Recommandations:|$)/i;
        const recRegex = /Recommandations:\s*([\s\S]*?)(?=\n🏛️\s*Références|$)/i;
        const comRegex = /💬\s*Commentaires du coordonnateur:\s*([\s\S]*)/i;
        const refsRegex = /🏛️\s*Références:\s*([\s\S]*?)(?=\n💬\s*Commentaires du coordonnateur:|$)/i;

        const observationsMatch = photoSection.match(obsRegex);
        const recommendationsMatch = photoSection.match(recRegex);
        const commentsMatch = photoSection.match(comRegex);
        const refsMatch = photoSection.match(refsRegex);

        const observations = observationsMatch?.[1]
          ?.split('•')
          .map(s => s.trim().replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', ''))
          .filter(s => s.length > 0) || photo.aiAnalysis?.observations || [];

        const recommendations = recommendationsMatch?.[1]
          ?.split('•')
          .map(s => s.trim().replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', ''))
          .filter(s => s.length > 0) || photo.aiAnalysis?.recommendations || [];

        const comments = commentsMatch?.[1]?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || photo.comment?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || '';

        // const references = refsMatch?.[1].replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || photo.comment?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || '';
        const references = refsMatch?.[1]
          ?.split('•')
          .map(s => s.trim().replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', ''))
          .filter(s => s.length > 0) || photo.aiAnalysis?.references || [];

        updatedPhotos.push({
          ...photo,
          analysis: photo.analysis ? {
            riskLevel: photo.analysis.riskLevel,
            confidence: photo.analysis.confidence,
            observation: observations,
            recommendation: recommendations,
            references,
          } : undefined,
          comment: comments,
        });
      } else {
        updatedPhotos.push(photo);
      }
      return photo;
    });
    return updatedPhotos;
    // setPhotos(updatedPhotos);
  };

  const handleChange = (e) => {
    const textarea = e.target;
    const value = textarea.value;
    const cursor = textarea.selectionStart;

    // Détection d'un saut de ligne
    if (value.length > editedContent.length && value[cursor - 1] === "\n") {
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const newText = before + "• " + after;

      setEditedContent(newText);
      setCursorPos(cursor + 2); // position exacte après "• "
    } else {
      setEditedContent(value);
    }
  };

  const handleSaveEdits = async () => {
    if (!selectedReport) return;
    // let photos = [];

    try {
      // const visitResponse = await visitService.getVisit(selectedReport.visitId);
      // // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
      // if (visitResponse && visitResponse.photos) {
      //   photos = updatePhotosFromEditedContent(visitResponse.photos);
      // }
      const respReport = await reportsAPI.update(selectedReport.id, {
        content: editedContent,
        header: editedHeader,
        footer: editedFooter,
        observations: editedObservations,
        remarquesAdmin: adminRemarks,
      });

      const respVisit = await visitService.update(selectedReport.visitId, {
        photos: photos
      });

      setSelectedReport(prev => prev ? {
        ...prev,
        content: respReport?.content,
        header: respReport?.header,
        footer: respReport?.footer,
        observations: respReport?.observations,
        remarquesAdmin: respReport?.remarquesAdmin,
        sentToClientAt: respReport?.sentToClientAt,
        updatedAt: respReport?.updatedAt,
        visit: respVisit
      } : null)

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

  const downloadReportFile = async (fileUrl: string) => {
    const link = document.createElement('a');
    const response = await filesService.downloadFile(fileUrl, 'reports', true);
    console.log('response for download >>> : ', response);
    // const blob = await response.data.data.blob();
    // const url = window.URL.createObjectURL(blob);
    const { base64, contentType, fileName } = response.data;

    // convertir base64 en Uint8Array
    const byteCharacters = atob(base64); // decode base64
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    // créer le blob
    const blob = new Blob([byteArray], { type: contentType });

    // créer le lien et déclencher le téléchargement
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || `document.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  const downloadImages = async (url) => {
    try {
      const response = await filesService.downloadFile(url, 'reports', true);
      // console.log('response for download >>> : ', response);
      // const blob = await response.data.data.blob();
      // const url = window.URL.createObjectURL(blob);
      const { base64, contentType, fileName } = response.data;
      return base64;
    } catch (error) {
      console.error('Erreur lors du téléchargement de l\'image:', error);
    }

  }

  const generateEditedContent = (photosData) => {
    let content = 'OBSERVATIONS PRINCIPALES:\n';

    photosData.forEach((photo, index) => {
      const getRiskLevel = (level) => {
        const levels = { 'eleve': 'HIGH', 'moyen': 'MEDIUM', 'faible': 'LOW' };
        return levels[level] || level.toUpperCase();
      };

      content += '━'.repeat(25) + '\n';
      content += `Photo ${index + 1} - Niveau de risque: ${getRiskLevel(photo.analysis.riskLevel)}\n`;
      content += `📸 Photo: ${photo.s3Url}\n\n`;
      content += 'Observations:\n';
      content += photo.analysis.observation.map(obs => `• ${obs}`).join('\n') + '\n\n';
      content += 'Recommandations:\n';
      content += photo.analysis.recommendation.map(rec => `• ${rec}`).join('\n') + '\n\n';
      content += '🏛️ Références:\n';
      content += photo.analysis.references.map(ref => `• ${ref}`).join('\n') + '\n\n';
      content += '💬 Commentaires du coordonnateur:\n';
      content += (photo.comment || '') + '\n\n';
    });

    return content;
  };

  const handleSave = async () => {
    const updatedContent = generateEditedContent(photos);

    console.log('Photos:', photos);
    console.log('Header:', editedHeader);
    console.log('Content:', editedContent);
    console.log('Footer:', editedFooter);
    setEditedContent(updatedContent);
    // Sauvegarder dans votre backend
    setIsEditing(false);
    await handleSaveEdits();
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
                    {report.reportFileUrl && report.reportFileUrl.trim() != '' && <button onClick={() => downloadReportFile(report.reportFileUrl)}>
                      <FileText className="w-6 h-6 text-red-600 hover:scale-110 transition cursor-pointer" />
                    </button>}
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
                    className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Enregistrer
                  </button>
                </>
              ) : (
                <>
                  {/* Modifier - when not sent/terminated/cancelled */}
                  {selectedReport && selectedReport.status !== 'envoye_au_client' &&
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
                    selectedReport.status !== 'envoye_au_client' &&
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
    </div>
  );
}
