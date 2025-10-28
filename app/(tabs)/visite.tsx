import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Dimensions,
  Modal,
  TextInput,
  Alert,
  Image,
  ActivityIndicator,
  Platform
} from 'react-native';
import { Camera, ArrowLeft, RotateCcw, Check, X, Plus, FileText, Send, CreditCard as Edit3, Sparkles, Eye, MessageSquare, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Clock, Trash2, Clipboard, ArrowRight, RefreshCw, Save } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { visitService } from '@/services/visitService';
import { reportService } from '@/services/reportService';
import { uploadService } from '@/services/uploadService';
import { aiService } from '@/services/aiService';
import { getMissionStatusInfo } from '@/utils/missionHelpers';
import { pdfService } from '@/services/pdfService';
import * as Linking from 'expo-linking';
import * as MailComposer from 'expo-mail-composer';

const { width, height } = Dimensions.get('window');

interface Photo {
  id: string;
  uri: string;
  s3Url?: string;
  timestamp: Date;
  aiAnalysis?: {
    observations: string[];
    recommendations: string[];
    riskLevel: 'low' | 'medium' | 'high';
    confidence: number;
  };
  userComments: string;
  validated: boolean;
}

interface Mission {
  id: number;
  title: string;
  client: string;
  location: string;
  description: string;
  nextVisit: string;
  type: string;
}

