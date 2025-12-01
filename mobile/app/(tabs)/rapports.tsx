import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Dimensions,
  Modal,
  ImageBackground,
  Alert,
  Image,
  ActivityIndicator,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { Search, Filter, Download, Send, FileText, Calendar, Building, CircleCheck as CheckCircle, Clock, TriangleAlert as AlertTriangle, Eye, Share, Sparkles, ArrowRight, ChevronDown, X, Edit, Mail, FileCheck } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { reportService, ReportStatus } from '@/services/reportService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getReportStatusInfo } from '@/utils/missionHelpers';
import * as Linking from 'expo-linking';
import { pdfService } from '@/services/pdfService';
import { visitService } from '@/services/visitService';
import { useAuth } from '@/contexts/AuthContext';

import * as MailComposer from 'expo-mail-composer';
import { uploadService } from '@/services/uploadService';
import { Mission } from '../../services/missionService';
import { useLocalSearchParams } from 'expo-router';

const { width } = Dimensions.get('window');

export default function RapportsScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('tous');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [reports, setReports] = useState < any[] > ([]);
  const [loading, setLoading] = useState(true);
  const [reportCounts, setReportCounts] = useState({
    brouillon: 0,
    envoye: 0,
    archive: 0,
  });
  const [selectedReport, setSelectedReport] = useState < any | null > (null);
  const [selectedMission, setSelectedMission] = useState < any | null > (null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedReportPhotos, setSelectedReportPhotos] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editedHeader, setEditedHeader] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [editedFooter, setEditedFooter] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showPdfLoadingModal, setShowPdfLoadingModal] = useState(false);
  const [pdfLoadingProgress, setPdfLoadingProgress] = useState('Préparation du document...');

  useEffect(() => {
    loadReports();
    loadReportCounts();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReports();
      loadReportCounts();
    }, [])
  );

  useEffect(() => {
    let missionData;
    if (params.mission) {
      try {
        missionData = JSON.parse(params.mission as string);
        console.log('Params missionData >>> : ', missionData);
        setSelectedMission(missionData);
      } catch (error) {
        console.error('Erreur parsing mission:', error);
      }
    }
    loadReports(missionData);
    loadReportCounts();
  }, [params.mission]);

  const loadReports = async (missionData?: Mission | null) => {
    try {
      setLoading(true);
      const response = await reportService.getReports();
      let missionExists = false;
      let selectedReportMission = null;

      if (response.data && Array.isArray(response.data)) {
        const backendReports = await Promise.all(
          response.data.map(async (report: any) => {
            const statusInfo = getReportStatusInfo(report.status);
            let nbrPhotos = 0;
            let anomalies = 0;
            if (report.visitId) {
              const photos = await visitService.getVisit(report.visitId).then(res => res.data.photos).catch(() => []);
              nbrPhotos = photos.length;
              photos.forEach((photo: any) => {
                if (photo.analysis && photo.analysis.riskLevel && (photo.analysis.riskLevel.toLowerCase() === 'eleve' || photo.analysis.riskLevel.toLowerCase() === 'high')) {
                  anomalies += 1;
                }
              });

            }
            const reportRet = {
              id: report.id,
              visitId: report.visitId,
              title: report.title,
              mission: report.mission?.title || 'Mission inconnue',
              client: report.mission?.client || 'Client inconnu',
              date: new Date(report.createdAt).toISOString().split('T')[0],
              status: report.status || 'brouillon',
              originalStatus: report.status || 'brouillon',
              type: report.mission?.type,
              pages: Math.ceil(report.content.length / 500),
              photos: nbrPhotos || 0,
              anomalies: anomalies,
              conformity: report.conformityPercentage,
              aiGenerated: true,
              gradient: statusInfo.gradient,
              backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
              reportContent: report.content,
              reportHeader: report.header,
              reportFooter: report.footer,
              observations: report.observations,
              reportFileUrl: report.reportFileUrl,
              validatedAt: report.validatedAt,
              sentToClientAt: report.sentToClientAt,
              location: report.mission.address,
              dateMission: report.mission.date,
              timeMission: report.mission.time,
              contact: {
                firstName: report.mission.contactFirstName,
                lasstName: report.mission.contactLastName,
                email: report.mission.contactEmail,
                phone: report.mission.contactPhone,
              }
            };
            if (missionData && report.mission.id == missionData.id) {
              missionExists = true;
              setSelectedReport(reportRet);
              selectedReportMission = reportRet;
            }
            return reportRet;
          }));

        // Load local reports as well
        const localReports = await AsyncStorage.getItem('userReports');
        const parsedLocalReports = localReports ? JSON.parse(localReports) : [];

        // setReports([...backendReports, ...parsedLocalReports]);
        setReports([...backendReports]);
        if (missionExists && selectedReportMission) {
          console.log('selectedReportMission >>> : ', selectedReportMission);
          openReportDetail(selectedReportMission);
        }
      } else {
        // Load only local reports if backend fails
        const localReports = await AsyncStorage.getItem('userReports');
        const parsedLocalReports = localReports ? JSON.parse(localReports) : [];
        setReports([]);
      }
    } catch (error) {
      console.log('Error loading reports:', error);
      // Load local reports as fallback
      const localReports = await AsyncStorage.getItem('userReports');
      const parsedLocalReports = localReports ? JSON.parse(localReports) : [];
      setReports(parsedLocalReports);
    } finally {
      setLoading(false);
    }
  };

  const loadReportCounts = async () => {
    try {
      const response = await reportService.getReportCounts();
      if (response.data) {
        setReportCounts(response.data);
      }
    } catch (error) {
      console.log('Error loading report counts:', error);
    }
  };

  const handleModifyReport = () => {
    if (selectedReport) {
      setEditedHeader(selectedReport.reportHeader || '');
      setEditedContent(selectedReport.reportContent || '');
      setEditedFooter(selectedReport.reportFooter || '');
      setShowEditModal(true);
    }
  };

  const handleSaveModifications = async () => {
    if (!selectedReport) return;

    try {
      setIsSaving(true);
      await reportService.updateReport(selectedReport.id, {
        header: editedHeader,
        content: editedContent,
        footer: editedFooter,
        status: 'brouillon',
      });

      if (selectedReport.visitId) {
        try {
          const visitResponse = await visitService.getVisit(selectedReport.visitId);
          if (visitResponse.data && visitResponse.data.photos) {
            const updatedPhotos = visitResponse.data.photos.map((photo: any, index: number) => {
              const photoSectionRegex = new RegExp(
                `Photo ${index + 1}[\\s\\S]*?(?=Photo ${index + 2}|$)`,
                'i'
              );
              const photoSection = editedContent.match(photoSectionRegex)?.[0] || '';

              // console.log('photoSection >>> :', photoSection);

              if (photoSection) {
                const obsRegex = /Observations:\s*([\s\S]*?)(?=\n\s*Recommandations:|$)/i;
                const recRegex = /Recommandations:\s*([\s\S]*?)(?=\n\s*💬|$)/i;
                const comRegex = /💬\s*Commentaires du coordonnateur:\s*([\s\S]*)/i;

                const observationsMatch = photoSection.match(obsRegex);
                const recommendationsMatch = photoSection.match(recRegex);
                const commentsMatch = photoSection.match(comRegex);

                const observations = observationsMatch?.[1]
                  ?.split('•')
                  .map(s => s.trim())
                  .filter(s => s.length > 0)
                  .join(', ') || photo.analysis?.observation || '';

                const recommendations = recommendationsMatch?.[1]
                  ?.split('•')
                  .map(s => s.trim())
                  .filter(s => s.length > 0)
                  .join(', ') || photo.analysis?.recommendation || '';

                const comments = commentsMatch?.[1]?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || photo.comment?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || '';

                // console.log('observationsMatch >>> :', observations);
                // console.log('recommendationsMatch >>> :', recommendations);
                // console.log('commentsMatch >>> :', comments);

                return {
                  ...photo,
                  analysis: {
                    ...photo.analysis,
                    observation: observations,
                    recommendation: recommendations,
                  },
                  comment: comments,
                };
              }

              return photo;
            });

            const visitNotes = updatedPhotos
              .map((p: any) => p.comment)
              .filter((c: string) => c)
              .join('\n\n');


            await visitService.updateVisit(selectedReport.visitId, {
              photos: updatedPhotos,
              notes: visitNotes,
            });
          }
        } catch (visitError) {
          console.log('Note: Could not update related visit:', visitError);
        }
      }

      Alert.alert('Succès', 'Le rapport a été modifié avec succès.');
      setShowEditModal(false);
      loadReports();
    } catch (error) {
      console.error('Error updating report:', error);
      Alert.alert('Erreur', 'Impossible de modifier le rapport.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleValidateReport = async () => {
    if (!selectedReport) return;

    try {
      await reportService.validateReport(selectedReport.id);
      Alert.alert('Succès', 'Le rapport a été validé avec succès.');
      setShowReportModal(false);
      loadReports();
    } catch (error) {
      console.error('Error validating report:', error);
      Alert.alert('Erreur', 'Impossible de valider le rapport.');
    }
  };

  const uploadReportFile = async (pdfPath: any) => {
    try {
      let fileToUpload: Blob | string;
      let fileName: string = "report_" + Date.now() + ".pdf";

      if (Platform.OS === 'web') {
        // Web: Use fetch to get blob
        const response = await fetch(pdfPath);
        fileToUpload = await response.blob();
      } else {
        // Mobile: Pass URI directly, FormData will handle it
        fileToUpload = pdfPath;
      }
      if (selectedReport && selectedReport.title) {
        fileName = `report_${selectedReport.title}_${Date.now()}.pdf`;
      }
      const response = await uploadService.uploadReportsFile(pdfPath, fileName);
      // console.log('uploadReportFile response >>> : ', response);
      return response;
    } catch (error) {
      console.error('Error uploading report file:', error);
      return null;
    }
  }

  const handleSendReport = async () => {
    if (!selectedReport) return;
    if (selectedReport.status == 'valide' || selectedReport.status == 'envoye_au_client') {
      Alert.alert('Rapport déjà envoyé', 'Vous ne pouvez pas modifier ni envoyer le rapport.');
      return;
    }

    let adminEmail = selectedReport.contact.email;
    const subject = `Rapport SPS: ${selectedReport.title}`;

    try {
      setShowPdfLoadingModal(true);
      setPdfLoadingProgress('Préparation du document...');

      let photos: any[] = [];
      let visitResponse;
      // console.log('selectedReport >>> : ', selectedReport);
      if (selectedReport.visitId) {
        try {
          visitResponse = await visitService.getVisit(selectedReport.visitId);
          // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
          if (visitResponse.data && visitResponse.data.photos) {
            photos = visitResponse.data.photos
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
                    confidence: (photo.analysis.confidence || 0)
                  } : undefined,
                  comment: photo.comment || '',
                  validated: photo.validated || true
                };
              });
          }
        } catch (error) {
          console.log('Could not load visit photos:', error);
        }
      }

      setPdfLoadingProgress('Chargement des photos...');

      const pdfData: any = {
        title: selectedReport.title,
        mission: selectedReport.mission,
        client: selectedReport.client,
        date: selectedReport.date,
        conformity: selectedReport.conformity,
        header: selectedReport.reportHeader || '',
        content: selectedReport.reportContent || 'Contenu non disponible',
        footer: selectedReport.reportFooter || '',
        photos: photos,
      };

      setPdfLoadingProgress('Génération du PDF...');

      const pdfPath = await pdfService.generateReportPDF(pdfData);
      const response = await uploadReportFile(pdfPath);
      let reportFileUrl = '';
      if (response) {
        reportFileUrl = response.url || '';
      }
      // console.log('Generated PDF at:', pdfPath, 'Uploaded to:', reportFileUrl);
      const resp = await reportService.updateReport(selectedReport.id, {
        status: 'envoye_au_client' as ReportStatus,
        recipientEmail: adminEmail,
        reportFileUrl: reportFileUrl,
      });
      // console.log('Report update response after upload:', resp);

      setPdfLoadingProgress('Finalisation...');

      const body = `Bonjour ${selectedReport?.contact.firstName},
Veuillez trouver ci-joint le rapport de visite suivant:

Mission: ${selectedReport?.title}
Date d'attribution: ${selectedReport.dateMission} à ${selectedReport.timeMission}
Date de visite: ${new Date(visitResponse?.data?.createdAt || '').toLocaleString('fr-FR')}
Adresse chantier: ${selectedReport.location} 
Conformité: ${selectedReport.conformity} %
Nombre de photos: ${visitResponse?.data?.photos?.length}

Le rapport complet avec les photos est disponible en pièce jointe PDF.

Cordialement.
${user && `Cordonnateur: ${user.firstName} ${user.lastName}`}
`;

      // const mailtoUrl = pdfService.createMailtoLinkWithAttachment(
      //   adminEmail,
      //   subject,
      //   body,
      //   pdfPath || undefined
      // );

      // await Linking.openURL(mailtoUrl);

      // 4️⃣ Vérifier si MailComposer est disponible
      const isAvailable = await MailComposer.isAvailableAsync();
      if (!isAvailable) {
        console.warn('📧 MailComposer non disponible sur cet appareil.');
        // return pdfPath;
      }

      // 5️⃣ Préparer l’email avec texte pré-rempli et pièce jointe
      const mailOptions = {
        recipients: [adminEmail],
        subject: subject,
        body: body,

      };

      if (pdfPath) {
        mailOptions.attachments = [pdfPath] // pièce jointe
      }

      // 6️⃣ Ouvrir le mail ready-to-send
      await MailComposer.composeAsync(mailOptions);

      console.log('📤 Email prêt à être envoyé !');

      setShowPdfLoadingModal(false);
      loadReports();
      setShowReportModal(false);
    } catch (error) {
      console.error('Error sending report:', error);
      setShowPdfLoadingModal(false);
      Alert.alert('Erreur', "Impossible d'ouvrir l'application mail.");
    }
  };

  const getFilterCounts = () => {
    return {
      tous: reports.length,
      envoye: reports.filter(r => r.originalStatus === 'envoye').length,
      brouillon: reports.filter(r => r.originalStatus === 'brouillon').length,
      valide: reports.filter(r => r.originalStatus === 'valide').length,
      rejete: reports.filter(r => r.originalStatus === 'rejete').length,
    };
  };

  const filterCounts = getFilterCounts();

  const filters = [
    { id: 'tous', label: 'Tous les rapports', count: filterCounts.tous, color: '#8B5CF6', icon: FileText, gradient: ['#8B5CF6', '#7C3AED'] },
    { id: 'envoye_au_client', label: 'Envoyés', count: filterCounts.envoye, color: '#10B981', icon: Send, gradient: ['#10B981', '#059669'] },
    // { id: 'envoye', label: 'Envoyés', count: filterCounts.envoye, color: '#10B981', icon: Send, gradient: ['#10B981', '#059669'] },
    { id: 'brouillon', label: 'En cours', count: filterCounts.brouillon, color: '#F59E0B', icon: Clock, gradient: ['#F59E0B', '#D97706'] },
    { id: 'valide', label: 'Validés', count: filterCounts.valide, color: '#3B82F6', icon: CheckCircle, gradient: ['#3B82F6', '#2563EB'] },
    { id: 'rejete', label: 'Refusés', count: filterCounts.rejete, color: '#EF4444', icon: X, gradient: ['#EF4444', '#DC2626'] },
  ];

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'envoye_au_client':
        return { label: 'Envoyé', color: '#10B981', icon: Send };
      case 'envoye':
        return { label: 'Envoyé', color: '#10B981', icon: Send };
      case 'brouillon':
        return { label: 'En cours', color: '#F59E0B', icon: Clock };
      case 'valide':
        return { label: 'Validé', color: '#3B82F6', icon: CheckCircle };
      case 'rejete':
        return { label: 'Refusé', color: '#EF4444', icon: X };
      default:
        return { label: 'En cours', color: '#F59E0B', icon: Clock };
    }
  };

  const filteredRapports = reports.filter(rapport => {
    const matchesSearch = rapport.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rapport.mission.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rapport.client.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter = activeFilter === 'tous' || rapport.originalStatus === activeFilter;

    return matchesSearch && matchesFilter;
  });
  const updatedFilters = filters.map(filter => ({
    ...filter,
    count: filterCounts[filter.id as keyof typeof filterCounts] || 0
  }));

  const activeFilterData = updatedFilters.find(f => f.id === activeFilter);
  const ActiveFilterIcon = activeFilterData?.icon || FileText;

  const handleFilterSelect = (filterId: string) => {
    setActiveFilter(filterId);
    setShowFilterMenu(false);
  };

  const openReportDetail = async (report: any) => {
    console.log('report modal >>>> : ', report);
    let photos: any[] = [];
    if (report?.visitId) {
      try {
        const visitResponse = await visitService.getVisit(report.visitId);
        // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
        if (visitResponse.data && visitResponse.data.photos) {
          photos = await Promise.all(visitResponse.data.photos
            .map(async (photo: any) => {
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

              // 📁 Chemin local prévu pour cette image
              const fileName = photo.uri.split('/').pop();
              const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

              const imgResp = await uploadService.downloadFile(photo.s3Url, '/visits', true);
              // console.log('photo.uri Avant >>> : ', photo.uri);
              if (imgResp && imgResp.data && imgResp.data.data) {
                // 💾 Sauvegarde localement
                await FileSystem.writeAsStringAsync(fileUri, imgResp.data.data.base64, {
                  encoding: FileSystem.EncodingType.Base64,
                });
                const info = await FileSystem.getInfoAsync(fileUri);
                if (!info?.exists) {
                  console.log("Photo uri dosn't exist >>> : ", fileUri);
                } else {
                  console.log("Photo uri exist in >>> : ", fileUri);
                }
                photo.uri = fileUri;
                // console.log('photo.uri >>> : ', photo.uri);
              } else {
                Alert.alert("La photo n'a pas pu être telechargé");
              }

              return {
                id: photo.id || `photo-${Date.now()}-${Math.random()}`,
                uri: fileUri || photo.s3Url,
                s3Url: photo.s3Url,
                timestamp: new Date(photo.createdAt || Date.now()),
                aiAnalysis: photo.analysis ? {
                  observations: observationText ? observationText.split('. ').filter((s: string) => s.length > 0) : [],
                  recommendations: recommendationText ? recommendationText.split('. ').filter((s: string) => s.length > 0) : [],
                  riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
                  confidence: (photo.analysis.confidence || 0)
                } : undefined,
                comment: photo.comment || '',
                validated: photo.validated || true
              };
            }));
        }
      } catch (error) {
        console.log('Could not load visit photos:', error);
      }
    }
    setSelectedReportPhotos(photos);
    setSelectedReport(report);
    setShowReportModal(true);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MES RAPPORTS</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Search size={20} color="#64748B" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un rapport..."
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Filter Dropdown */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={styles.filterDropdown}
          onPress={() => setShowFilterMenu(true)}
        >
          <LinearGradient
            colors={activeFilterData ? [activeFilterData.color, activeFilterData.color + 'CC'] : ['#1E293B', '#374151']}
            style={styles.filterDropdownGradient}
          >
            <View style={styles.filterDropdownContent}>
              <View style={styles.filterDropdownLeft}>
                <View style={styles.filterDropdownIcon}>
                  <ActiveFilterIcon size={16} color="#FFFFFF" />
                </View>
                <View>
                  <Text style={styles.filterDropdownText}>{activeFilterData?.label}</Text>
                  <Text style={styles.filterDropdownCount}>{filteredRapports.length} rapport{filteredRapports.length > 1 ? 's' : ''}</Text>
                </View>
              </View>
              <ChevronDown size={20} color="#FFFFFF" />
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Rapports List */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {filteredRapports.length === 0 ? (
          <View style={styles.emptyState}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.emptyStateGradient}
            >
              <FileText size={48} color="#64748B" />
              <Text style={styles.emptyStateTitle}>AUCUN RAPPORT</Text>
              <Text style={styles.emptyStateText}>
                {activeFilter === 'tous'
                  ? 'Aucun rapport ne correspond à votre recherche'
                  : `Aucun rapport ${activeFilter === 'envoye' ? 'envoyé' :
                    activeFilter === 'brouillon' ? 'en brouillon' :
                      activeFilter === 'archive' ? 'archivé' : ''
                  }`
                }
              </Text>
            </LinearGradient>
          </View>
        ) : (
          filteredRapports.map((rapport) => {
            const statusInfo = getStatusInfo(rapport.status);
            const StatusIcon = statusInfo.icon;

            return (
              <TouchableOpacity
                key={rapport.id}
                style={styles.rapportCard}
                onPress={() => {
                  openReportDetail(rapport);
                }}
              >
                <LinearGradient
                  colors={rapport.gradient}
                  style={styles.rapportGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <ImageBackground
                    source={{ uri: rapport.backgroundImage }}
                    style={styles.rapportBackground}
                    imageStyle={styles.rapportBackgroundImage}
                  >
                    <View style={styles.rapportOverlay}>
                      {/* Header */}
                      <View style={styles.rapportHeader}>
                        <View style={styles.rapportTitleContainer}>
                          <View style={styles.titleRow}>
                            <Text style={styles.rapportTitle}>{rapport.title}</Text>
                          </View>
                          <Text style={styles.rapportMission}>{rapport.mission}</Text>
                          <View style={styles.clientContainer}>
                            <Building size={10} color="#FFFFFF" />
                            <Text style={styles.rapportClient}>{rapport.client}</Text>
                          </View>
                        </View>

                        <LinearGradient
                          colors={rapport.originalStatus ? getReportStatusInfo(rapport.originalStatus).gradient : ['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.1)']}
                          style={styles.statusBadge}
                        >
                          <StatusIcon size={10} color="#FFFFFF" />
                          <Text style={styles.statusText}>{statusInfo.label}</Text>
                        </LinearGradient>
                      </View>

                      {/* Stats */}
                      <View style={styles.rapportStats}>
                        <View style={styles.statItem}>
                          <FileText size={12} color="#FFFFFF" />
                          <Text style={styles.statText}>{rapport.pages} pages</Text>
                        </View>

                        <View style={styles.statItem}>
                          <Text style={styles.statNumber}>{rapport.photos}</Text>
                          <Text style={styles.statText}>photos</Text>
                        </View>

                        <View style={styles.statItem}>
                          <AlertTriangle size={12} color={rapport.anomalies > 0 ? '#FFFFFF' : 'rgba(255,255,255,0.6)'} />
                          <Text style={[styles.statText, rapport.anomalies > 0 && { opacity: 1 }]}>
                            {rapport.anomalies} anomalie{rapport.anomalies > 1 ? 's' : ''}
                          </Text>
                        </View>
                        {rapport.aiGenerated && (
                          <View style={styles.aiBadge}>
                            <Sparkles size={10} color="#FFFFFF" />
                            <Text style={styles.aiText}>IA</Text>
                          </View>
                        )}
                      </View>

                      {/* Conformity */}
                      <View style={styles.conformitySection}>
                        <View style={styles.conformityHeader}>
                          <Text style={styles.conformityLabel}>CONFORMITÉ</Text>
                          <Text style={styles.conformityValue}>{rapport.conformity}%</Text>
                        </View>
                        <View style={styles.conformityBar}>
                          <View
                            style={[
                              styles.conformityFill,
                              { width: `${rapport.conformity}%` }
                            ]}
                          />
                        </View>
                      </View>

                      {/* Footer */}
                      <View style={styles.rapportFooter}>
                        <View style={styles.rapportMeta}>
                          <Calendar size={10} color="#FFFFFF" />
                          <Text style={styles.metaText}>
                            {new Date(rapport.date).toLocaleDateString('fr-FR', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </Text>
                          <Text style={styles.rapportType}>{rapport.type}</Text>
                        </View>

                        <ArrowRight size={16} color="#FFFFFF" />
                      </View>
                    </View>
                  </ImageBackground>
                </LinearGradient>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Filter Menu Modal */}
      <Modal
        visible={showFilterMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFilterMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFilterMenu(false)}
        >
          <View style={styles.filterMenu}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.filterMenuGradient}
            >
              <View style={styles.filterMenuHeader}>
                <Text style={styles.filterMenuTitle}>FILTRER LES RAPPORTS</Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setShowFilterMenu(false)}
                >
                  <X size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <View style={styles.filterMenuDescription}>
                <Text style={styles.filterMenuDescriptionText}>
                  Sélectionnez un statut pour filtrer vos rapports
                </Text>
              </View>

              {updatedFilters.map((filter) => {
                const FilterIcon = filter.icon;
                const isActive = activeFilter === filter.id;

                return (
                  <TouchableOpacity
                    key={filter.id}
                    style={[
                      styles.filterMenuItem,
                      isActive && styles.filterMenuItemActive
                    ]}
                    onPress={() => handleFilterSelect(filter.id)}
                  >
                    {isActive ? (
                      <LinearGradient
                        colors={filter.gradient}
                        style={styles.filterMenuItemGradient}
                      >
                        <View style={styles.filterMenuItemContent}>
                          <View style={styles.filterMenuItemLeft}>
                            <View style={styles.filterMenuIconActive}>
                              <FilterIcon size={20} color="#FFFFFF" />
                            </View>
                            <View style={styles.filterMenuTextContainer}>
                              <Text style={styles.filterMenuItemTextActive}>{filter.label}</Text>
                              <Text style={styles.filterMenuItemSubtextActive}>
                                {filter.count} rapport{filter.count !== 1 ? 's' : ''}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.filterMenuBadgeActive}>
                            <Text style={styles.filterMenuBadgeTextActive}>{filter.count}</Text>
                          </View>
                        </View>
                      </LinearGradient>
                    ) : (
                      <View style={styles.filterMenuItemContent}>
                        <View style={styles.filterMenuItemLeft}>
                          <View style={[styles.filterMenuIcon, { backgroundColor: filter.color + '20' }]}>
                            <FilterIcon size={20} color={filter.color} />
                          </View>
                          <View style={styles.filterMenuTextContainer}>
                            <Text style={styles.filterMenuItemText}>{filter.label}</Text>
                            <Text style={styles.filterMenuItemSubtext}>
                              {filter.count} rapport{filter.count !== 1 ? 's' : ''}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.filterMenuBadge, { backgroundColor: filter.color + '30' }]}>
                          <Text style={[styles.filterMenuBadgeText, { color: filter.color }]}>{filter.count}</Text>
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </LinearGradient>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report Detail Modal */}
      <Modal visible={showReportModal} animationType="slide" transparent>
        <View style={styles.reportDetailModalOverlay}>
          <View style={styles.reportDetailModal}>
            {selectedReport && (
              <>
                <LinearGradient
                  colors={selectedReport.gradient}
                  style={styles.reportDetailHeader}
                >
                  <View style={styles.reportDetailHeaderContent}>
                    <View style={styles.reportDetailHeaderLeft}>
                      <FileText size={24} color="#FFFFFF" />
                      <View style={styles.reportDetailHeaderText}>
                        <Text style={styles.reportDetailTitle}>{selectedReport.title}</Text>
                        <Text style={styles.reportDetailSubtitle}>{selectedReport.mission}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.closeReportDetailButton}
                      onPress={() => setShowReportModal(false)}
                    >
                      <X size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                </LinearGradient>

                <ScrollView style={styles.reportDetailContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.reportDetailSection}>
                    <View style={styles.reportDetailInfoRow}>
                      <View style={styles.reportDetailInfoItem}>
                        <Building size={16} color="#64748B" />
                        <Text style={styles.reportDetailInfoLabel}>Client</Text>
                        <Text style={styles.reportDetailInfoValue}>{selectedReport.client}</Text>
                      </View>
                      <View style={styles.reportDetailInfoItem}>
                        <Calendar size={16} color="#64748B" />
                        <Text style={styles.reportDetailInfoLabel}>Date</Text>
                        <Text style={styles.reportDetailInfoValue}>{selectedReport.date}</Text>
                      </View>
                    </View>

                    <View style={styles.reportDetailInfoRow}>
                      <View style={styles.reportDetailInfoItem}>
                        <FileText size={16} color="#64748B" />
                        <Text style={styles.reportDetailInfoLabel}>Pages</Text>
                        <Text style={styles.reportDetailInfoValue}>{selectedReport.pages}</Text>
                      </View>
                      <View style={styles.reportDetailInfoItem}>
                        <Eye size={16} color="#64748B" />
                        <Text style={styles.reportDetailInfoLabel}>Conformité</Text>
                        <Text style={styles.reportDetailInfoValue}>{selectedReport.conformity}%</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.reportDetailDivider} />

                  <View style={styles.reportDetailSection}>
                    <Text style={styles.reportDetailSectionTitle}>CONTENU DU RAPPORT</Text>

                    {selectedReport.reportHeader && (
                      <View style={styles.reportDetailContentBox}>
                        {/* <Text style={styles.reportDetailSubtitle}>EN-TÊTE</Text> */}
                        <Text style={styles.reportDetailContentText}>
                          {selectedReport.reportHeader}
                        </Text>
                      </View>
                    )}

                    {(!selectedReportPhotos || selectedReportPhotos?.length == 0) &&
                      <View style={styles.reportDetailContentBox}>
                        <Text style={styles.reportDetailSubtitle}>OBSERVATIONS</Text>
                        <Text style={styles.reportDetailContentText}>
                          {selectedReport.reportContent || 'Aucun contenu disponible pour ce rapport.'}
                        </Text>
                      </View>
                    }

                    {(selectedReportPhotos?.length > 0) &&
                      <View style={styles.reportPhotoContainer}>
                        {selectedReportPhotos.map((photo: any, index) => {
                          const getRiskColor = (risk: string) => {
                            const level = risk?.toLowerCase();
                            if (level === 'high' || level === 'eleve') return '#EF4444';
                            if (level === 'medium' || level === 'moyen') return '#F59E0B';
                            if (level === 'low' || level === 'faible') return '#10B981';
                            return '#64748B';
                          };

                          const getRiskLabel = (risk: string) => {
                            const level = risk?.toLowerCase();
                            if (level === 'high' || level === 'eleve') return 'ÉLEVÉ';
                            if (level === 'medium' || level === 'moyen') return 'MOYEN';
                            if (level === 'low' || level === 'faible') return 'FAIBLE';
                            return 'N/A';
                          };

                          const riskLevel = photo.aiAnalysis?.riskLevel || 'moyen';
                          const riskColor = getRiskColor(riskLevel);
                          const riskLabel = getRiskLabel(riskLevel);

                          return (
                            <View key={photo.id} style={styles.reportPhotoCard}>
                              <View style={styles.reportPhotoHeader}>
                                <Text style={styles.reportPhotoNumber}>📸 Photo {index + 1}</Text>
                                <View style={[styles.reportRiskBadge, { backgroundColor: riskColor }]}>
                                  <Text style={styles.reportRiskBadgeText}>{riskLabel}</Text>
                                </View>
                              </View>

                              <View style={styles.reportPhotoImageContainer}>
                                <Image
                                  source={{ uri: photo.uri }}
                                  style={styles.reportPhotoImage}
                                  resizeMode="cover"
                                />
                              </View>

                              {photo.aiAnalysis && (
                                <View style={styles.reportAnalysisSection}>
                                  <View style={styles.reportAnalysisBlock}>
                                    <Text style={styles.reportAnalysisTitle}>🔍 Observations</Text>
                                    <View style={styles.reportAnalysisList}>
                                      {photo.aiAnalysis.observations.map((obs, i) => (
                                        <Text key={i} style={styles.reportAnalysisItem}>• {obs}</Text>
                                      ))}
                                    </View>
                                  </View>

                                  <View style={styles.reportAnalysisBlock}>
                                    <Text style={styles.reportAnalysisTitle}>⚠️ Recommandations</Text>
                                    <View style={styles.reportAnalysisList}>
                                      {photo.aiAnalysis.recommendations.map((rec, i) => (
                                        <Text key={i} style={styles.reportAnalysisItem}>• {rec}</Text>
                                      ))}
                                    </View>
                                  </View>
                                </View>
                              )}

                              {photo.userComments && (
                                <View style={styles.reportCommentSection}>
                                  <Text style={styles.reportCommentTitle}>💬 Commentaires du coordonnateur</Text>
                                  <Text style={styles.reportCommentText}>{photo.userComments}</Text>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    }

                    {selectedReport.reportFooter && (
                      <View style={styles.reportDetailContentBox}>
                        <Text style={styles.reportDetailSubtitle}>CONCLUSION</Text>
                        <Text style={styles.reportDetailContentText}>
                          {selectedReport.reportFooter}
                        </Text>
                      </View>
                    )}
                  </View>

                  {selectedReport.aiGenerated && (
                    <View style={styles.reportDetailAiBadge}>
                      <Sparkles size={16} color="#F59E0B" />
                      <Text style={styles.reportDetailAiText}>Généré par IA</Text>
                    </View>
                  )}
                </ScrollView>

                {selectedReport && selectedReport.status != 'valide' && selectedReport.status != 'envoye_au_client' && (
                  <View style={styles.reportDetailActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={handleModifyReport}
                    >
                      <LinearGradient
                        colors={['#F59E0B', '#D97706']}
                        style={styles.actionButtonGradient}
                      >
                        <Edit size={20} color="#FFFFFF" />
                        <Text style={styles.actionButtonText}>Modifier</Text>
                      </LinearGradient>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={handleSendReport}
                    >
                      <LinearGradient
                        colors={['#3B82F6', '#1D4ED8']}
                        style={styles.actionButtonGradient}
                      >
                        <Send size={20} color="#FFFFFF" />
                        <Text style={styles.actionButtonText}>Envoyer</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Edit Report Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent>
        <View style={styles.reportDetailModalOverlay}>
          <View style={styles.reportDetailModal}>
            <LinearGradient
              colors={['#F59E0B', '#D97706']}
              style={styles.reportDetailHeader}
            >
              <View style={styles.reportDetailHeaderContent}>
                <View style={styles.reportDetailHeaderLeft}>
                  <Edit size={24} color="#FFFFFF" />
                  <View style={styles.reportDetailHeaderText}>
                    <Text style={styles.reportDetailTitle}>Modifier le rapport</Text>
                    <Text style={styles.reportDetailSubtitle}>{selectedReport?.title}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.closeReportDetailButton}
                  onPress={() => setShowEditModal(false)}
                >
                  <X size={24} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </LinearGradient>

            <ScrollView style={styles.editModalContent}>
              <Text style={styles.editModalLabel}>En-tête du rapport</Text>
              <TextInput
                style={styles.editModalTextInput}
                value={editedHeader}
                onChangeText={setEditedHeader}
                multiline
                numberOfLines={10}
                placeholder="Saisissez l'en-tête du rapport..."
                placeholderTextColor="#64748B"
              />

              <Text style={styles.editModalLabel}>Observations (Contenu principal)</Text>
              <TextInput
                style={styles.editModalTextInput}
                value={editedContent}
                onChangeText={setEditedContent}
                multiline
                numberOfLines={15}
                placeholder="Saisissez les observations du rapport..."
                placeholderTextColor="#64748B"
              />

              <Text style={styles.editModalLabel}>Conclusion</Text>
              <TextInput
                style={styles.editModalTextInput}
                value={editedFooter}
                onChangeText={setEditedFooter}
                multiline
                numberOfLines={10}
                placeholder="Saisissez la conclusion du rapport..."
                placeholderTextColor="#64748B"
              />

              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSaveModifications}
                disabled={isSaving}
              >
                <LinearGradient
                  colors={['#10B981', '#059669']}
                  style={styles.saveButtonGradient}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <CheckCircle size={20} color="#FFFFFF" />
                      <Text style={styles.saveButtonText}>Enregistrer</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PDF Loading Modal */}
      <Modal visible={showPdfLoadingModal} animationType="fade" transparent>
        <View style={styles.pdfLoadingOverlay}>
          <View style={styles.pdfLoadingModal}>
            <LinearGradient
              colors={['#3B82F6', '#2563EB']}
              style={styles.pdfLoadingGradient}
            >
              <FileText size={48} color="#FFFFFF" />
              <Text style={styles.pdfLoadingTitle}>Génération du PDF</Text>
              <Text style={styles.pdfLoadingText}>{pdfLoadingProgress}</Text>
              <ActivityIndicator size="large" color="#FFFFFF" style={styles.pdfLoadingSpinner} />
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingTop: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
  },
  filterContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
  },
  filterDropdown: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  filterDropdownGradient: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  filterDropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterDropdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  filterDropdownIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDropdownText: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  filterDropdownCount: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.8,
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  emptyState: {
    marginTop: 60,
    borderRadius: 16,
    overflow: 'hidden',
  },
  emptyStateGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: 1,
  },
  emptyStateText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  rapportCard: {
    height: 250,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  rapportGradient: {
    flex: 1,
  },
  rapportBackground: {
    flex: 1,
  },
  rapportBackgroundImage: {
    borderRadius: 16,
    opacity: 0.15,
  },
  rapportOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: 20,
    justifyContent: 'space-between',
  },
  rapportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  rapportTitleContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  rapportTitle: {
    fontSize: 15,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    flex: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    gap: 3,
  },
  aiText: {
    fontSize: 9,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  rapportMission: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#FFFFFF',
    opacity: 0.95,
    marginBottom: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  clientContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rapportClient: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
  rapportStats: {
    flexDirection: 'row',
    gap: 16,
    marginVertical: 2,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statNumber: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  statText: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.85,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  conformitySection: {
    marginVertical: 0,
  },
  conformityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  conformityLabel: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    opacity: 0.9,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  conformityValue: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  conformityBar: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  conformityFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  rapportFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rapportMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.85,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  rapportType: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
    color: '#FFFFFF',
    opacity: 0.9,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  filterMenu: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  filterMenuGradient: {
    padding: 24,
  },
  filterMenuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterMenuTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  filterMenuDescription: {
    marginBottom: 20,
  },
  filterMenuDescriptionText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    lineHeight: 18,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterMenuItem: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterMenuItemActive: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  filterMenuItemGradient: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  filterMenuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  filterMenuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  filterMenuTextContainer: {
    flex: 1,
  },
  filterMenuIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterMenuIconActive: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterMenuItemText: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  filterMenuItemTextActive: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  filterMenuItemSubtext: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },
  filterMenuItemSubtextActive: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#FFFFFF',
    opacity: 0.85,
  },
  filterMenuBadge: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 38,
    alignItems: 'center',
  },
  filterMenuBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 38,
    alignItems: 'center',
  },
  filterMenuBadgeText: {
    fontSize: 15,
    fontFamily: 'Inter-Bold',
  },
  filterMenuBadgeTextActive: {
    fontSize: 15,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  reportDetailModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  reportDetailModal: {
    width: width * 0.95,
    height: '95%',
    backgroundColor: '#1E293B',
    borderRadius: 24,
    overflow: 'hidden',
  },
  reportDetailHeader: {
    padding: 20,
  },
  reportDetailHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reportDetailHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 12,
  },
  reportDetailHeaderText: {
    flex: 1,
  },
  reportDetailTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  closeReportDetailButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportDetailContent: {
    flex: 1,
  },
  reportDetailSection: {
    padding: 20,
  },
  reportDetailInfoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  reportDetailInfoItem: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  reportDetailInfoLabel: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  reportDetailInfoValue: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  reportDetailDivider: {
    height: 1,
    backgroundColor: '#374151',
    marginHorizontal: 20,
  },
  reportDetailSectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    marginBottom: 12,
    letterSpacing: 1,
  },
  reportDetailContentBox: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    minHeight: 150,
  },
  reportPhotoContainer: {
    gap: 16,
  },
  reportPhotoCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  reportPhotoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  reportPhotoNumber: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#F8FAFC',
  },
  reportRiskBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  reportRiskBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  reportPhotoImageContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  reportPhotoImage: {
    width: '100%',
    height: 240,
    backgroundColor: '#0F172A',
  },
  reportAnalysisSection: {
    gap: 12,
    marginBottom: 12,
  },
  reportAnalysisBlock: {
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
  },
  reportAnalysisTitle: {
    fontSize: 13,
    fontFamily: 'Inter-Bold',
    color: '#CBD5E1',
    marginBottom: 8,
  },
  reportAnalysisList: {
    gap: 6,
  },
  reportAnalysisItem: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    lineHeight: 20,
  },
  reportCommentSection: {
    backgroundColor: '#422006',
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  reportCommentTitle: {
    fontSize: 13,
    fontFamily: 'Inter-Bold',
    color: '#FEF3C7',
    marginBottom: 6,
  },
  reportCommentText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FDE68A',
    lineHeight: 20,
  },
  reportDetailContentText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#E2E8F0',
    lineHeight: 22,
  },
  reportDetailSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#F59E0B',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  reportDetailAiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    margin: 20,
    marginTop: 0,
  },
  reportDetailAiText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#F59E0B',
  },
  reportDetailActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: '#0F172A',
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  actionButtonText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  pdfLoadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pdfLoadingModal: {
    width: width * 0.85,
    borderRadius: 20,
    overflow: 'hidden',
  },
  pdfLoadingGradient: {
    padding: 40,
    alignItems: 'center',
  },
  pdfLoadingTitle: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginTop: 20,
    marginBottom: 10,
  },
  pdfLoadingText: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    color: '#E0E7FF',
    marginBottom: 20,
    textAlign: 'center',
  },
  pdfLoadingSpinner: {
    marginTop: 10,
  },
  editModalContent: {
    flex: 1,
    padding: 20,
  },
  editModalLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    marginTop: 16,
    marginBottom: 12,
    letterSpacing: 1,
  },
  editModalTextInput: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#E2E8F0',
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  saveButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 35,
  },
  saveButtonGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
});