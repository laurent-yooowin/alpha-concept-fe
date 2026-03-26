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
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { Search, Filter, Download, Send, FileText, Calendar, Building, CircleCheck as CheckCircle, Clock, TriangleAlert as AlertTriangle, Eye, Share, Sparkles, ArrowRight, ChevronDown, X, Edit, Mail, FileCheck, NotebookPen, Plus, Pencil, Save, RefreshCw } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { reportService, ReportStatus } from '@/services/reportService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { downloadBase64File, getReportStatusInfo } from '@/utils/missionHelpers';
import * as Linking from 'expo-linking';
import { pdfService } from '@/services/pdfService';
import { visitService } from '@/services/visitService';
import { useAuth } from '@/contexts/AuthContext';

import * as MailComposer from 'expo-mail-composer';
import { uploadService } from '@/services/uploadService';
import { Mission, missionService } from '../../services/missionService';
import { useLocalSearchParams } from 'expo-router';
import { userService } from '@/services/userService';

const { width } = Dimensions.get('window');

export default function RapportsScreen() {
  // const { user } = useAuth();
  const [userProfile, setUserProfile] = useState < any > (null);
  const params = useLocalSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('tous');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [reports, setReports] = useState < any[] > ([]);
  const [selectedReport, setSelectedReport] = useState < any | null > (null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedReportPhotos, setSelectedReportPhotos] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [showPdfLoadingModal, setShowPdfLoadingModal] = useState(false);
  const [pdfLoadingProgress, setPdfLoadingProgress] = useState('Préparation du document...');
  const [selection, setSelection] = useState({ start: 2, end: 2 });

  // Global edit mode for all groups in report detail modal
  const [isEditingAllGroups, setIsEditingAllGroups] = useState(false);
  const [tempAllGroupsData, setTempAllGroupsData] = useState<{ [groupId: string]: { observations: string[]; recommendations: string[]; references: string[]; comment: string } }>({});
  const [isSavingAllGroups, setIsSavingAllGroups] = useState(false);

  // Image zoom for report detail
  const [showReportImageZoom, setShowReportImageZoom] = useState(false);
  const [reportZoomedImageUri, setReportZoomedImageUri] = useState<string | null>(null);  

  // Recharger UNIQUEMENT si la chantier change
  useFocusEffect(
    useCallback(() => {
      if (params.mission) {
        let missionData;
        try {
          missionData = JSON.parse(params.mission as string);
          console.log('Params missionData >>> : ', missionData);
          loadReports(missionData); // Filtre par chantier
        } catch (error) {
          console.error('Erreur parsing chantier:', error);
        }
      } else {
        loadReports();
      }
    }, [params.mission]) // Ajoute params.chantier comme dépendance    
  );


  const loadUserProfile = async () => {
    try {
      const response = await userService.getProfile();
      if (response.data) {
        setUserProfile(response.data);
      }

    } catch (error) {
      console.log('Erreur lors du chargement du profil:', error);
    }
  };

  const loadReports = async (missionData?: Mission | null) => {
    try {
      setLoadingReport(true);
      // await loadUserProfile();
      if (!userProfile) {
        await loadUserProfile();
      }
      const response = await reportService.getReports();
      let missionExists = false;
      let selectedReportMission = null;

      if (response.data && Array.isArray(response.data)) {
        const backendReports = await Promise.all(
          response.data.map(async (report: any) => {
            const statusInfo = getReportStatusInfo(report.status);
            let anomalies = 0;
            if (report.visit) {
              report.visit.photos.forEach((photo: any) => {
                if (photo.analysis && photo.analysis.riskLevel && (photo.analysis.riskLevel.toLowerCase() === 'eleve' || photo.analysis.riskLevel.toLowerCase() === 'high')) {
                  anomalies += 1;
                }
              });
            }
            const reportRet = {
              ...report,
              title: report.title,
              mission: report.mission?.title || 'Chantier inconnu',
              missionData: report.mission,
              client: report.mission?.client || 'Client inconnu',
              date: new Date(report.createdAt).toISOString().split('T')[0],
              status: report.status || 'brouillon',
              originalStatus: report.status || 'brouillon',
              type: report.mission?.type,
              pages: Math.ceil(report.content.length / 500),
              photos: report.visit?.photoCount || 0,
              anomalies: anomalies,
              conformity: report.conformityPercentage,
              aiGenerated: true,
              gradient: statusInfo.gradient,
              backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
              reportContent: report.content,
              reportHeader: report.header,
              reportFooter: report.footer,
              observations: report.observations,
              recommendations: report.recommendations,
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
            if (missionData && report.mission.id == missionData.id && missionData.reportId == report.id) {
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
          // console.log('selectedReportMission >>> : ', selectedReportMission);          
          openReportDetail(selectedReportMission);
        } else {
          setLoadingReport(false);
        }
      } else {
        // Load only local reports if backend fails
        const localReports = await AsyncStorage.getItem('userReports');
        const parsedLocalReports = localReports ? JSON.parse(localReports) : [];
        setReports([]);
        setLoadingReport(false);
      }
    } catch (error) {
      console.log('Error loading reports:', error);
      // Load local reports as fallback
      const localReports = await AsyncStorage.getItem('userReports');
      const parsedLocalReports = localReports ? JSON.parse(localReports) : [];
      setReports(parsedLocalReports);
      setLoadingReport(false);
    }
  };

  const enterEditMode = () => {
    if (!selectedReport || !selectedReportPhotos || selectedReportPhotos.length === 0) return;
    const groups: { [key: string]: any[] } = {};
    selectedReportPhotos.forEach((photo: any) => {
      const gid = photo.groupId || photo.id;
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(photo);
    });
    const initialData: { [groupId: string]: { observations: string[]; recommendations: string[]; references: string[]; comment: string } } = {};
    Object.entries(groups).forEach(([groupId, groupPhotos]) => {
      const first = groupPhotos[0];
      initialData[groupId] = {
        observations: [...(first.aiAnalysis?.observations || [])],
        recommendations: [...(first.aiAnalysis?.recommendations || [])],
        references: [...(first.aiAnalysis?.references || [])],
        comment: first.comment || '',
      };
    });
    setTempAllGroupsData(initialData);
    setIsEditingAllGroups(true);
  };

  const cancelEditMode = () => {
    setIsEditingAllGroups(false);
    setTempAllGroupsData({});
  };

  const handleChangeText = (value: string) => {
    const cursor = selection.start;
    // Détection insertion d’un retour à la ligne
    if (value.length > editedContent.length && value[cursor - 1] === "\n") {
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);

      const newText = before + "• " + after;
      const newCursor = before.length + 3; // position exacte après "• "

      setEditedContent(newText);

      // ⚠️ important : attendre le rendu
      setTimeout(() => {
        setSelection({ start: newCursor, end: newCursor });
      }, 0);
    } else {
      setEditedContent(value);
    }
  };


  const handleSaveModifications = async () => {
    if (!selectedReport) return;

    try {
      setIsSaving(true);
      const report = await reportService.updateReport(selectedReport.id, {
        header: editedHeader,
        content: editedContent,
        footer: editedFooter,
        status: 'brouillon',
      });

      setSelectedReport(prev => prev ? { ...prev, reportHeader: editedHeader, reportContent: editedContent, reportFooter: editedFooter } : null);

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

                const references = refsMatch?.[1]
                  ?.split('•')
                  .map(s => s.trim().replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', ''))
                  .filter(s => s.length > 0) || photo.aiAnalysis?.references || [];

                return {
                  ...photo,
                  analysis: {
                    ...photo.analysis,
                    observation: observations,
                    recommendation: recommendations,
                    references: references,
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
      await loadReports(selectedReport.missionData);
    } catch (error) {
      console.error('Error updating report:', error);
      Alert.alert('Erreur', 'Impossible de modifier le rapport.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAllGroups = async () => {
    if (!selectedReport || !selectedReport.visitId) return;
    try {
      setIsSavingAllGroups(true);
      const visitResponse = await visitService.getVisit(selectedReport.visitId);
      if (visitResponse.data && visitResponse.data.photos) {
        const updatedPhotos = visitResponse.data.photos.map((photo: any) => {
          const photoGroupId = photo.groupId || photo.id;
          const groupData = tempAllGroupsData[photoGroupId];
          if (groupData) {
            return {
              ...photo,
              analysis: {
                ...photo.analysis,
                observation: groupData.observations,
                recommendation: groupData.recommendations,
                references: groupData.references,
              },
              comment: groupData.comment,
            };
          }
          return photo;
        });

        await visitService.updateVisit(selectedReport.visitId, { photos: updatedPhotos });

        // Update local state
        const updatedReportPhotos = selectedReportPhotos.map((photo: any) => {
          const photoGroupId = photo.groupId || photo.id;
          const groupData = tempAllGroupsData[photoGroupId];
          if (groupData) {
            return {
              ...photo,
              aiAnalysis: {
                ...photo.aiAnalysis,
                observations: groupData.observations,
                recommendations: groupData.recommendations,
                references: groupData.references,
              },
              comment: groupData.comment,
            };
          }
          return photo;
        });
        setSelectedReportPhotos(updatedReportPhotos);

        // Build updated content from all groups
        const groups: { [key: string]: any[] } = {};
        updatedReportPhotos.forEach((photo: any) => {
          const gid = photo.groupId || photo.id;
          if (!groups[gid]) groups[gid] = [];
          groups[gid].push(photo);
        });

        let newContent = '';
        Object.entries(groups).forEach(([gid, gPhotos], idx) => {
          const first = gPhotos[0];
          newContent += `\nRapport ${idx + 1} - ${gPhotos.length} photo(s)\n`;
          if (first.aiAnalysis) {
            newContent += `Observations:\n${first.aiAnalysis.observations?.map((o: string) => `• ${o}`).join('\n') || ''}\n`;
            newContent += `Recommandations:\n${first.aiAnalysis.recommendations?.map((r: string) => `• ${r}`).join('\n') || ''}\n`;
            if (first.aiAnalysis.references?.length) {
              newContent += `🏛️ Références:\n${first.aiAnalysis.references.map((r: string) => `• ${r}`).join('\n')}\n`;
            }
          }
          if (first.comment) {
            newContent += `💬 Commentaires du coordonnateur:\n${first.comment}\n`;
          }
          newContent += '━━━━━━━━━━━━━━━━━━━━━\n';
        });

        await reportService.updateReport(selectedReport.id, {
          content: newContent,
          status: 'brouillon',
        });

        setSelectedReport((prev: any) => prev ? { ...prev, reportContent: newContent } : null);
        setIsEditingAllGroups(false);
        setTempAllGroupsData({});
        Alert.alert('Succès', 'Toutes les modifications ont été sauvegardées.');
      }
    } catch (error) {
      console.error('Error saving all group edits:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder les modifications.');
    } finally {
      setIsSavingAllGroups(false);
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

  const terminateMision = async () => {
    if (selectedReport.missionData?.status != "terminee") {
      if (reports.some(r => r.missionId == selectedReport.missionId && r.status != "envoye_au_client")) {
        Alert.alert(
          'Attention !',
          `Le chantier ${selectedReport.missionData?.title} a un ou plusieurs rapports non envoyé, voulez-vous tout de même le clôturer ?
  
Si vous clôturer le chantier les rapports non envoyé seron annulés.
            ` ,
          [
            {
              text: 'Oui',
              style: 'default',
              onPress: async () => {
                await missionService.updateMission(selectedReport.missionId, {
                  status: 'terminee'
                });

                Alert.alert(
                  `Le chantier ${selectedReport.missionData?.title} est clôturée.`,
                  `La gestion et la modification des rapports ne sont plus autorisées pour ce chantier.`
                );
                await loadReports();
              }
            },
            {
              text: 'Non',
              style: 'cancel',
              onPress: async () => {
                await loadReports();
              }
            }
          ]
        );
      } else {
        await missionService.updateMission(selectedReport.missionId, {
          status: 'terminee'
        });

        Alert.alert(
          `Le chantier ${selectedReport.missionData?.title} est clôturée.`,
          `La gestion et la modification des rapports ne sont plus autorisées pour ce chantier.`
        );
        await loadReports();
      }
    }
  }

  const validateSentReport = async (clientEmail: string, reportFileUrl: string) => {
    try {
      await reportService.updateReport(selectedReport.id, {
        status: 'envoye_au_client' as ReportStatus,
        recipientEmail: clientEmail,
        reportFileUrl: reportFileUrl,
      });

      setSelectedReport(prev => prev ? { ...prev, status: 'envoye_au_client', recipientEmail: clientEmail, reportFileUrl: reportFileUrl } : null);
      setReports(prev => prev ? prev.map(r => {
        if (r.id == selectedReport.id) {
          r.status = 'envoye_au_client';
          r.recipientEmail = clientEmail;
          r.reportFileUrl = reportFileUrl;
        }
        return r;
      }) : []);

      Alert.alert('Succès', 'Le rapport a été envoyé au client avec succès.');
      await loadReports();
    } catch (error) {
      Alert.alert(
        `Erreur lors de la mise à jours du rapport, veuillez contacter le support .`
      );
    }
  }

  const handleSendReport = async () => {
    if (!selectedReport) return;
    if (selectedReport.status == 'annule' || selectedReport.status == 'envoye_au_client') {
      Alert.alert('Rapport déjà envoyé', 'Vous ne pouvez pas modifier ni envoyer le rapport.');
      return;
    }

    let clientEmail = selectedReport.contact?.email;
    if (!clientEmail || clientEmail.trim() === '') {
      Alert.alert(
        'Email client manquant',
        "L'email du client est obligatoire pour envoyer le rapport. Veuillez renseigner l'email du contact dans les détails du chantier.",
      );
      return;
    }
    const subject = `Rapport SPS: ${selectedReport.title}`;

    try {
      setShowPdfLoadingModal(true);
      setPdfLoadingProgress('Préparation du document...');

      let photos: any[] = [];
      let visitResponse;
      // console.log('selectedReport >>> : ', selectedReport);
      if (selectedReport.visit) {
        try {
          // visitResponse = await visitService.getVisit(selectedReport.visitId);
          // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
          if (selectedReport.visit.photos) {
            photos = selectedReport.visit.photos
              .map((photo: any) => {
                const riskLevelMap: { [key: string]: 'low' | 'medium' | 'high' } = {
                  'faible': 'low',
                  'moyen': 'medium',
                  'eleve': 'high',
                  'low': 'low',
                  'medium': 'medium',
                  'high': 'high'
                };

                let refs = photo.analysis?.references;
                if (refs && !Array.isArray(refs)) {
                  refs = refs.split(', ').filter((s: string) => s.length > 0);
                }

                let observations = photo.analysis?.observation;
                if (observations && !Array.isArray(observations)) {
                  observations = observations.split(', ').filter((s: string) => s.length > 0);
                }

                let recommendations = photo.analysis?.recommendation;
                if (recommendations && !Array.isArray(recommendations)) {
                  recommendations = recommendations.split(', ').filter((s: string) => s.length > 0);
                }

                return {
                  id: photo.id || `photo-${Date.now()}-${Math.random()}`,
                  uri: photo.uri || photo.s3Url,
                  s3Url: photo.s3Url,
                  groupId: photo.groupId || photo.id || `photo-${Date.now()}-${Math.random()}`,
                  timestamp: new Date(photo.createdAt || Date.now()),
                  aiAnalysis: photo.analysis ? {
                    observations: observations ? observations : [],
                    recommendations: recommendations ? recommendations : [],
                    references: refs ? refs : [],
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

      setPdfLoadingProgress('Finalisation...');

      const body = `Bonjour ${selectedReport?.contact.firstName},
Veuillez trouver ci-joint le rapport de visite suivant:

Chantier: ${selectedReport?.title}
Date d'attribution: ${selectedReport.dateMission} à ${selectedReport.timeMission}
Date de visite: ${new Date(visitResponse?.data?.createdAt || '').toLocaleString('fr-FR')}
Adresse chantier: ${selectedReport.location} 
Nombre de photos: ${visitResponse?.data?.photos?.length}

Le rapport complet avec les photos est disponible en pièce jointe PDF.

Cordialement.
${userProfile && `Coordonnateur: ${userProfile.firstName} ${userProfile.lastName}`}
`;
      // 4️⃣ Vérifier si MailComposer est disponible
      const isAvailable = await MailComposer.isAvailableAsync();
      if (!isAvailable) {
        console.warn('📧 MailComposer non disponible sur cet appareil.');
        // return pdfPath;
      }

      // 5️⃣ Préparer l’email avec texte pré-rempli et pièce jointe
      const mailOptions = {
        recipients: [clientEmail],
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
      setShowReportModal(false);

      Alert.alert(
        "Validation de l’envoi du rapport",
        `Veuillez confirmer l’envoi du rapport PDF aux destinataires concernés.
      
⚠️ Après l’envoi, aucune modification ne sera possible.
                  `,
        [
          {
            text: 'Oui je confirme',
            style: 'default',
            onPress: async () => {
              await validateSentReport(clientEmail, reportFileUrl);
            }
          },
          {
            text: 'Non',
            style: 'cancel',
            onPress: async () => {
              await reportService.updateReport(selectedReport.id, {
                reportFileUrl: reportFileUrl,
              });
              await loadReports();
            }
          }
        ]
      );



    } catch (error) {
      console.error('Error sending report:', error);
      setShowPdfLoadingModal(false);
      Alert.alert('Erreur', "Impossible d'ouvrir l'application mail.");
    }
  };

  const getFilterCounts = () => {
    return {
      tous: reports.length,
      envoye_au_client: reports.filter(r => r.originalStatus === 'envoye_au_client').length,
      brouillon: reports.filter(r => r.originalStatus === 'brouillon').length,
      valide: reports.filter(r => r.originalStatus === 'valide').length,
      annule: reports.filter(r => r.originalStatus === 'annule').length,
    };
  };

  const filterCounts = getFilterCounts();

  const filters = [
    { id: 'tous', label: 'Tous les rapports', count: filterCounts.tous, color: '#8B5CF6', icon: FileText, gradient: ['#8B5CF6', '#7C3AED'] },
    { id: 'envoye_au_client', label: 'Envoyés', count: filterCounts.envoye_au_client, color: '#10B981', icon: Send, gradient: ['#10B981', '#059669'] },
    { id: 'brouillon', label: 'En cours', count: filterCounts.brouillon, color: '#F59E0B', icon: Clock, gradient: ['#F59E0B', '#D97706'] },
    // { id: 'valide', label: 'Validés', count: filterCounts.valide, color: '#3B82F6', icon: CheckCircle, gradient: ['#3B82F6', '#2563EB'] },
    { id: 'annule', label: 'Annulés', count: filterCounts.annule, color: '#EF4444', icon: X, gradient: ['#EF4444', '#DC2626'] },
  ];

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'envoye_au_client':
        return { label: 'Envoyé', color: '#10B981', icon: Send };
      // case 'envoye':
      //   return { label: 'Envoyé', color: '#10B981', icon: Send };
      case 'brouillon':
        return { label: 'En cours', color: '#F59E0B', icon: Clock };
      case 'valide':
        return { label: 'Validé', color: '#3B82F6', icon: CheckCircle };
      case 'annule':
        return { label: 'Annulé', color: '#EF4444', icon: X };
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
    // console.log('report modal >>>> : ', report);
    setLoadingReport(true);
    let photos: any[] = [];
    if (report?.visitId) {
      try {
        const visitResponse = await visitService.getVisit(report.visitId);
        // console.log('visitResponse.data.photos >>> : ', visitResponse.data.photos);
        if (visitResponse.data && visitResponse.data.photos) {
          photos = await Promise.all(visitResponse.data.photos?.map(async (photo: any) => {
            const riskLevelMap: { [key: string]: 'low' | 'medium' | 'high' } = {
              'faible': 'low',
              'moyen': 'medium',
              'eleve': 'high',
              'low': 'low',
              'medium': 'medium',
              'high': 'high'
            };

            let fileUri = '';
            if (!photo.isDirectiveOnly && photo.s3Url) {
              const fileName = photo.uri.split('/').pop();
              fileUri = `${FileSystem.cacheDirectory}${fileName}`;

              const imgResp = await uploadService.downloadFile(photo.s3Url, '/visits', true);
              if (imgResp && imgResp.data && imgResp.data.data) {
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
              } else {
                Alert.alert("La photo n'a pas pu être telechargé");
              }
            }

            let refs = photo.analysis?.references;
            if (refs && !Array.isArray(refs)) {
              refs = refs.split(', ').filter((s: string) => s.length > 0);
            }

            let observations = photo.analysis?.observation;
            if (observations && !Array.isArray(observations)) {
              observations = observations.split(', ').filter((s: string) => s.length > 0);
            }

            let recommendations = photo.analysis?.recommendation;
            if (recommendations && !Array.isArray(recommendations)) {
              recommendations = recommendations.split(', ').filter((s: string) => s.length > 0);
            }

            return {
              id: photo.id || `photo-${Date.now()}-${Math.random()}`,
              uri: fileUri || photo.s3Url || '',
              s3Url: photo.s3Url,
              groupId: photo.groupId || photo.id || `photo-${Date.now()}-${Math.random()}`,
              timestamp: new Date(photo.createdAt || Date.now()),
              isDirectiveOnly: photo.isDirectiveOnly || false,
              userDirectives: photo.userDirectives || '',
              aiAnalysis: photo.analysis ? {
                observations: observations ? observations : [],
                recommendations: recommendations ? recommendations : [],
                references: refs ? refs : [],
                riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
                photoConformity: photo.analysis?.photoConformity || true,
                photoConformityMessage: photo.analysis?.photoConformityMessage || "",
                confidence: (photo.analysis.confidence || 0)
              } : undefined,
              comment: photo.comment || '',
              validated: photo.validated || true
            };
          }));
        }
      } catch (error) {
        console.log('Could not load visit photos:', error);
      } finally {
        setLoadingReport(false);
      }
    }
    setSelectedReportPhotos(photos);
    setSelectedReport(report);
    setShowReportModal(true);
  };

  const downloadReportFile = async (reportUrl: string) => {
    if (!reportUrl) return;
    try {
      setLoadingReport(true);
      const response: any = await uploadService.downloadFile(
        reportUrl,
        "/reports",
        true
      );
      if (response.data) {
        const { base64, contentType, fileName } = response.data.data;
        downloadBase64File(base64, contentType, fileName);
      }
      setLoadingReport(false);
    } catch (error) {
      console.error(error);
      setLoadingReport(false);
    }
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
                  : `Aucun rapport ${activeFilter === 'envoye_au_client' ? 'envoyé' :
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
                        <View style={styles.rapportBtnContainer}>
                          {rapport.reportFileUrl &&
                            <TouchableOpacity
                              onPress={() => downloadReportFile(rapport.reportFileUrl)}
                            >
                              <LinearGradient
                                colors={rapport.originalStatus ? getReportStatusInfo(rapport.originalStatus).gradient : ['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.1)']}
                                style={styles.statusBadge}
                              >
                                <Download size={10} color="#FFFFFF" />
                                <Text style={styles.statusText}>Fichier PDF</Text>
                              </LinearGradient>
                            </TouchableOpacity>
                          }

                          <LinearGradient
                            colors={rapport.originalStatus ? getReportStatusInfo(rapport.originalStatus).gradient : ['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.1)']}
                            style={styles.statusBadge}
                          >
                            <StatusIcon size={10} color="#FFFFFF" />
                            <Text style={styles.statusText}>{statusInfo.label}</Text>
                          </LinearGradient>
                        </View>
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Report Detail Modal */}
      <Modal visible={showReportModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
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

                      {(!selectedReportPhotos || selectedReportPhotos?.length == 0) && selectedReport.visit?.notes && (
                        <View style={styles.reportDetailContentBox}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <FileCheck size={16} color="#F59E0B" />
                            <Text style={styles.reportDetailSubtitle}>DIRECTIVES GLOBALES</Text>
                          </View>
                          <Text style={styles.reportDetailContentText}>
                            {selectedReport.visit.notes}
                          </Text>
                        </View>
                      )}

                      {(selectedReportPhotos?.length > 0) && (() => {
                        // Group photos by groupId
                        const groups: { [key: string]: any[] } = {};
                        selectedReportPhotos.forEach((photo: any) => {
                          const gid = photo.groupId || photo.id;
                          if (!groups[gid]) groups[gid] = [];
                          groups[gid].push(photo);
                        });

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

                        const isEditable = selectedReport.status !== 'annule' && selectedReport.status !== 'envoye_au_client' && selectedReport.missionData?.status !== 'terminee';

                        return (
                          <View style={styles.reportPhotoContainer}>
                            {Object.entries(groups).map(([groupId, groupPhotos], groupIndex) => {
                              const firstPhoto = groupPhotos[0];
                              const riskLevel = firstPhoto.aiAnalysis?.riskLevel || 'moyen';
                              const riskColor = getRiskColor(riskLevel);
                              const riskLabel = getRiskLabel(riskLevel);
                              const photoItems = groupPhotos.filter((photo: any) => !photo.isDirectiveOnly && photo.uri);
                              const isMultiple = photoItems.length > 1;
                              const isDirectiveOnlyGroup = groupPhotos.every((photo: any) => photo.isDirectiveOnly);
                              const isEditingThisGroup = isEditingAllGroups;

                              return (
                                <View key={groupId} style={styles.reportPhotoCard}>
                                  <View style={styles.reportPhotoHeader}>
                                    <Text style={styles.reportPhotoNumber}>
                                      {isDirectiveOnlyGroup
                                        ? `📝 Rapport ${groupIndex + 1} — directives seules`
                                        : `📸 Rapport ${groupIndex + 1} — ${photoItems.length} photo${photoItems.length > 1 ? 's' : ''}`}
                                    </Text>
                                    <View style={[styles.reportRiskBadge, { backgroundColor: riskColor }]}>
                                      <Text style={styles.reportRiskBadgeText}>{riskLabel}</Text>
                                    </View>
                                  </View>

                                  {isDirectiveOnlyGroup ? (
                                    <View style={styles.reportDetailContentBox}>
                                      <Text style={styles.reportDetailSubtitle}>DIRECTIVES DU GROUPE</Text>
                                      <Text style={styles.reportDetailContentText}>{firstPhoto.userDirectives || 'Aucune directive renseignée.'}</Text>
                                    </View>
                                  ) : isMultiple ? (
                                    <View style={styles.reportPhotoGrid}>
                                      {photoItems.map((photo: any, photoIdx: number) => (
                                        <TouchableOpacity
                                          key={photo.id}
                                          style={styles.reportPhotoGridItem}
                                          onPress={() => {
                                            setReportZoomedImageUri(photo.uri);
                                            setShowReportImageZoom(true);
                                          }}
                                        >
                                          <Image
                                            source={{ uri: photo.uri }}
                                            style={styles.reportPhotoGridImage}
                                            resizeMode="cover"
                                          />
                                          <View style={styles.reportPhotoIndexBadge}>
                                            <Text style={styles.reportPhotoIndexText}>{photoIdx + 1}</Text>
                                          </View>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                  ) : photoItems[0] ? (
                                    <TouchableOpacity
                                      style={styles.reportPhotoImageContainer}
                                      onPress={() => {
                                        setReportZoomedImageUri(photoItems[0].uri);
                                        setShowReportImageZoom(true);
                                      }}
                                    >
                                      <Image
                                        source={{ uri: photoItems[0].uri }}
                                        style={styles.reportPhotoImage}
                                        resizeMode="cover"
                                      />
                                    </TouchableOpacity>
                                  ) : null}

                                  {firstPhoto.aiAnalysis && (
                                    <View style={styles.reportAnalysisSection}>
                                      {isEditingThisGroup && tempAllGroupsData[groupId] ? (
                                        <>
                                          <View style={styles.reportAnalysisBlock}>
                                            <Text style={styles.reportEditSectionTitle}>OBSERVATIONS</Text>
                                            {tempAllGroupsData[groupId].observations.map((obs: string, idx: number) => (
                                              <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                                                <Eye size={14} color="#94A3B8" style={{ marginTop: 10 }} />
                                                <TextInput
                                                  style={styles.reportEditInput}
                                                  value={obs}
                                                  onChangeText={(text) => {
                                                    setTempAllGroupsData(prev => {
                                                      const updated = { ...prev };
                                                      updated[groupId] = { ...updated[groupId], observations: updated[groupId].observations.map((o, i) => i === idx ? text : o) };
                                                      return updated;
                                                    });
                                                  }}
                                                  multiline
                                                  textAlignVertical="top"
                                                  placeholderTextColor="#64748B"
                                                />
                                                <TouchableOpacity onPress={() => {
                                                  setTempAllGroupsData(prev => {
                                                    const updated = { ...prev };
                                                    updated[groupId] = { ...updated[groupId], observations: updated[groupId].observations.filter((_, i) => i !== idx) };
                                                    return updated;
                                                  });
                                                }}>
                                                  <X size={16} color="#EF4444" style={{ marginTop: 10 }} />
                                                </TouchableOpacity>
                                              </View>
                                            ))}
                                            <TouchableOpacity
                                              onPress={() => {
                                                setTempAllGroupsData(prev => {
                                                  const updated = { ...prev };
                                                  updated[groupId] = { ...updated[groupId], observations: [...updated[groupId].observations, ''] };
                                                  return updated;
                                                });
                                              }}
                                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                                            >
                                              <Plus size={14} color="#3B82F6" />
                                              <Text style={{ color: '#3B82F6', fontSize: 12, fontFamily: 'Inter-Bold' }}>Ajouter</Text>
                                            </TouchableOpacity>
                                          </View>

                                          <View style={styles.reportAnalysisBlock}>
                                            <Text style={styles.reportEditSectionTitle}>RECOMMANDATIONS</Text>
                                            {tempAllGroupsData[groupId].recommendations.map((rec: string, idx: number) => (
                                              <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                                                <AlertTriangle size={14} color="#F59E0B" style={{ marginTop: 10 }} />
                                                <TextInput
                                                  style={styles.reportEditInput}
                                                  value={rec}
                                                  onChangeText={(text) => {
                                                    setTempAllGroupsData(prev => {
                                                      const updated = { ...prev };
                                                      updated[groupId] = { ...updated[groupId], recommendations: updated[groupId].recommendations.map((r, i) => i === idx ? text : r) };
                                                      return updated;
                                                    });
                                                  }}
                                                  multiline
                                                  textAlignVertical="top"
                                                  placeholderTextColor="#64748B"
                                                />
                                                <TouchableOpacity onPress={() => {
                                                  setTempAllGroupsData(prev => {
                                                    const updated = { ...prev };
                                                    updated[groupId] = { ...updated[groupId], recommendations: updated[groupId].recommendations.filter((_, i) => i !== idx) };
                                                    return updated;
                                                  });
                                                }}>
                                                  <X size={16} color="#EF4444" style={{ marginTop: 10 }} />
                                                </TouchableOpacity>
                                              </View>
                                            ))}
                                            <TouchableOpacity
                                              onPress={() => {
                                                setTempAllGroupsData(prev => {
                                                  const updated = { ...prev };
                                                  updated[groupId] = { ...updated[groupId], recommendations: [...updated[groupId].recommendations, ''] };
                                                  return updated;
                                                });
                                              }}
                                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                                            >
                                              <Plus size={14} color="#3B82F6" />
                                              <Text style={{ color: '#3B82F6', fontSize: 12, fontFamily: 'Inter-Bold' }}>Ajouter</Text>
                                            </TouchableOpacity>
                                          </View>

                                          <View style={styles.reportAnalysisBlock}>
                                            <Text style={styles.reportEditSectionTitle}>RÉFÉRENCES</Text>
                                            {tempAllGroupsData[groupId].references.map((ref: string, idx: number) => (
                                              <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                                                <NotebookPen size={14} color="#F59E0B" style={{ marginTop: 10 }} />
                                                <TextInput
                                                  style={styles.reportEditInput}
                                                  value={ref}
                                                  onChangeText={(text) => {
                                                    setTempAllGroupsData(prev => {
                                                      const updated = { ...prev };
                                                      updated[groupId] = { ...updated[groupId], references: updated[groupId].references.map((r, i) => i === idx ? text : r) };
                                                      return updated;
                                                    });
                                                  }}
                                                  multiline
                                                  textAlignVertical="top"
                                                  placeholderTextColor="#64748B"
                                                />
                                                <TouchableOpacity onPress={() => {
                                                  setTempAllGroupsData(prev => {
                                                    const updated = { ...prev };
                                                    updated[groupId] = { ...updated[groupId], references: updated[groupId].references.filter((_, i) => i !== idx) };
                                                    return updated;
                                                  });
                                                }}>
                                                  <X size={16} color="#EF4444" style={{ marginTop: 10 }} />
                                                </TouchableOpacity>
                                              </View>
                                            ))}
                                          </View>

                                          <View style={styles.reportEditCommentSection}>
                                            <View style={styles.reportEditCommentHeader}>
                                              <Text style={styles.reportEditSectionTitle}>COMMENTAIRES</Text>
                                            </View>
                                            <TextInput
                                              style={styles.reportEditCommentInput}
                                              value={tempAllGroupsData[groupId].comment}
                                              onChangeText={(text) => {
                                                setTempAllGroupsData(prev => {
                                                  const updated = { ...prev };
                                                  updated[groupId] = { ...updated[groupId], comment: text };
                                                  return updated;
                                                });
                                              }}
                                              placeholder="Ajoutez un commentaire..."
                                              placeholderTextColor="#64748B"
                                              multiline
                                              textAlignVertical="top"
                                            />
                                          </View>
                                        </>
                                      ) : (
                                        <>
                                          {isDirectiveOnlyGroup && (
                                            <View style={styles.reportAnalysisBlock}>
                                              <Text style={styles.reportAnalysisTitle}>📝 Directives</Text>
                                              <View style={styles.reportAnalysisList}>
                                                <Text style={styles.reportAnalysisItem}>• {firstPhoto.userDirectives || 'Aucune directive renseignée.'}</Text>
                                              </View>
                                            </View>
                                          )}
                                          <View style={styles.reportAnalysisBlock}>
                                            <Text style={styles.reportAnalysisTitle}>🔍 Observations</Text>
                                            <View style={styles.reportAnalysisList}>
                                              {firstPhoto.aiAnalysis?.observations?.map((obs: string, i: number) => (
                                                <Text key={i} style={styles.reportAnalysisItem}>• {obs}</Text>
                                              ))}
                                            </View>
                                          </View>

                                          <View style={styles.reportAnalysisBlock}>
                                            <Text style={styles.reportAnalysisTitle}>⚠️ Recommandations</Text>
                                            <View style={styles.reportAnalysisList}>
                                              {firstPhoto.aiAnalysis?.recommendations?.map((rec: string, i: number) => (
                                                <Text key={i} style={styles.reportAnalysisItem}>• {rec}</Text>
                                              ))}
                                            </View>
                                          </View>

                                          <View style={styles.reportAnalysisBlock}>
                                            <Text style={styles.reportAnalysisTitle}>🏛️ Références</Text>
                                            <View style={styles.reportAnalysisList}>
                                              {firstPhoto.aiAnalysis?.references?.map((ref: string, i: number) => (
                                                <Text key={i} style={styles.reportAnalysisItem}>• {ref}</Text>
                                              ))}
                                            </View>
                                          </View>
                                        </>
                                      )}
                                    </View>
                                  )}

                                  {!isEditingThisGroup && firstPhoto.comment && (
                                    <View style={styles.reportCommentSection}>
                                      <Text style={styles.reportCommentTitle}>💬 Commentaires du coordonnateur</Text>
                                      <Text style={styles.reportCommentText}>{firstPhoto.comment}</Text>
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        );
                      })()}

                      {/* Global Directives Section */}
                      {selectedReport.visit?.notes && (
                        <View style={styles.reportDetailContentBox}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <FileCheck size={16} color="#F59E0B" />
                            <Text style={styles.reportDetailSubtitle}>DIRECTIVES GLOBALES</Text>
                          </View>
                          <Text style={styles.reportDetailContentText}>
                            {selectedReport.visit.notes}
                          </Text>
                        </View>
                      )}

                      {selectedReport.reportFooter && (
                        <View style={styles.reportDetailContentBox}>
                          <Text style={styles.reportDetailSubtitle}>CONCLUSION</Text>
                          <Text style={styles.reportDetailContentText}>
                            {selectedReport.reportFooter}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* {selectedReport.aiGenerated && (
                      <View style={styles.reportDetailAiBadge}>
                        <Sparkles size={16} color="#F59E0B" />
                        <Text style={styles.reportDetailAiText}>Généré par IA</Text>
                      </View>
                    )} */}
                  </ScrollView>

                  {selectedReport && selectedReport.status != 'annule' && selectedReport.status != 'envoye_au_client' && selectedReport.missionData.status != 'terminee' && (
                    <View style={styles.reportDetailActions}>
                      {isEditingAllGroups ? (
                        <>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={cancelEditMode}
                          >
                            <LinearGradient
                              colors={['#1e293be2', '#1E293B']}
                              style={styles.actionButtonGradient}
                            >
                              <X size={20} color="#FFFFFF" />
                              <Text style={styles.actionButtonText}>Annuler</Text>
                            </LinearGradient>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={handleSaveAllGroups}
                            disabled={isSavingAllGroups}
                          >
                            <LinearGradient
                              colors={isSavingAllGroups ? ['#64748B', '#475569'] : ['#10B981', '#059669']}
                              style={styles.actionButtonGradient}
                            >
                              {isSavingAllGroups ? (
                                <ActivityIndicator size={20} color="#FFFFFF" />
                              ) : (
                                <>
                                  <Save size={20} color="#FFFFFF" />
                                  <Text style={styles.actionButtonText}>Sauvegarder</Text>
                                </>
                              )}
                            </LinearGradient>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={enterEditMode}
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
                        </>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


      {/* PDF Loading Modal */}
      <Modal visible={showPdfLoadingModal} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Loading Chantier Modal */}
      <Modal visible={loadingReport} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.pdfLoadingOverlay}>
            <View style={styles.pdfLoadingModal}>
              <LinearGradient
                colors={['#8B5CF6', '#A855F7']}
                style={styles.analyzingGradient}
              >
                <ActivityIndicator size={20} color="#FFFFFF" />
                <Text style={styles.analyzingTitle}>CHARGEMENT EN COURS</Text>
                <Text style={styles.analyzingSubtitle}>
                  Chargement du rapport en cours ...
                </Text>
              </LinearGradient>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Image Zoom Modal */}
      <Modal visible={showReportImageZoom} animationType="fade" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
          <TouchableOpacity
            style={{ position: 'absolute', top: 60, right: 20, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}
            onPress={() => { setShowReportImageZoom(false); setReportZoomedImageUri(null); }}
          >
            <X size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {reportZoomedImageUri && (
            <Image
              source={{ uri: reportZoomedImageUri }}
              style={{ width: width * 0.95, height: '80%' }}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  analyzingGradient: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  analyzingTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: 8,
  },
  analyzingSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
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
  rapportBtnContainer: {
    // flex: 0.5,
    flexDirection: 'column-reverse',
    gap: 10,
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
    marginLeft: 4
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
    height: '90%',
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
  reportPhotoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  reportPhotoGridItem: {
    width: '48%',
    aspectRatio: 3 / 2,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0F172A',
  },
  reportPhotoGridImage: {
    width: '100%',
    height: '100%',
  },
  reportPhotoIndexBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportPhotoIndexText: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
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
    marginBottom: 16,
  },
  reportEditSectionTitle: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    letterSpacing: 1,
    marginBottom: 8,
  },
  reportEditInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    minHeight: 40,
    textAlignVertical: 'top',
  },
  reportEditCommentSection: {
    backgroundColor: '#374151',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  reportEditCommentHeader: {
    marginBottom: 12,
  },
  reportEditCommentInput: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    minHeight: 80,
    maxHeight: 150,
    textAlignVertical: 'top',
  },
  reportEditActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  reportEditCancelBtn: {
    flex: 0.8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  reportEditSaveBtn: {
    flex: 1.1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  reportEditBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    gap: 6,
  },
  reportEditCancelText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 0.5,
    paddingVertical: 21,
    paddingHorizontal: 6,
  },
  reportEditSaveText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    paddingVertical: 21,
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