export default function VisiteScreen() {
  const params = useLocalSearchParams();
  const [mission, setMission] = useState < Mission | null > (null);
  const [availableMissions, setAvailableMissions] = useState < Mission[] > ([]);
  const [showMissionSelector, setShowMissionSelector] = useState(false);

  // États pour la caméra
  const [showCamera, setShowCamera] = useState(false);
  const [facing, setFacing] = useState < CameraType > ('back');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef < CameraView > (null);

  // États pour les photos et analyses
  const [photos, setPhotos] = useState < Photo[] > ([]);
  const [selectedPhoto, setSelectedPhoto] = useState < Photo | null > (null);
  const [showPhotoDetail, setShowPhotoDetail] = useState(false);
  const [editingComments, setEditingComments] = useState(false);
  const [tempComments, setTempComments] = useState('');

  // États pour le rapport
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [reportHeader, setReportHeader] = useState('');
  const [reportFooter, setReportFooter] = useState('');
  const [editingReport, setEditingReport] = useState(false);
  const [reportValidated, setReportValidated] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);
  const [isSavingReport, setIsSavingReport] = useState(false);

  // États de chargement
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [uploadedPhotoUrls, setUploadedPhotoUrls] = useState < string[] > ([]);
  const [showPdfLoadingModal, setShowPdfLoadingModal] = useState(false);
  const [pdfLoadingProgress, setPdfLoadingProgress] = useState('Préparation du document...');

  // États pour visite existante
  const [hasExistingVisit, setHasExistingVisit] = useState(false);
  const [existingVisitId, setExistingVisitId] = useState < string | null > (null);
  const [existingReportId, setExistingReportId] = useState < string | null > (null);
  const [showVisitDetailModal, setShowVisitDetailModal] = useState(false);
  const [reportStatus, setReportStatus] = useState < string | null > (null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadAvailableMissions();

    if (params.mission) {
      try {
        const missionData = JSON.parse(params.mission as string);
        selectMission(missionData);
      } catch (error) {
        console.error('Erreur parsing mission:', error);
      }
    }
  }, [params.mission]);

  const loadMissions = async () => {
    try {
      const { missionService } = await import('@/services/missionService');
      const response = await missionService.getMissions();


      if (response.data && Array.isArray(response.data)) {
        const backendMissions = [];
        response.data.map((mission: any) => {
          const missionStatusInfo = getMissionStatusInfo(mission.status);
          const newMission = {
            id: mission.id,
            title: mission.title?.toUpperCase() || 'MISSION SANS TITRE',
            client: mission.client || 'Client non renseigné',
            status: mission.status === 'en_cours' ? 'aujourdhui' :
              mission.status === 'terminee' ? 'planifiees' :
                mission.status === 'rejetee_replanifiee' ? 'en_retard' :
                  mission.status === 'planifiee' ? 'planifiees' : 'planifiees',
            nextVisit: mission.date && mission.time ? `${mission.date}T${mission.time}:00` : new Date().toISOString(),
            location: mission.address || 'Localisation non renseignée',
            description: mission.description || '',
            alerts: mission.status === 'rejetee_replanifiee' ? 1 : 0,
            completion: 50,
            gradient: missionStatusInfo.gradient,
            statusLabel: missionStatusInfo.label,
            originalStatus: mission.status,
            type: mission.type || 'Visite de contrôle',
            contact: {
              firstName: mission.contactFirstName || '',
              lastName: mission.contactLastName || '',
              email: mission.contactEmail || '',
              phone: mission.contactPhone || ''
            }
          }
          if (newMission && mission.status != 'terminee') {
            backendMissions.push(newMission);
          }
        });

        // setMissions(backendMissions);
        // setUserMissions(backendMissions);
        return backendMissions;
      } else {
        // setMissions([]);
        return [];
      }
    } catch (error) {
      console.log('Erreur lors du chargement des missions:', error);
      // setMissions([]);
      return [];
    }
  };

  const loadAvailableMissions = async () => {
    try {
      // Charger les missions utilisateur depuis AsyncStorage
      // const userMissions = await AsyncStorage.getItem('userMissions');
      // const parsedUserMissions = userMissions ? JSON.parse(userMissions) : [];
      const parsedUserMissions = await loadMissions();

      // Missions par défaut
      const defaultMissions = [
        {
          id: 1,
          title: 'RÉSIDENCE LES JARDINS',
          client: 'Bouygues Construction',
          location: 'Lyon 69003',
          description: 'Contrôle mensuel de sécurité',
          nextVisit: '2025-01-15T14:00:00',
          type: 'Visite mensuelle'
        },
        {
          id: 2,
          title: 'BUREAUX PART-DIEU',
          client: 'Eiffage Construction',
          location: 'Lyon 69003',
          description: 'Finalisation rapport conformité',
          nextVisit: '2025-01-15T16:30:00',
          type: 'Contrôle final'
        }
      ];

      setAvailableMissions([...parsedUserMissions]);
    } catch (error) {
      console.error('Erreur chargement missions:', error);
    }
  };

  const selectMission = async (selectedMission: any) => {
    if (!mission || mission.id !== selectedMission.id) {
      setPhotos([]);
      setReportContent('');
      setVisitNotes('');
      setReportValidated(false);

      console.log('selectedMission >>> ', selectedMission)
      await loadExistingVisitData(selectedMission.id);
    }

    setMission(selectedMission);
    setShowMissionSelector(false);
  };

  const loadExistingVisitData = async (missionId: number) => {
    try {
      const response = await visitService.getVisits(missionId);
      console.log('getVisits - response.data >>> ', response.data)

      if (response.data && response.data.length > 0) {
        setPhotos([]);
        const visit = response.data[0];

        setHasExistingVisit(true);
        setExistingVisitId(visit.id);

        const reportsResponse = await reportService.getReports();
        if (reportsResponse.data) {
          const visitReport = reportsResponse.data.find((r: any) => r.visitId === visit.id);
          if (visitReport) {
            setExistingReportId(visitReport.id);
            setReportStatus(visitReport.status);
          }
        }

        setHasChanges(false);

        if (visit.photos && visit.photos.length > 0) {
          const loadedPhotos: Photo[] = visit.photos.map((photo: any) => {
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
                confidence: Math.round((photo.analysis.confidence || 0) * 100)
              } : undefined,
              userComments: photo.comment || '',
              validated: photo.validated || true
            };
          });

          console.log('Loaded photos with analysis:', loadedPhotos);
          setPhotos(loadedPhotos);
          setUploadedPhotoUrls(visit.photos.map((p: any) => p.s3Url || p.uri).filter(Boolean));
        }

        if (visit.notes) {
          setVisitNotes(visit.notes);
        }

        if (visit.reportGenerated) {
          setReportValidated(true);
        }
      } else {
        setHasExistingVisit(false);
        setExistingVisitId(null);
        setExistingReportId(null);
      }
    } catch (error) {
      console.error('Erreur chargement visite existante:', error);
      setHasExistingVisit(false);
      setExistingVisitId(null);
      setExistingReportId(null);
    }
  };

  // Simulation d'analyse IA pour une photo
  const analyzePhoto = async (photoUri: string): Promise<Photo['aiAnalysis']> => {
    try {
      // Use backend AI analysis
      const response = await aiService.analyzePhoto(photoUri);

      if (response.data) {
        return {
          observations: response.data.observations,
          recommendations: response.data.recommendations,
          riskLevel: response.data.riskLevel === 'faible' ? 'low' : response.data.riskLevel === 'moyen' ? 'medium' : 'high',
          confidence: Math.round(response.data.confidence * 100),
        };
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      // Fallback to mock data if AI fails
    }

    // Fallback simulation
    await new Promise(resolve => setTimeout(resolve, 2000));

    const analyses = [
      {
        observations: [
          "Échafaudage installé selon les normes",
          "Garde-corps présents et conformes",
          "Zone de travail bien délimitée"
        ],
        recommendations: [
          "Vérifier la fixation des garde-corps quotidiennement",
          "Maintenir la signalisation visible"
        ],
        riskLevel: 'low' as const,
        confidence: 92
      },
      {
        observations: [
          "Absence de protection collective",
          "Matériaux stockés de manière désordonnée",
          "Accès non sécurisé à la zone de travail"
        ],
        recommendations: [
          "Installer immédiatement des garde-corps",
          "Organiser le stockage des matériaux",
          "Sécuriser les accès avec barrières"
        ],
        riskLevel: 'high' as const,
        confidence: 88
      },
      {
        observations: [
          "EPI portés par les ouvriers",
          "Signalisation présente mais partiellement masquée",
          "Outillage en bon état"
        ],
        recommendations: [
          "Repositionner la signalisation",
          "Vérifier l'état des EPI régulièrement"
        ],
        riskLevel: 'medium' as const,
        confidence: 85
      }
    ];

    return analyses[Math.floor(Math.random() * analyses.length)];
  };

  // Prendre une photo
  const takePhoto = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });

      if (photo) {
        const newPhoto: Photo = {
          id: Date.now().toString(),
          uri: photo.uri,
          timestamp: new Date(),
          userComments: '',
          validated: false
        };

        setPhotos(prev => [...prev, newPhoto]);
        setShowCamera(false);
        setHasChanges(true);

        // Upload photo to S3
        setUploadingPhotos(true);
        try {
          let fileToUpload: Blob | string;

          if (Platform.OS === 'web') {
            // Web: Use fetch to get blob
            const response = await fetch(photo.uri);
            fileToUpload = await response.blob();
          } else {
            // Mobile: Pass URI directly, FormData will handle it
            fileToUpload = photo.uri;
          }

          const uploadResults = await uploadService.uploadVisitPhotos([fileToUpload]);
          console.log('uploadResults  >>>> : ', uploadResults);

          if (uploadResults?.data && uploadResults.data?.length > 0) {
            const s3Url = uploadResults.data[0].url;
            // Update the photo with S3 URL
            setPhotos(prev => prev.map(p =>
              p.id === newPhoto.id
                ? { ...p, s3Url: s3Url, s3Key: uploadResults.data[0].key }
                : p
            ));
            setUploadedPhotoUrls(prev => [...prev, s3Url]);
          }
        } catch (error: any) {
          console.error('Erreur upload photo:', error);
          Alert.alert('Avertissement', 'Photo prise mais pas téléchargée. Vérifiez votre connexion.');
        } finally {
          setUploadingPhotos(false);
        }

        // Lancer l'analyse IA
        setAnalyzingPhoto(true);
        try {
          const analysis = await analyzePhoto(photo.uri);
          setPhotos(prev => prev.map(p =>
            p.id === newPhoto.id
              ? { ...p, aiAnalysis: analysis }
              : p
          ));
        } catch (error) {
          console.error('Erreur analyse IA:', error);
        } finally {
          setAnalyzingPhoto(false);
        }
      }
    } catch (error) {
      console.error('Erreur prise de photo:', error);
      Alert.alert('Erreur', 'Impossible de prendre la photo');
    }
  };

  // Supprimer une photo
  const deletePhoto = (photoId: string) => {
    Alert.alert(
      'Supprimer la photo',
      'Êtes-vous sûr de vouloir supprimer cette photo et son analyse ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            setPhotos(prev => prev.filter(p => p.id !== photoId));
            setHasChanges(true);
            if (selectedPhoto?.id === photoId) {
              setShowPhotoDetail(false);
              setSelectedPhoto(null);
            }
          }
        }
      ]
    );
  };

  // Valider une photo
  const validatePhoto = (photoId: string) => {
    setPhotos(prev => prev.map(p =>
      p.id === photoId
        ? { ...p, validated: true }
        : p
    ));

    if (selectedPhoto?.id === photoId) {
      setSelectedPhoto(prev => prev ? { ...prev, validated: true } : null);
    }
  };

  // Sauvegarder les commentaires
  const saveComments = () => {
    if (!selectedPhoto) return;

    setPhotos(prev => prev.map(p =>
      p.id === selectedPhoto.id
        ? { ...p, userComments: tempComments }
        : p
    ));

    setSelectedPhoto(prev => prev ? { ...prev, userComments: tempComments } : null);
    setEditingComments(false);
    setHasChanges(true);
  };

  // Sauvegarder la visite
  const saveVisit = async () => {
    if (!mission) {
      Alert.alert('Erreur', 'Veuillez sélectionner une mission');
      return;
    }

    if (uploadedPhotoUrls.length === 0) {
      Alert.alert('Erreur', 'Veuillez prendre au moins une photo');
      return;
    }

    setSavingVisit(true);

    try {
      const visitPhotos = photos.map(p => ({
        id: p.id,
        uri: p.uri,
        s3Url: p.s3Url,
        analysis: {
          observation: p.aiAnalysis?.observations.join(', ') || '',
          recommendation: p.aiAnalysis?.recommendations.join(', ') || '',
          riskLevel: p.aiAnalysis?.riskLevel === 'high' ? 'eleve' as const :
            p.aiAnalysis?.riskLevel === 'medium' ? 'moyen' as const :
              'faible' as const,
          confidence: p.aiAnalysis?.confidence || 0,
        },
        comment: p.userComments,
        validated: p.validated,
      }));
      const visitData = {
        missionId: mission.id.toString(),
        visitDate: new Date().toISOString(),
        photos: visitPhotos,
        photoCount: uploadedPhotoUrls.length,
        notes: photos.map(p => p.userComments).filter(c => c).join('\n\n'),
      };

      await visitService.createVisit(visitData);

      Alert.alert(
        'Succès',
        'La visite a été enregistrée avec succès',
        [
          {
            text: 'OK',
            onPress: () => {
              // setPhotos([]);
              // setUploadedPhotoUrls([]);
            }
          }
        ]
      );
    } catch (error: any) {
      Alert.alert('Erreur', error.message || 'Impossible d\'enregistrer la visite');
    } finally {
      setSavingVisit(false);
    }
  };

  const saveReportAndVisit = async () => {
    if (!mission) {
      Alert.alert('Erreur', 'Veuillez sélectionner une mission');
      return;
    }

    if (photos.length === 0) {
      Alert.alert('Erreur', 'Veuillez prendre au moins une photo');
      return;
    }

    if (!reportContent && !reportHeader && !reportFooter) {
      Alert.alert('Erreur', 'Le rapport ne peut pas être vide');
      return;
    }

    setIsSavingReport(true);

    try {
      // 1. Save visit first
      const visitPhotos = photos.map(p => ({
        id: p.id,
        uri: p.uri,
        s3Url: p.s3Url,
        analysis: {
          observation: p.aiAnalysis?.observations.join(', ') || '',
          recommendation: p.aiAnalysis?.recommendations.join(', ') || '',
          riskLevel: p.aiAnalysis?.riskLevel === 'high' ? 'eleve' as const :
            p.aiAnalysis?.riskLevel === 'medium' ? 'moyen' as const :
              'faible' as const,
          confidence: p.aiAnalysis?.confidence || 0,
        },
        comment: p.userComments,
        validated: p.validated,
      }));

      const visitData = {
        missionId: mission.id.toString(),
        visitDate: new Date().toISOString(),
        photos: visitPhotos,
        photoCount: photos.length,
        notes: photos.map(p => p.userComments).filter(c => c).join('\n\n'),
      };

      const visitResponse = await visitService.createVisit(visitData);
      const savedVisitId = visitResponse.data?.id || existingVisitId;

      if (!savedVisitId) {
        throw new Error('Impossible de créer la visite');
      }

      // 2. Calculate conformity
      const conformity = Math.round(
        photos.reduce((acc, p) => {
          if (p.aiAnalysis?.riskLevel === 'low') return acc + 95;
          if (p.aiAnalysis?.riskLevel === 'medium') return acc + 75;
          if (p.aiAnalysis?.riskLevel === 'high') return acc + 60;
          return acc + 85;
        }, 0) / photos.length
      );

      // 3. Save report
      const reportData = {
        missionId: mission.id.toString(),
        visitId: savedVisitId,
        title: `Rapport de visite - ${mission.title}`,
        content: reportContent,
        header: reportHeader,
        footer: reportFooter,
        status: 'brouillon' as const,
        conformityPercentage: conformity,
      };

      const reportResponse = await reportService.createReport(reportData);

      if (reportResponse.data) {
        setReportSaved(true);
        setReportValidated(true);
        setExistingVisitId(savedVisitId);
        setExistingReportId(reportResponse.data.id);
        setHasExistingVisit(true);
        Alert.alert(
          'Succès',
          'Le rapport et la visite ont été enregistrés avec succès. Vous pouvez maintenant envoyer le rapport.',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('Error saving report and visit:', error);
      if (error.message?.includes('401') || error.message?.includes('token')) {
        Alert.alert(
          'Session expirée',
          'Votre session a expiré. Veuillez vous reconnecter.',
          [
            {
              text: 'Se reconnecter',
              onPress: () => router.push('/login')
            }
          ]
        );
      } else {
        Alert.alert('Erreur', error.message || 'Impossible d\'enregistrer le rapport et la visite');
      }
    } finally {
      setIsSavingReport(false);
    }
  };

  // Générer le rapport
  const generateReport = async () => {
    if (photos.length < 3) {
      Alert.alert('Photos insuffisantes', 'Vous devez prendre au minimum 3 photos pour générer un rapport.');
      return;
    }

    setGeneratingReport(true);

    // Simulation de génération de rapport
    await new Promise(resolve => setTimeout(resolve, 3000));

    const validatedPhotos = photos.filter(p => p.validated);
    const totalRisks = photos.filter(p => p.aiAnalysis?.riskLevel === 'high').length;
    const mediumRisks = photos.filter(p => p.aiAnalysis?.riskLevel === 'medium').length;
    const header = `RAPPORT DE VISITE SPS
${mission?.title || 'Mission'}

CLIENT: ${mission?.client || 'N/A'}
LIEU: ${mission?.location || 'N/A'}
DATE: ${new Date().toLocaleDateString('fr-FR')}
COORDONNATEUR: Pierre Dupont

RÉSUMÉ DE LA VISITE:
${photos.length} photos prises et analysées
${validatedPhotos.length} analyses validées
${totalRisks} risques élevés identifiés
${mediumRisks} risques moyens identifiés`;

    const report = `
OBSERVATIONS PRINCIPALES:
${photos.map((photo, index) => {
      if (!photo.aiAnalysis) return '';
      return `
━━━━━━━━━━━━━━━━━━━━━
Photo ${index + 1} - Niveau de risque: ${photo.aiAnalysis.riskLevel.toUpperCase()}
📸 Photo: ${photo.s3Url}

Observations:
${photo.aiAnalysis.observations.map(obs => `• ${obs}`).join('\n')}

Recommandations:
${photo.aiAnalysis.recommendations.map(rec => `• ${rec}`).join('\n')}

${photo.userComments ? `💬 Commentaires du coordonnateur: ${photo.userComments}` : ''}
`}).join('\n')}

`;

    const footer = `CONCLUSION:
${totalRisks > 0
        ? 'Des actions correctives immédiates sont nécessaires pour les risques élevés identifiés.'
        : mediumRisks > 0
          ? 'Quelques améliorations sont recommandées pour optimiser la sécurité.'
          : 'Le chantier présente un bon niveau de conformité sécurité.'
      }

Rapport généré automatiquement par l'IA CSPS
Coordonnateur: Pierre Dupont
Date: ${new Date().toLocaleString('fr-FR')}`;

    setReportContent(report);
    setReportHeader(header);
    setReportFooter(footer);
    setGeneratingReport(false);
    setEditingReport(false);
    setShowReportModal(true);
  };

  // Update photo data from edited report content
  const updatePhotosFromEditedContent = () => {
    const updatedPhotos = photos.map((photo, index) => {
      const photoSectionRegex = new RegExp(
        `Photo ${index + 1}[\\s\\S]*?(?=Photo ${index + 2}|$)`,
        'i'
      );
      const photoSection = reportContent.match(photoSectionRegex)?.[0] || '';

      if (photoSection && editingReport) {
        const obsRegex = /Observations:\s*([\s\S]*?)(?=\n\s*Recommandations:|$)/i;
        const recRegex = /Recommandations:\s*([\s\S]*?)(?=\n\s*💬|$)/i;
        const comRegex = /💬\s*Commentaires du coordonnateur:\s*([\s\S]*)/i;

        const observationsMatch = photoSection.match(obsRegex);
        const recommendationsMatch = photoSection.match(recRegex);
        const commentsMatch = photoSection.match(comRegex);

        const observations = observationsMatch?.[1]
          ?.split('•')
          .map(s => s.trim())
          .filter(s => s.length > 0) || photo.aiAnalysis?.observations || [];

        const recommendations = recommendationsMatch?.[1]
          ?.split('•')
          .map(s => s.trim())
          .filter(s => s.length > 0) || photo.aiAnalysis?.recommendations || [];

        const comments = commentsMatch?.[1]?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || photo.comment?.replaceAll('━━━━━━━━━━━━━━━━━━━━━', '').replaceAll('\n\n\n', '').replaceAll('\n\n', '') || '';

        return {
          ...photo,
          aiAnalysis: photo.aiAnalysis ? {
            ...photo.aiAnalysis,
            observations,
            recommendations,
          } : undefined,
          userComments: comments,
        };
      }

      return photo;
    });

    setPhotos(updatedPhotos);
  };

  // Envoyer le rapport
  const sendReport = async () => {
    if (!reportValidated) {
      Alert.alert('Validation requise', 'Vous devez valider le rapport avant de l\'envoyer.');
      return;
    }

    // If report was edited, update photos from the edited content
    if (editingReport) {
      updatePhotosFromEditedContent();
    }

    try {
      const conformity = Math.round(
        photos.reduce((acc, p) => {
          if (p.aiAnalysis?.riskLevel === 'low') return acc + 100;
          if (p.aiAnalysis?.riskLevel === 'medium') return acc + 80;
          if (p.aiAnalysis?.riskLevel === 'high') return acc + 60;
          return acc + 85;
        }, 0) / photos.length
      );

      // 1. Save visit to backend
      const visitPhotos = photos.map(p => ({
        id: p.id,
        uri: p.uri,
        s3Url: p.s3Url,
        analysis: {
          observation: p.aiAnalysis?.observations.join(', ') || '',
          recommendation: p.aiAnalysis?.recommendations.join(', ') || '',
          riskLevel: p.aiAnalysis?.riskLevel === 'high' ? 'eleve' as const :
            p.aiAnalysis?.riskLevel === 'medium' ? 'moyen' as const :
              'faible' as const,
          confidence: p.aiAnalysis?.confidence || 0,
        },
        comment: p.userComments,
        validated: p.validated,
      }));

      let visitResponse;
      let visitId = existingVisitId;

      // Check if visit already exists for this mission
      if (existingVisitId) {
        // Update existing visit
        visitResponse = await visitService.updateVisit(existingVisitId, {
          visitDate: new Date().toISOString(),
          photos: visitPhotos,
          notes: visitNotes,
        });
        console.log('Updated existing visit:', existingVisitId);
      } else {
        // Create new visit
        visitResponse = await visitService.createVisit({
          missionId: mission?.id?.toString() || '',
          visitDate: new Date().toISOString(),
          photos: visitPhotos,
          notes: visitNotes,
        });
        visitId = visitResponse.data?.id;
        setExistingVisitId(visitId);
        console.log('Created new visit:', visitId);
      }

      if (visitResponse.error) {
        console.error('Error saving visit:', visitResponse.error);
      }

      // 2. Create or update report in backend
      let reportResponse;

      if (existingReportId && reportStatus !== 'valide') {
        // Update existing report if not validated
        reportResponse = await reportService.updateReport(existingReportId, {
          title: `RAPPORT VISITE - ${mission?.title}`,
          content: reportContent,
          header: reportHeader,
          footer: reportFooter,
          status: 'envoye',
          conformityPercentage: conformity,
        });
        console.log('Updated existing report:', existingReportId);
        setHasChanges(false);
      } else if (!existingReportId) {
        // Create new report only if none exists
        reportResponse = await reportService.createReport({
          missionId: mission?.id?.toString() || '',
          visitId: visitId,
          title: `RAPPORT VISITE - ${mission?.title}`,
          content: reportContent,
          header: reportHeader,
          footer: reportFooter,
          status: 'envoye',
          conformityPercentage: conformity,
          recipientEmail: mission?.contactEmail || undefined,
        });
        setExistingReportId(reportResponse.data?.id);
        setReportStatus('envoye');
        setHasChanges(false);
        console.log('Created new report:', reportResponse.data?.id);
      } else if (reportStatus === 'valide') {
        // Report is validated, cannot update
        Alert.alert('Rapport validé', 'Ce rapport a été validé et ne peut plus être modifié.');
        return;
      }

      if (reportResponse?.error) {
        console.error('Error saving report:', reportResponse.error);
        Alert.alert('Erreur', 'Impossible de sauvegarder le rapport sur le serveur');
        return;
      }

      // 3. Also save locally as fallback
      const newReport = {
        id: Date.now(),
        title: `RAPPORT VISITE - ${mission?.title}`,
        mission: mission?.title || 'Mission inconnue',
        client: mission?.client || 'Client inconnu',
        date: new Date().toISOString().split('T')[0],
        status: 'envoyes',
        type: mission?.type || 'Visite de contrôle',
        pages: Math.ceil((reportHeader + reportContent + reportFooter).length / 500),
        photos: photos.length,
        anomalies: photos.filter(p => p.aiAnalysis?.riskLevel === 'high').length,
        conformity,
        aiGenerated: true,
        gradient: ['#10B981', '#059669'],
        backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
        reportHeader: reportHeader,
        reportContent: reportContent,
        reportFooter: reportFooter,
        visitPhotos: photos
      };

      const existingReports = await AsyncStorage.getItem('userReports');
      const parsedReports = existingReports ? JSON.parse(existingReports) : [];
      const updatedReports = [newReport, ...parsedReports];
      await AsyncStorage.setItem('userReports', JSON.stringify(updatedReports));

      const pdfPhotos = photos.map(p => ({
        uri: p.s3Url || p.uri,
        comment: p.userComments,
      }));

      const pdfData = {
        title: `RAPPORT VISITE - ${mission?.title}`,
        mission: mission?.title || 'Mission inconnue',
        client: mission?.client || 'Client inconnu',
        date: new Date().toLocaleDateString('fr-FR'),
        conformity,
        header: reportHeader,
        content: reportContent,
        footer: reportFooter,
        photos: photos,
      };

      setShowPdfLoadingModal(true);
      setPdfLoadingProgress('Conversion des photos...');

      const pdfPath = await pdfService.generateReportPDF(pdfData);

      setPdfLoadingProgress('Finalisation...');

      const adminEmail = mission?.contactEmail || 'admin@csps.fr';
      const subject = `Rapport de visite - ${mission?.title}`;
      const body = `Bonjour,

Veuillez trouver ci-joint le rapport de visite suivant:

Mission: ${mission?.title}
Client: ${mission?.client}
Date: ${new Date().toLocaleDateString('fr-FR')}
Conformité: ${conformity}%
Photos: ${photos.length}

Le rapport complet avec les photos est disponible en pièce jointe PDF.

Cordialement`;

      // const mailtoUrl = pdfService.createMailtoLinkWithAttachment(
      //   adminEmail,
      //   subject,
      //   body,
      //   pdfPath || undefined
      // );

      // await Linking.openURL(mailtoUrl);

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
      setShowReportModal(false);

    } catch (error: any) {
      console.error('Erreur sauvegarde rapport:', error);
      setShowPdfLoadingModal(false);

      if (error.message?.includes('401') || error.message?.includes('token')) {
        Alert.alert(
          'Session expirée',
          'Votre session a expiré. Veuillez vous reconnecter.',
          [
            {
              text: 'Se reconnecter',
              onPress: () => router.push('/login')
            }
          ]
        );
      } else {
        Alert.alert('Erreur', 'Erreur lors de la sauvegarde du rapport');
      }
      return;
    }
  };

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'high': return '#EF4444';
      case 'medium': return '#F59E0B';
      case 'low': return '#10B981';
      default: return '#64748B';
    }
  };

  const getRiskLabel = (riskLevel: string) => {
    switch (riskLevel) {
      case 'high': return 'RISQUE ÉLEVÉ';
      case 'medium': return 'RISQUE MOYEN';
      case 'low': return 'CONFORME';
      default: return 'NON ANALYSÉ';
    }
  };

  if (!mission) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>VISITE SPS</Text>
            <Text style={styles.headerSubtitle}>Sélectionnez une mission</Text>
          </View>
        </View>

        {/* Mission Selector Modal */}
        <Modal visible={showMissionSelector} animationType="slide" transparent>
          <View style={styles.missionSelectorOverlay}>
            <View style={styles.missionSelectorModal}>
              <LinearGradient
                colors={['#1E293B', '#374151']}
                style={styles.missionSelectorGradient}
              >
                <View style={styles.missionSelectorHeader}>
                  <Text style={styles.missionSelectorTitle}>SÉLECTIONNER UNE MISSION</Text>
                  <TouchableOpacity
                    style={styles.closeMissionSelectorButton}
                    onPress={() => setShowMissionSelector(false)}
                  >
                    <X size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.missionSelectorContent} showsVerticalScrollIndicator={false}>
                  {availableMissions.map((availableMission) => (
                    <TouchableOpacity
                      key={availableMission.id}
                      style={styles.missionSelectorItem}
                      onPress={() => selectMission(availableMission)}
                    >
                      <LinearGradient
                        colors={['#374151', '#4B5563']}
                        style={styles.missionSelectorItemGradient}
                      >
                        <View style={styles.missionSelectorItemContent}>
                          <View style={styles.missionSelectorItemLeft}>
                            <Text style={styles.missionSelectorItemTitle}>{availableMission.title}</Text>
                            <Text style={styles.missionSelectorItemClient}>{availableMission.client}</Text>
                            <Text style={styles.missionSelectorItemLocation}>{availableMission.location}</Text>
                          </View>
                          <View style={styles.missionSelectorItemRight}>
                            <Text style={styles.missionSelectorItemType}>{availableMission.type}</Text>
                            <ArrowRight size={16} color="#94A3B8" />
                          </View>
                        </View>
                      </LinearGradient>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </LinearGradient>
            </View>
          </View>
        </Modal>

        <View style={styles.noMissionContainer}>
          <LinearGradient
            colors={['#1E293B', '#374151']}
            style={styles.noMissionGradient}
          >
            <Clipboard size={64} color="#64748B" />
            <Text style={styles.noMissionTitle}>AUCUNE MISSION SÉLECTIONNÉE</Text>
            <Text style={styles.noMissionText}>
              Vous devez sélectionner une mission depuis la page "Missions" pour commencer une visite.
            </Text>

            <TouchableOpacity
              style={styles.selectMissionButton}
              onPress={() => setShowMissionSelector(true)}
            >
              <LinearGradient
                colors={['#3B82F6', '#1D4ED8']}
                style={styles.selectMissionGradient}
              >
                <Clipboard size={20} color="#FFFFFF" />
                <Text style={styles.selectMissionText}>SÉLECTIONNER UNE MISSION</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.goToMissionsButton}
              onPress={() => router.push('/missions')}
            >
              <Text style={styles.goToMissionsText}>Aller à mes missions</Text>
              <ArrowRight size={16} color="#3B82F6" />
            </TouchableOpacity>
          </LinearGradient>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Camera size={64} color="#64748B" />
          <Text style={styles.permissionTitle}>Autorisation caméra requise</Text>
          <Text style={styles.permissionText}>
            Nous avons besoin d'accéder à votre caméra pour prendre des photos du chantier.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <LinearGradient
              colors={['#3B82F6', '#1D4ED8']}
              style={styles.permissionButtonGradient}
            >
              <Text style={styles.permissionButtonText}>AUTORISER LA CAMÉRA</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            setMission(null);
            setPhotos([]);
            setReportContent('');
            setReportValidated(false);
          }}
        >
          <X size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>VISITE SPS</Text>
          <Text style={styles.headerSubtitle}>{mission.title}</Text>
        </View>
        <TouchableOpacity
          style={styles.changeMissionButton}
          onPress={() => setShowMissionSelector(true)}
        >
          <RefreshCw size={20} color="#FFFFFF" />
        </TouchableOpacity>
        {uploadedPhotoUrls.length > 0 && (
          <TouchableOpacity
            style={styles.generateReportButton}
            onPress={saveVisit}
            disabled={savingVisit}
          >
            <LinearGradient
              colors={savingVisit ? ['#64748B', '#475569'] : ['#10B981', '#059669']}
              style={styles.generateReportGradient}
            >
              {savingVisit ? (
                <ActivityIndicator size={16} color="#FFFFFF" />
              ) : (
                <Save size={16} color="#FFFFFF" />
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {/* Mission Info */}
      <View style={styles.missionInfo}>
        <LinearGradient
          colors={['#1E293B', '#374151']}
          style={styles.missionInfoGradient}
        >
          <Text style={styles.missionTitle}>{mission.title}</Text>
          <Text style={styles.missionClient}>{mission.client}</Text>
          <Text style={styles.missionLocation}>{mission.location}</Text>
        </LinearGradient>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Photos Section */}
        <View style={styles.photosSection}>
          <View style={styles.photosSectionHeader}>
            <Text style={styles.sectionTitle}>{`PHOTOS DU CHANTIER \n`}             ({photos.length}/10)</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {hasExistingVisit && existingReportId && !hasChanges ? (
                <TouchableOpacity
                  style={styles.generateReportButton}
                  onPress={() => {
                    router.push(`/rapports`);
                  }}
                >
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.generateReportGradient}
                  >
                    <Eye size={16} color="#FFFFFF" />
                    <Text style={styles.generateReportText}>
                      Détails rapport
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              ) : photos.length >= 3 && (
                <TouchableOpacity
                  style={styles.generateReportButton}
                  onPress={generateReport}
                  disabled={generatingReport}
                >
                  <LinearGradient
                    colors={generatingReport ? ['#64748B', '#475569'] : ['#8B5CF6', '#A855F7']}
                    style={styles.generateReportGradient}
                  >
                    {generatingReport ? (
                      <ActivityIndicator size={16} color="#FFFFFF" />
                    ) : (
                      <FileText size={16} color="#FFFFFF" />
                    )}
                    <Text style={styles.generateReportText}>
                      {generatingReport ? 'Génération...' : 'Générer \nrapport'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Add Photo Button */}
          {photos.length < 10 && reportStatus !== 'valide' && (
            <TouchableOpacity
              style={styles.addPhotoButton}
              onPress={() => setShowCamera(true)}
            >
              <LinearGradient
                colors={['#3B82F6', '#1D4ED8']}
                style={styles.addPhotoGradient}
              >
                <Camera size={24} color="#FFFFFF" />
                <Text style={styles.addPhotoText}>PRENDRE UNE PHOTO</Text>
                <Text style={styles.addPhotoSubtext}>L'IA analysera automatiquement la sécurité</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Photos Grid */}
          {photos.length > 0 && (
            <View style={styles.photosGrid}>
              {photos.map((photo, index) => (
                <TouchableOpacity
                  key={photo.id}
                  style={styles.photoCard}
                  onPress={() => {
                    setSelectedPhoto(photo);
                    setTempComments(photo.userComments);
                    setShowPhotoDetail(true);
                  }}
                >
                  <Image source={{ uri: photo.uri }} style={styles.photoImage} />

                  {/* Photo Overlay */}
                  <View style={styles.photoOverlay}>
                    <View style={styles.photoHeader}>
                      <Text style={styles.photoNumber}>#{index + 1}</Text>
                      {photo.validated && (
                        <View style={styles.validatedBadge}>
                          <CheckCircle size={12} color="#FFFFFF" />
                        </View>
                      )}
                    </View>

                    {photo.aiAnalysis ? (
                      <View style={styles.photoFooter}>
                        <View style={[
                          styles.riskBadge,
                          { backgroundColor: getRiskColor(photo.aiAnalysis.riskLevel) }
                        ]}>
                          <Text style={styles.riskText}>
                            {getRiskLabel(photo.aiAnalysis.riskLevel)}
                          </Text>
                        </View>
                        <Text style={styles.confidenceText}>
                          {photo.aiAnalysis.confidence}% confiance
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.analyzingBadge}>
                        <ActivityIndicator size={12} color="#FFFFFF" />
                        <Text style={styles.analyzingText}>Analyse IA...</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Analysis in Progress */}
          {analyzingPhoto && (
            <View style={styles.analyzingContainer}>
              <LinearGradient
                colors={['#8B5CF6', '#A855F7']}
                style={styles.analyzingGradient}
              >
                <ActivityIndicator size={20} color="#FFFFFF" />
                <Text style={styles.analyzingTitle}>ANALYSE IA EN COURS</Text>
                <Text style={styles.analyzingSubtitle}>
                  L'intelligence artificielle analyse la photo pour identifier les risques sécurité...
                </Text>
              </LinearGradient>
            </View>
          )}
        </View>

        {/* Instructions */}
        {photos.length === 0 && (
          <View style={styles.instructionsSection}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.instructionsGradient}
            >
              <Sparkles size={32} color="#3B82F6" />
              <Text style={styles.instructionsTitle}>VISITE ASSISTÉE PAR IA</Text>
              <Text style={styles.instructionsText}>
                1. Prenez des photos du chantier (3 minimum)
              </Text>
              <Text style={styles.instructionsText}>
                2. L'IA analysera automatiquement chaque photo
              </Text>
              <Text style={styles.instructionsText}>
                3. Validez ou modifiez les analyses
              </Text>
              <Text style={styles.instructionsText}>
                4. Générez et envoyez votre rapport
              </Text>
            </LinearGradient>
          </View>
        )}
      </ScrollView>

      {/* Camera Modal */}
      <Modal visible={showCamera} animationType="slide">
        <View style={styles.cameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
          >
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraHeader}>
                <TouchableOpacity
                  style={styles.cameraCloseButton}
                  onPress={() => setShowCamera(false)}
                >
                  <X size={24} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>PHOTO {photos.length + 1}/10</Text>
                <TouchableOpacity
                  style={styles.cameraFlipButton}
                  onPress={() => setFacing(current => current === 'back' ? 'front' : 'back')}
                >
                  <RotateCcw size={24} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <View style={styles.cameraFooter}>
                <TouchableOpacity
                  style={styles.captureButton}
                  onPress={takePhoto}
                >
                  <LinearGradient
                    colors={['#3B82F6', '#1D4ED8']}
                    style={styles.captureButtonGradient}
                  >
                    <Camera size={32} color="#FFFFFF" />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </CameraView>
        </View>
      </Modal>

      {/* Photo Detail Modal */}
      <Modal visible={showPhotoDetail} animationType="slide" transparent>
        <View style={styles.photoDetailOverlay}>
          <View style={styles.photoDetailModal}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.photoDetailGradient}
            >
              {selectedPhoto && (
                <>
                  <View style={styles.photoDetailHeader}>
                    <Text style={styles.photoDetailTitle}>
                      PHOTO #{photos.findIndex(p => p.id === selectedPhoto.id) + 1}
                    </Text>
                    <View style={styles.photoDetailActions}>
                      {reportStatus !== 'valide' && (!mission || (mission as any).originalStatus !== 'terminee') && (
                        <TouchableOpacity
                          style={styles.deletePhotoButton}
                          onPress={() => deletePhoto(selectedPhoto.id)}
                        >
                          <Trash2 size={20} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.closePhotoDetailButton}
                        onPress={() => setShowPhotoDetail(false)}
                      >
                        <X size={20} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <ScrollView style={styles.photoDetailContent} showsVerticalScrollIndicator={false}>
                    {/* Photo */}
                    <Image source={{ uri: selectedPhoto.uri }} style={styles.detailPhotoImage} />

                    {/* AI Analysis */}
                    {selectedPhoto.aiAnalysis ? (
                      <View style={styles.aiAnalysisSection}>
                        <View style={styles.aiAnalysisHeader}>
                          <Sparkles size={20} color="#8B5CF6" />
                          <Text style={styles.aiAnalysisTitle}>ANALYSE IA</Text>
                          <View style={[
                            styles.riskBadgeDetail,
                            { backgroundColor: getRiskColor(selectedPhoto.aiAnalysis.riskLevel) }
                          ]}>
                            <Text style={styles.riskTextDetail}>
                              {getRiskLabel(selectedPhoto.aiAnalysis.riskLevel)}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.confidenceDetail}>
                          Confiance: {selectedPhoto.aiAnalysis.confidence}%
                        </Text>

                        {/* Observations */}
                        <View style={styles.analysisBlock}>
                          <Text style={styles.analysisBlockTitle}>OBSERVATIONS</Text>
                          {selectedPhoto.aiAnalysis.observations.map((obs, index) => (
                            <View key={index} style={styles.analysisItem}>
                              <Eye size={14} color="#94A3B8" />
                              <Text style={styles.analysisText}>{obs}</Text>
                            </View>
                          ))}
                        </View>

                        {/* Recommendations */}
                        <View style={styles.analysisBlock}>
                          <Text style={styles.analysisBlockTitle}>RECOMMANDATIONS</Text>
                          {selectedPhoto.aiAnalysis.recommendations.map((rec, index) => (
                            <View key={index} style={styles.analysisItem}>
                              <AlertTriangle size={14} color="#F59E0B" />
                              <Text style={styles.analysisText}>{rec}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.analyzingDetailContainer}>
                        <ActivityIndicator size={24} color="#8B5CF6" />
                        <Text style={styles.analyzingDetailText}>Analyse IA en cours...</Text>
                      </View>
                    )}

                    {/* User Comments */}
                    <View style={styles.commentsSection}>
                      <View style={styles.commentsSectionHeader}>
                        <Text style={styles.commentsSectionTitle}>COMMENTAIRES</Text>
                        {reportStatus !== 'valide' && (!mission || (mission as any).originalStatus !== 'terminee') && (
                          <TouchableOpacity
                            style={styles.editCommentsButton}
                            onPress={() => setEditingComments(true)}
                          >
                            <Edit3 size={16} color="#3B82F6" />
                          </TouchableOpacity>
                        )}
                      </View>

                      {editingComments ? (
                        <View style={styles.commentsEditContainer}>
                          <TextInput
                            style={styles.commentsInput}
                            placeholder="Ajoutez vos commentaires..."
                            placeholderTextColor="#64748B"
                            value={tempComments}
                            onChangeText={setTempComments}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                          />
                          <View style={styles.commentsActions}>
                            <TouchableOpacity
                              style={styles.cancelCommentsButton}
                              onPress={() => {
                                setEditingComments(false);
                                setTempComments(selectedPhoto.userComments);
                              }}
                            >
                              <Text style={styles.cancelCommentsText}>ANNULER</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.saveCommentsButton}
                              onPress={saveComments}
                            >
                              <LinearGradient
                                colors={['#10B981', '#059669']}
                                style={styles.saveCommentsGradient}
                              >
                                <Check size={16} color="#FFFFFF" />
                                <Text style={styles.saveCommentsText}>SAUVEGARDER</Text>
                              </LinearGradient>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.commentsDisplay}>
                          {selectedPhoto.userComments ? (
                            <Text style={styles.commentsText}>{selectedPhoto.userComments}</Text>
                          ) : (
                            <Text style={styles.noCommentsText}>Aucun commentaire ajouté</Text>
                          )}
                        </View>
                      )}
                    </View>
                  </ScrollView>

                  {/* Validation Button */}
                  {selectedPhoto.aiAnalysis && !selectedPhoto.validated && (
                    <View style={styles.photoDetailFooter}>
                      <TouchableOpacity
                        style={styles.validatePhotoButton}
                        onPress={() => validatePhoto(selectedPhoto.id)}
                      >
                        <LinearGradient
                          colors={['#10B981', '#059669']}
                          style={styles.validatePhotoGradient}
                        >
                          <CheckCircle size={20} color="#FFFFFF" />
                          <Text style={styles.validatePhotoText}>VALIDER L'ANALYSE</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Report Modal */}
      <Modal visible={showReportModal} animationType="slide" transparent>
        <View style={styles.reportModalOverlay}>
          <View style={styles.reportModal}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.reportModalGradient}
            >
              <View style={styles.reportModalHeader}>
                <Text style={styles.reportModalTitle}>RAPPORT DE VISITE  </Text>
                <View style={styles.reportModalActions}>
                  {(!mission || (mission as any).originalStatus !== 'terminee') && (
                    <TouchableOpacity
                      style={styles.editReportButton}
                      onPress={() => setEditingReport(!editingReport)}
                    >
                      <Edit3 size={20} color={editingReport ? "#F59E0B" : "#3B82F6"} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.closeReportButton}
                    onPress={() => setShowReportModal(false)}
                  >
                    <X size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView style={styles.reportContent} showsVerticalScrollIndicator={false}>
                {editingReport ? (
                  <View>
                    <Text style={styles.editSectionLabel}>EN-TÊTE</Text>
                    <TextInput
                      style={styles.reportTextInput}
                      value={reportHeader}
                      onChangeText={setReportHeader}
                      multiline
                      numberOfLines={5}
                      textAlignVertical="top"
                      placeholder="En-tête du rapport..."
                      placeholderTextColor="#64748B"
                    />
                    <Text style={styles.editSectionLabel}>OBSERVATIONS</Text>
                    <TextInput
                      style={styles.reportTextInput}
                      value={reportContent}
                      onChangeText={setReportContent}
                      multiline
                      numberOfLines={10}
                      textAlignVertical="top"
                      placeholder="Observations principales..."
                      placeholderTextColor="#64748B"
                    />
                    <Text style={styles.editSectionLabel}>CONCLUSION</Text>
                    <TextInput
                      style={styles.reportTextInput}
                      value={reportFooter}
                      onChangeText={setReportFooter}
                      multiline
                      numberOfLines={5}
                      textAlignVertical="top"
                      placeholder="Conclusion et recommandations..."
                      placeholderTextColor="#64748B"
                    />
                  </View>
                ) : (
                  <View>
                    <Text style={styles.reportText}>{reportHeader}</Text>
                    <View style={styles.reportPhotoSeparator} />
                    {photos.map((photo, index) => (
                      <View key={photo.id} style={styles.reportPhotoSection}>
                        <Image
                          source={{ uri: photo.uri }}
                          style={styles.reportPhotoImage}
                          resizeMode="cover"
                        />
                        <View style={styles.reportPhotoDetails}>
                          <Text style={styles.reportPhotoTitle}>
                            Photo {index + 1} - Niveau de risque: {photo.aiAnalysis?.riskLevel?.toUpperCase() || 'N/A'}
                          </Text>
                          {photo.aiAnalysis && (
                            <>
                              <Text style={styles.reportSectionTitle}>Observations:</Text>
                              {photo.aiAnalysis.observations.map((obs, i) => (
                                <Text key={i} style={styles.reportListItem}>• {obs}</Text>
                              ))}
                              <Text style={styles.reportSectionTitle}>Recommandations:</Text>
                              {photo.aiAnalysis.recommendations.map((rec, i) => (
                                <Text key={i} style={styles.reportListItem}>• {rec}</Text>
                              ))}
                            </>
                          )}
                          {photo.userComments && (
                            <>
                              <Text style={styles.reportSectionTitle}>💬 Commentaires du coordonnateur:</Text>
                              <Text style={styles.reportCommentText}>{photo.userComments}</Text>
                            </>
                          )}
                        </View>
                        <View style={styles.reportPhotoSeparator} />
                      </View>
                    ))}
                    <Text style={styles.reportText}>{reportFooter}</Text>
                  </View>
                )}
              </ScrollView>
              <View style={styles.reportModalFooter}>
                <TouchableOpacity
                  style={[
                    styles.validateReportButton,
                    reportSaved && styles.validateReportButtonActive
                  ]}
                  onPress={saveReportAndVisit}
                  disabled={reportSaved || isSavingReport}
                >
                  <View style={styles.validateReportContent}>
                    {isSavingReport ? (
                      <ActivityIndicator size={20} color={reportSaved ? "#FFFFFF" : "#3B82F6"} />
                    ) : reportSaved ? (
                      <CheckCircle size={20} color="#FFFFFF" />
                    ) : (
                      <Save size={20} color="#3B82F6" />
                    )}
                    <Text style={[
                      styles.validateReportText,
                      reportSaved && styles.validateReportTextActive
                    ]}>
                      {isSavingReport ? 'ENREGISTREMENT...' : reportSaved ? 'RAPPORT ENREGISTRÉ' : 'ENREGISTRER LE RAPPORT'}
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.sendReportButton,
                    !reportSaved && styles.sendReportButtonDisabled
                  ]}
                  onPress={sendReport}
                  disabled={!reportSaved}
                >
                  <LinearGradient
                    colors={reportSaved ? ['#3B82F6', '#1D4ED8'] : ['#64748B', '#475569']}
                    style={styles.sendReportGradient}
                  >
                    <Send size={20} color="#FFFFFF" />
                    <Text style={styles.sendReportText}>Envoyer</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* Mission Selector Modal */}
      <Modal visible={showMissionSelector} animationType="slide" transparent>
        <View style={styles.missionSelectorOverlay}>
          <View style={styles.missionSelectorModal}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.missionSelectorGradient}
            >
              <View style={styles.missionSelectorHeader}>
                <Text style={styles.missionSelectorTitle}>SÉLECTIONNER UNE MISSION</Text>
                <TouchableOpacity
                  style={styles.closeMissionSelectorButton}
                  onPress={() => setShowMissionSelector(false)}
                >
                  <X size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.missionSelectorContent} showsVerticalScrollIndicator={false}>
                {availableMissions.map((availableMission) => (
                  <TouchableOpacity
                    key={availableMission.id}
                    style={styles.missionSelectorItem}
                    onPress={() => selectMission(availableMission)}
                  >
                    <LinearGradient
                      colors={['#374151', '#4B5563']}
                      style={styles.missionSelectorItemGradient}
                    >
                      <View style={styles.missionSelectorItemContent}>
                        <View style={styles.missionSelectorItemLeft}>
                          <Text style={styles.missionSelectorItemTitle}>{availableMission.title}</Text>
                          <Text style={styles.missionSelectorItemClient}>{availableMission.client}</Text>
                          <Text style={styles.missionSelectorItemLocation}>{availableMission.location}</Text>
                        </View>
                        <View style={styles.missionSelectorItemRight}>
                          <Text style={styles.missionSelectorItemType}>{availableMission.type}</Text>
                          <ArrowRight size={16} color="#94A3B8" />
                        </View>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </LinearGradient>
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
  noMissionContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  noMissionGradient: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
    borderRadius: 20,
  },
  noMissionTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 12,
    textAlign: 'center',
  },
  noMissionText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  selectMissionButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  selectMissionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 8,
  },
  selectMissionText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  goToMissionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  goToMissionsText: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    color: '#3B82F6',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 20,
  },
  permissionTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  permissionButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 20,
  },
  permissionButtonGradient: {
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  permissionButtonText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerContent: {
    flex: 1,
  },
  changeMissionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    // marginLeft: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    marginTop: 2,
  },
  missionInfo: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  missionInfoGradient: {
    padding: 16,
  },
  missionTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  missionClient: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    marginBottom: 2,
  },
  missionLocation: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  photosSection: {
    marginBottom: 40,
  },
  photosSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    letterSpacing: 1,
  },
  generateReportButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  generateReportGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  generateReportText: {
    fontSize: 11,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  addPhotoButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
  },
  addPhotoGradient: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  addPhotoText: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: 8,
  },
  addPhotoSubtext: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.8,
    marginTop: 4,
    textAlign: 'center',
  },
  photosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  photoCard: {
    width: (width - 52) / 2,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: 8,
    justifyContent: 'space-between',
  },
  photoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  photoNumber: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  validatedBadge: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    padding: 4,
  },
  photoFooter: {
    gap: 4,
  },
  riskBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  riskText: {
    fontSize: 9,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  confidenceText: {
    fontSize: 10,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.8,
  },
  analyzingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(139, 92, 246, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  analyzingText: {
    fontSize: 9,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
  analyzingContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 20,
  },
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
  instructionsSection: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 20,
  },
  instructionsGradient: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  instructionsTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 20,
  },
  instructionsText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    marginBottom: 8,
    textAlign: 'center',
  },
  // Camera styles
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'space-between',
  },
  cameraHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  cameraCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  cameraFlipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraFooter: {
    alignItems: 'center',
    paddingBottom: 60,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
  },
  captureButtonGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Photo Detail Modal styles
  photoDetailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  photoDetailModal: {
    height: '90%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  photoDetailGradient: {
    flex: 1,
  },
  photoDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  photoDetailTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  photoDetailActions: {
    flexDirection: 'row',
    gap: 12,
  },
  deletePhotoButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePhotoDetailButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDetailContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  detailPhotoImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 20,
  },
  aiAnalysisSection: {
    backgroundColor: '#374151',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  aiAnalysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  aiAnalysisTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    flex: 1,
    marginLeft: 8,
  },
  riskBadgeDetail: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  riskTextDetail: {
    fontSize: 10,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  confidenceDetail: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    marginBottom: 16,
  },
  analysisBlock: {
    marginBottom: 16,
  },
  analysisBlockTitle: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    letterSpacing: 1,
    marginBottom: 8,
  },
  analysisItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  analysisText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 18,
  },
  analyzingDetailContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  analyzingDetailText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
  },
  commentsSection: {
    backgroundColor: '#374151',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  commentsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  commentsSectionTitle: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    letterSpacing: 1,
  },
  editCommentsButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentsEditContainer: {
    gap: 12,
  },
  commentsInput: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  commentsActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelCommentsButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelCommentsText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  saveCommentsButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  saveCommentsGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  saveCommentsText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  commentsDisplay: {
    minHeight: 40,
    justifyContent: 'center',
  },
  commentsText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  noCommentsText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
    fontStyle: 'italic',
  },
  photoDetailFooter: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  validatePhotoButton: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  validatePhotoGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  validatePhotoText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  // Report Modal styles
  reportModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  reportModal: {
    height: '80%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  reportModalGradient: {
    flex: 1,
  },
  reportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  reportModalTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  reportModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editReportButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeReportButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  reportText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  reportPhotoSection: {
    marginBottom: 24,
  },
  reportPhotoImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
  },
  reportPhotoDetails: {
    backgroundColor: '#374151',
    borderRadius: 12,
    padding: 16,
  },
  reportPhotoTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  reportSectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter-SemiBold',
    color: '#F59E0B',
    marginTop: 12,
    marginBottom: 6,
  },
  reportListItem: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#E5E7EB',
    lineHeight: 18,
    marginBottom: 4,
  },
  reportCommentText: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#A5B4FC',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  reportPhotoSeparator: {
    height: 2,
    backgroundColor: '#475569',
    marginTop: 16,
    borderRadius: 1,
  },
  editSectionLabel: {
    fontSize: 12,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    marginTop: 16,
    marginBottom: 8,
    letterSpacing: 1,
  },
  reportTextInput: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    lineHeight: 20,
    backgroundColor: '#374151',
    borderRadius: 12,
    padding: 16,
    minHeight: 120,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  reportModalFooter: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#374151',
    gap: 12,
  },
  validateReportButton: {
    flex: 1.5,
    backgroundColor: '#374151',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validateReportButtonActive: {
    backgroundColor: '#10B981',
  },
  validateReportContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  validateReportText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  validateReportTextActive: {
    color: '#FFFFFF',
  },
  sendReportButton: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  sendReportButtonDisabled: {
    opacity: 0.5,
  },
  sendReportGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  sendReportText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  // Mission Selector Modal styles
  missionSelectorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  missionSelectorModal: {
    height: '85%',
    borderRadius: 24,
    overflow: 'hidden',
  },
  missionSelectorGradient: {
    flex: 1,
    // paddingTop: 24,
    alignItems: 'center',
  },
  missionSelectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
    paddingBottom: 16,
    paddingTop: 24,
  },
  missionSelectorTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  closeMissionSelectorButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionSelectorContent: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    // paddingHorizontal: 24,
  },
  missionSelectorItem: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  missionSelectorItemGradient: {
    padding: 16,
  },
  missionSelectorItemContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  missionSelectorItemLeft: {
    flex: 1,
  },
  missionSelectorItemTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  missionSelectorItemClient: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    marginBottom: 2,
  },
  missionSelectorItemLocation: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
  },
  missionSelectorItemRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  missionSelectorItemType: {
    fontSize: 10,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    textAlign: 'right',
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
});