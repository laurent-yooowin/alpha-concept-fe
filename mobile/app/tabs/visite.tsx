import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  TextInput,
  Alert,
  Image,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { Camera, ArrowLeft, RotateCcw, Check, X, Plus, FileText, Send, CreditCard as Edit3, Sparkles, Eye, MessageSquare, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Clock, Trash2, Clipboard, ArrowRight, RefreshCw, Save, NotebookPen, ImagePlus, Pencil, FolderDown } from 'lucide-react-native';
import * as MediaLibrary from 'expo-media-library';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { visitService } from '@/services/visitService';
import { reportService } from '@/services/reportService';
import { uploadService } from '@/services/uploadService';
import { aiService } from '@/services/aiService';
import { getMissionStatusInfo } from '@/utils/missionHelpers';
import { pdfService } from '@/services/pdfService';
import * as Linking from 'expo-linking';
import * as MailComposer from 'expo-mail-composer';
import { useAuth } from '@/contexts/AuthContext';
import { missionService } from '@/services/missionService';
import { userService } from '@/services/userService';
import { Visit } from 'src/visits/visit.entity';
import { reportsAPI } from '../../../frontend/src/lib/api';
import { ImageManipulator } from 'expo-image-manipulator';

const { width, height } = Dimensions.get('window');

interface Photo {
  id: string;
  uri: string;
  s3Url?: string;
  timestamp: Date;
  groupId: string;
  isDirectiveOnly?: boolean;
  isDetailPhoto?: boolean;
  isReadabilityPhoto?: boolean;
  detailContext?: string; // which unreadable section this detail photo targets
  aiAnalysis?: {
    observations: string[];
    recommendations: string[];
    references: string[];
    riskLevel: 'low' | 'medium' | 'high';
    confidence: number;
    unreadableSections?: string[];
  };
  comment: string;
  userDirectives: string;
  validated: boolean;
}

interface ReportGroup {
  groupId: string;
  photos: Photo[];
  isDirectiveOnly: boolean;
  directives: string;
  comment: string;
  aiAnalysis?: Photo['aiAnalysis'];
  timestamp: Date;
}

interface Mission {
  id: string;
  title: string;
  client: string;
  status: string;
  nextVisit: string;
  location: string;
  description: string;
  alerts: string;
  completion: string;
  gradient: string;
  statusLabel: string;
  originalStatus: string;
  type: string;
  date: string;
  time: string;
  refClient: string;
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  visits: any[];
  notSentReport: any[]
}

export default function VisiteScreen() {
  const params = useLocalSearchParams();
  // const user = useAuth();
  const [userProfile, setUserProfile] = useState<any>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [availableMissions, setAvailableMissions] = useState<Mission[]>([]);
  const [showMissionSelector, setShowMissionSelector] = useState(false);

  // États pour la caméra
  const [showCamera, setShowCamera] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const reportScrollRef = useRef<ScrollView>(null);

  // États pour les photos et analyses
  const [photos, setPhotosState] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const setPhotos = useCallback((updater: Photo[] | ((prev: Photo[]) => Photo[])) => {
    setPhotosState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      photosRef.current = next;
      return next;
    });
  }, []);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [showPhotoDetail, setShowPhotoDetail] = useState(false);
  const [editingComments, setEditingComments] = useState(false);
  const [tempComments, setTempComments] = useState('');
  const [editingDirectives, setEditingDirectives] = useState(false);
  const [tempDirectives, setTempDirectives] = useState('');

  // États pour le rapport
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [reportHeader, setReportHeader] = useState('');
  const [reportFooter, setReportFooter] = useState('');
  const [editingReport, setEditingReport] = useState(false);
  const [reportValidated, setReportValidated] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);
  const [reportSended, setReportSended] = useState(false);
  const [isSavingReport, setIsSavingReport] = useState(false);

  // États de chargement
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [loadingMission, setLoadingMission] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [uploadedPhotoUrls, setUploadedPhotoUrls] = useState<string[]>([]);
  const [showPdfLoadingModal, setShowPdfLoadingModal] = useState(false);
  const [pdfLoadingProgress, setPdfLoadingProgress] = useState('Préparation du document...');

  // États pour visite existante
  const [hasExistingVisit, setHasExistingVisit] = useState(false);
  const [existingVisitId, setExistingVisitId] = useState<string | null>(null);
  const [existingReportId, setExistingReportId] = useState<string | null>(null);
  const [showVisitDetailModal, setShowVisitDetailModal] = useState(false);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showVisitsModal, setShowVisitsModal] = useState(false);
  const [selection, setSelection] = useState({ start: 2, end: 2 });

  // Multi-photo selection modal states
  const [showMultiPhotoModal, setShowMultiPhotoModal] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<{ uri: string; id: string }[]>([]);
  const [multiPhotoDirectives, setMultiPhotoDirectives] = useState('');
  const [isAnalyzingMultiple, setIsAnalyzingMultiple] = useState(false);
  const [multiAnalysisProgress, setMultiAnalysisProgress] = useState('');
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);

  const [directivesHeight, setDirectivesHeight] = useState(80);

  // Photo editor states
  const [showPhotoEditorModal, setShowPhotoEditorModal] = useState(false);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [editingPhotoUri, setEditingPhotoUri] = useState<string | null>(null);
  const [editorScale, setEditorScale] = useState(1);
  const [editorRotation, setEditorRotation] = useState(0);
  const [editorFlipH, setEditorFlipH] = useState(false);
  const [editorFlipV, setEditorFlipV] = useState(false);

  // Directive-only modal states
  const [showDirectiveOnlyModal, setShowDirectiveOnlyModal] = useState(false);
  const [directiveOnlyText, setDirectiveOnlyText] = useState('');
  const [directiveOnlyComment, setDirectiveOnlyComment] = useState('');

  // Selected group for detail view
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showGroupDetail, setShowGroupDetail] = useState(false);

  // Group detail editing states
  const [editingGroupDirectives, setEditingGroupDirectives] = useState(false);
  const [editingGroupComments, setEditingGroupComments] = useState(false);
  const [tempGroupDirectives, setTempGroupDirectives] = useState('');
  const [tempGroupComments, setTempGroupComments] = useState('');
  const [groupDirectivesHeight, setGroupDirectivesHeight] = useState(80);
  const [groupCommentsHeight, setGroupCommentsHeight] = useState(80);
  const [isRegeneratingGroup, setIsRegeneratingGroup] = useState(false);

  // Group report editing states
  const [editingGroupReport, setEditingGroupReport] = useState(false);
  const [tempGroupObservations, setTempGroupObservations] = useState<string[]>([]);
  const [tempGroupRecommendations, setTempGroupRecommendations] = useState<string[]>([]);
  const [tempGroupReferences, setTempGroupReferences] = useState<string[]>([]);

  // Global report directives
  const [globalDirectivesHeight, setGlobalDirectivesHeight] = useState(80);
  const [isRegeneratingAllGroups, setIsRegeneratingAllGroups] = useState(false);
  const [regeneratingAllProgress, setRegeneratingAllProgress] = useState('');

  // Image zoom modal
  const [showImageZoom, setShowImageZoom] = useState(false);
  const [zoomedImageUri, setZoomedImageUri] = useState<string | null>(null);

  // Detail photo workflow states
  const [addingDetailToGroupId, setAddingDetailToGroupId] = useState<string | null>(null);
  const [isAddingDetailPhotos, setIsAddingDetailPhotos] = useState(false);

  // Unreadable sections modal states
  const [showUnreadableSectionsModal, setShowUnreadableSectionsModal] = useState(false);
  const [unreadableTargetGroupId, setUnreadableTargetGroupId] = useState<string | null>(null);
  const [unreadableSectionsList, setUnreadableSectionsList] = useState<string[]>([]);
  const [sectionPhotosMapState, setSectionPhotosMapState] = useState<{ [section: string]: { uri: string; id: string }[] }>({});
  const sectionPhotosMapRef = useRef<{ [section: string]: { uri: string; id: string }[] }>({});
  const setSectionPhotosMap = useCallback((updater: { [section: string]: { uri: string; id: string }[] } | ((prev: { [section: string]: { uri: string; id: string }[] }) => { [section: string]: { uri: string; id: string }[] })) => {
    setSectionPhotosMapState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      sectionPhotosMapRef.current = next;
      return next;
    });
  }, []);
  const sectionPhotosMap = sectionPhotosMapState;
  const [isProcessingUnreadable, setIsProcessingUnreadable] = useState(false);
  const [unreadableProgress, setUnreadableProgress] = useState('');
  const [selectedUnreadableSection, setSelectedUnreadableSection] = useState<string | null>(null);
  const [pendingDetailPhotosState, setPendingDetailPhotosState] = useState<{ uri: string; id: string }[]>([]);
  const pendingDetailPhotosRef = useRef<{ uri: string; id: string }[]>([]);
  const setPendingDetailPhotos = useCallback((updater: { uri: string; id: string }[] | ((prev: { uri: string; id: string }[]) => { uri: string; id: string }[])) => {
    setPendingDetailPhotosState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      pendingDetailPhotosRef.current = next;
      return next;
    });
  }, []);

  // Compute report groups from photos
  const reportGroups: ReportGroup[] = React.useMemo(() => {
    const groups: { [key: string]: Photo[] } = {};
    photos.forEach(photo => {
      const gid = photo.groupId || photo.id;
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(photo);
    });
    return Object.entries(groups).map(([groupId, groupPhotos]) => ({
      groupId,
      photos: groupPhotos,
      isDirectiveOnly: groupPhotos[0]?.isDirectiveOnly || false,
      directives: groupPhotos[0]?.userDirectives || '',
      comment: groupPhotos[0]?.comment || '',
      aiAnalysis: groupPhotos[0]?.aiAnalysis,
      timestamp: groupPhotos[0]?.timestamp,
    }));
  }, [photos]);

  useFocusEffect(
    useCallback(() => {
      setMission(null);
      if (params.mission) {
        try {
          const missionData = JSON.parse(params.mission as string);
          selectMission(missionData, missionData.visitId, true);
          // setMission(missionData);
        } catch (error) {
          console.error('Erreur parsing chantier:', error);
        }
      } else {
        loadAvailableMissions();
      }
    }, [params.mission])
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

  const loadMissions = async () => {
    try {
      setLoadingMission(true);
      const response = await missionService.getMissions();
      if (response.data && Array.isArray(response.data)) {
        const backendMissions = [];
        response.data.map((mission: any) => {
          const missionStatusInfo = getMissionStatusInfo(mission.status);
          const newMission = {
            id: mission.id,
            title: mission.title?.toUpperCase() || 'CHANTIER SANS TITRE',
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
            type: mission.type || 'CSPS',
            contact: {
              firstName: mission.contactFirstName || '',
              lastName: mission.contactLastName || '',
              email: mission.contactEmail || '',
              phone: mission.contactPhone || ''
            },
            date: mission.date,
            time: mission.time,
            refClient: mission.refClient,
            visits: mission.visits
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
      console.log('Erreur lors du chargement des chantiers:', error);
      // setMissions([]);
      return [];
    } finally {
      setLoadingMission(false);
    }
  };

  const loadAvailableMissions = async () => {
    try {
      if (!userProfile) {
        await loadUserProfile();
      }
      // Charger les chantiers utilisateur depuis AsyncStorage
      // const userMissions = await AsyncStorage.getItem('userMissions');
      // const parsedUserMissions = userMissions ? JSON.parse(userMissions) : [];
      const parsedUserMissions = await loadMissions();
      setAvailableMissions(prev => parsedUserMissions);
      return parsedUserMissions;
    } catch (error) {
      console.error('Erreur chargement chantiers:', error);
      return [];
    }
  };

  const selectMission = async (selectedMissionParam: any, visitId?: string | null, isInitVisit?: boolean) => {
    const parsedUserMissions = await loadAvailableMissions();
    if (isInitVisit) {
      await selectVisit(selectedMissionParam, visitId);
    } else {
      const createVisit = {
        id: null,
        missionId: selectedMissionParam.id,
        visitDate: new Date().toLocaleDateString('fr-FR'),
        userId: selectedMissionParam.userId
      };
      const selectedMission = parsedUserMissions.find(m => m.id === selectedMissionParam.id);
      if (selectedMission && selectedMission.visits?.length > 0 && selectedMission.status != 'terminee') {
        if (!selectedMission.visits.some(v => !v.id)) {
          selectedMission.visits.unshift(createVisit);
        }
        // const notSentReport: { hasNotSentReport: boolean; visitId: string | null | undefined; reportId: any; }[] = [];
        // selectedMission.visits.forEach(visit => {
        //   if (visit.report && visit.report.status != 'envoye_au_client' && selectedMission.status != "terminee") {
        //     notSentReport.push({ hasNotSentReport: true, visitId: visitId, reportId: visit.report.id });
        //   }
        // });
        // selectedMission.notSentReport = notSentReport;
      } else {
        selectedMission.visits = [createVisit];
      }
      setShowMissionSelector(false);
      setMission(selectedMission);
      setShowVisitsModal(true);
    }
  };

  const selectVisit = async (selectedMission: any, visitId: string | null) => {
    setShowVisitsModal(false);
    setLoadingMission(true);
    setReportSended(false);
    if (!mission || mission.id !== selectedMission.id) {
      setPhotos([]);
      setReportContent('');
      setVisitNotes('');
      setReportValidated(false);
      // console.log('selectedMission >>> ', selectedMission)
    }
    await loadExistingVisitData(selectedMission.id, visitId);
    // setMission(selectedMission);
  };

  const loadExistingVisitData = async (missionId: string, visitId: string | null) => {
    try {
      setExistingReportId(null);
      if (!userProfile) {
        await loadUserProfile();
      }
      if (!missionId) return;
      setLoadingMission(true);
      // const response = await visitService.getVisits(missionId);
      const missionData = await missionService.getMission(missionId);
      if (missionData?.data) {
        const visits = [];
        missionData.data.visits?.map(v => visits.push({ ...v, photos: [] }));
        setMission({
          ...missionData.data,
          visits: visits,
          contact: {
            firstName: missionData.data.contactFirstName || '',
            lastName: missionData.data.contactLastName || '',
            email: missionData.data.contactEmail || '',
            phone: missionData.data.contactPhone || ''
          }
        });
        if (visitId) {
          setPhotos([]);
          setVisitNotes('');
          const visits = missionData.data?.visits?.filter(v => v.id == visitId);
          const visit = visits?.length > 0 ? visits[0] : null;
          if (missionData.data && missionData.data.status === 'terminee' ||
            visit && visit.report && visit.report.status == "envoye_au_client") {
            setReportSended(true);
          }
          setHasExistingVisit(true);
          setExistingVisitId(visitId);
          if (visit && visit.report) {
            setExistingReportId(visit.report.id);
            setReportStatus(visit.report.status);
          }
          setHasChanges(false);
          if (visit && visit.photos && visit.photos.length > 0) {
            const loadedPhotos: Photo[] = await Promise.all(visit.photos?.map(async (photo: any) => {
              const riskLevelMap: { [key: string]: 'low' | 'medium' | 'high' } = {
                'faible': 'low',
                'moyen': 'medium',
                'eleve': 'high',
                'low': 'low',
                'medium': 'medium',
                'high': 'high'
              };

              let fileUri = "";
              if (!photo.isDirectiveOnly) {
                const fileName = photo.uri.split('/').pop();
                fileUri = `${FileSystem.cacheDirectory}${fileName}`;
                console.log("Photo n'existe pas >>> : ", photo.uri);
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
                  console.log('photo.uri >>> : ', photo.uri);
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
                uri: fileUri || photo.s3Url,
                s3Url: photo.s3Url,
                timestamp: new Date(photo.createdAt || Date.now()),
                groupId: photo.groupId || photo.id || `photo-${Date.now()}-${Math.random()}`,
                isDirectiveOnly: photo.isDirectiveOnly || false,
                isDetailPhoto: photo.isDetailPhoto || false,
                isReadabilityPhoto: photo.isReadabilityPhoto || false,
                detailContext: photo.detailContext || '',
                aiAnalysis: photo.analysis ? {
                  observations: observations ? observations : [],
                  recommendations: recommendations ? recommendations : [],
                  references: refs || [],
                  riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
                  confidence: (photo.analysis.confidence || 0),
                  unreadableSections: Array.isArray(photo.analysis.unreadableSections) ? photo.analysis.unreadableSections : [],
                } : undefined,
                comment: photo.comment || '',
                userDirectives: photo.userDirectives || '',
                validated: photo.validated || true
              };
            }));

            setPhotos(loadedPhotos);
            setUploadedPhotoUrls(visit.photos?.map((p: any) => p.s3Url || p.uri).filter(Boolean));
          }

          setVisitNotes(visit?.notes || '');

          if (visit && visit.reportGenerated) {
            setReportValidated(true);
          }
        } else {
          setVisitNotes('');
          setExistingVisitId(null);
          setHasExistingVisit(false);
        }
      } else {
        setReportStatus('brouillon')
        setReportSended(false);
        setHasExistingVisit(false);
        setExistingVisitId(null);
        setExistingReportId(null);
      }
    } catch (error) {
      console.error('Erreur chargement visite existante:', error);
      setHasExistingVisit(false);
      setExistingVisitId(null);
      setExistingReportId(null);
    } finally {
      setLoadingMission(false);
    }
  };

  // Simulation d'analyse IA pour une photo
  const analyzePhoto = async (photoUri: string): Promise<Photo['aiAnalysis']> => {
    try {
      // Use backend AI analysis
      const response = await aiService.analyzePhoto(photoUri);
      console.log('analisis response >>> : ', response);

      if (response.data) {
        const nonPhotoConfiormityMsgExists = response.data.nonConformities && response.data.nonConformities.length > 0;
        const conformityMsgExist = response.data.photoConformityMessage && response.data.photoConformityMessage.trim() != "";
        let refs = response.data.references;
        if (refs && !Array.isArray(refs)) {
          refs = refs.split(', ').filter((s: string) => s.length > 0);
        }

        let observations = response.data.observations;
        if (observations && !Array.isArray(observations)) {
          observations = observations.split(', ').filter((s: string) => s.length > 0);
        }

        let nonConformities = response.data.nonConformities;
        if (nonConformities && !Array.isArray(nonConformities)) {
          nonConformities = nonConformities.split(', ').filter((s: string) => s.length > 0);
        }

        let photoConformityMessage = response.data.photoConformityMessage;
        if (photoConformityMessage && !Array.isArray(photoConformityMessage)) {
          photoConformityMessage = photoConformityMessage.split(', ').filter((s: string) => s.length > 0);
        }

        let recommendations = response.data.recommendations;
        if (recommendations && !Array.isArray(recommendations)) {
          recommendations = recommendations.split(', ').filter((s: string) => s.length > 0);
        }
        console.log('observations >>> : ', observations);

        let unreadableSections = response.data.unreadableSections;
        if (unreadableSections && !Array.isArray(unreadableSections)) {
          unreadableSections = String(unreadableSections).split(', ').filter((s: string) => s.length > 0);
        }

        const analysis = {
          observations: nonPhotoConfiormityMsgExists ? nonConformities : photoConformityMessage || observations,
          recommendations: recommendations,
          riskLevel: response.data.riskLevel === 'faible' ? 'low' : response.data.riskLevel === 'moyen' ? 'medium' : 'high',
          confidence: parseInt(response.data.confidence || 0),
          photoConformity: conformityMsgExist ? false : response.data.photoConformity || true,
          photoConformityMessage: response.data.photoConformityMessage || "",
          references: refs || [],
          unreadableSections: unreadableSections || [],
        };

        // Show unreadable sections modal if detected
        if (unreadableSections && unreadableSections.length > 0) {
          setTimeout(() => {
            // Find the group this photo belongs to - use latest photos state
            const latestGroupId = photos.length > 0 ? photos[photos.length - 1]?.groupId : null;
            openUnreadableSectionsModal(latestGroupId || 'pending', unreadableSections);
          }, 500);
        }

        return analysis;
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      // Fallback to mock data if AI fails
    }

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
        confidence: 92,
        references: []
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
        confidence: 88,
        references: []
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
        confidence: 85,
        references: []
      }
    ];

    return analyses[Math.floor(Math.random() * analyses.length)];
  };

  const analyzePhotoWithDirectives = async (photoUri: string): Promise<Photo['aiAnalysis']> => {
    setHasChanges(true);
    setReportSaved(false);
    try {
      // console.log('selectedPhoto.analysis >>> : ', selectedPhoto.aiAnalysis);
      const previousReport = JSON.stringify(selectedPhoto.aiAnalysis);
      // Use backend AI analysis
      const response: any = await aiService.analyzePhotoWithDirectives(photoUri, tempDirectives, previousReport);
      // console.log('analyzePhotoWithDirectives response >>> : ', response);

      if (response.data) {
        const nonPhotoConfiormityMsgExists = response.data.nonConformities && response.data.nonConformities.length > 0;
        const conformityMsgExist = response.data.photoConformityMessage && response.data.photoConformityMessage.trim() != "";
        let refs = response.data.references;
        if (refs && !Array.isArray(refs)) {
          refs = refs.split(', ').filter((s: string) => s.length > 0);
        }

        let observations = response.data.observations;
        if (observations && !Array.isArray(observations)) {
          observations = observations.split(', ').filter((s: string) => s.length > 0);
        }

        let nonConformities = response.data.nonConformities;
        if (nonConformities && !Array.isArray(nonConformities)) {
          nonConformities = nonConformities.split(', ').filter((s: string) => s.length > 0);
        }

        let photoConformityMessage = response.data.photoConformityMessage;
        if (photoConformityMessage && !Array.isArray(photoConformityMessage)) {
          photoConformityMessage = photoConformityMessage.split(', ').filter((s: string) => s.length > 0);
        }

        let recommendations = response.data.recommendations;
        if (recommendations && !Array.isArray(recommendations)) {
          recommendations = recommendations.split(', ').filter((s: string) => s.length > 0);
        }

        let unreadableSections = response.data.unreadableSections;
        if (unreadableSections && !Array.isArray(unreadableSections)) {
          unreadableSections = String(unreadableSections).split(', ').filter((s: string) => s.length > 0);
        }

        return {
          observations: nonPhotoConfiormityMsgExists ? nonConformities : photoConformityMessage || observations,
          recommendations: recommendations,
          riskLevel: response.data.riskLevel === 'faible' ? 'low' : response.data.riskLevel === 'moyen' ? 'medium' : 'high',
          confidence: parseInt(response.data.confidence || 0),
          photoConformity: conformityMsgExist ? false : response.data.photoConformity || true,
          photoConformityMessage: response.data.photoConformityMessage || "",
          references: refs || [],
          unreadableSections: unreadableSections || [],
        };
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      // Fallback to mock data if AI fails
    }

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
        confidence: 92,
        references: []
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
        confidence: 88,
        references: []
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
        confidence: 85,
        references: []
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
        // If adding detail photo to a specific group
        if (addingDetailToGroupId) {
          const targetGroupId = addingDetailToGroupId;
          const targetSection = selectedUnreadableSection;
          setShowCamera(false);

          if (targetSection) {
            const newSectionPhoto = {
              id: `section-${Date.now()}`,
              uri: photo.uri,
            };
            const nextSectionPhotosMap = {
              ...sectionPhotosMapRef.current,
              [targetSection]: [...(sectionPhotosMapRef.current[targetSection] || []), newSectionPhoto],
            };

            setSectionPhotosMap(nextSectionPhotosMap);

            Alert.alert(
              'Photo de détail prise',
              'La photo a été ajoutée à la section illisible. Voulez-vous en prendre une autre ou lancer l\'analyse enrichie ?',
              [
                {
                  text: 'Prendre une autre',
                  onPress: () => {
                    setSelectedUnreadableSection(targetSection);
                    setAddingDetailToGroupId(targetGroupId);
                    setShowCamera(true);
                  },
                },
                {
                  text: 'Retour aux sections',
                  onPress: () => setShowUnreadableSectionsModal(true),
                },
                {
                  text: 'Analyser',
                  style: 'default',
                  onPress: async () => {
                    await processUnreadableSectionPhotos(nextSectionPhotosMap);
                  },
                },
              ]
            );
            return;
          }

          const capturedDetailPhoto = {
            id: `detail-capture-${Date.now()}`,
            uri: photo.uri,
          };
          const nextPendingDetailPhotos = [...pendingDetailPhotosRef.current, capturedDetailPhoto];
          setPendingDetailPhotos(nextPendingDetailPhotos);

          Alert.alert(
            'Photo de détail prise',
            'Voulez-vous prendre une autre photo de détail ou lancer l\'analyse enrichie ?',
            [
              {
                text: 'Prendre une autre',
                onPress: () => {
                  setAddingDetailToGroupId(targetGroupId);
                  setShowCamera(true);
                },
              },
              {
                text: 'Analyser',
                style: 'default',
                onPress: async () => {
                  await processDetailPhotosForGroup(targetGroupId, nextPendingDetailPhotos);
                },
              },
            ]
          );
          return;
        }

        const newPendingPhoto = {
          id: Date.now().toString(),
          uri: photo.uri,
        };

        // Add to pending photos and ask if take more or proceed
        setPendingPhotos(prev => [...prev, newPendingPhoto]);
        setShowCamera(false);

        Alert.alert(
          'Photo prise',
          'Voulez-vous prendre une autre photo ou procéder à l\'analyse ?',
          [
            {
              text: 'Prendre une autre',
              onPress: () => setShowCamera(true),
            },
            {
              text: 'Analyser',
              style: 'default',
              onPress: () => {
                setShowMultiPhotoModal(true);
              },
            },
          ]
        );
      }
    } catch (error) {
      console.error('Erreur prise de photo:', error);
      Alert.alert('Erreur', 'Impossible de prendre la photo');
    }
  };

  // Pick multiple photos from gallery
  const pickPhotosFromGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Veuillez autoriser l\'accès à la galerie pour sélectionner des photos.');
        return;
      }

      setIsLoadingPhotos(true);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 10 - photos.length,
      });

      if (!result.canceled && result.assets.length > 0) {
        if (addingDetailToGroupId && selectedUnreadableSection) {
          const targetSection = selectedUnreadableSection;
          const newSectionPhotos = result.assets.map((asset, index) => ({
            id: `section-${Date.now()}-${index}`,
            uri: asset.uri,
          }));
          const nextSectionPhotosMap = {
            ...sectionPhotosMapRef.current,
            [targetSection]: [...(sectionPhotosMapRef.current[targetSection] || []), ...newSectionPhotos],
          };

          setSectionPhotosMap(nextSectionPhotosMap);
          Alert.alert(
            'Photos de détail ajoutées',
            `${newSectionPhotos.length} photo(s) ajoutée(s) pour cette section illisible.`,
            [
              {
                text: 'Retour aux sections',
                onPress: () => setShowUnreadableSectionsModal(true),
              },
              {
                text: 'Analyser',
                style: 'default',
                onPress: async () => {
                  await processUnreadableSectionPhotos(nextSectionPhotosMap);
                },
              },
            ]
          );
          return;
        }

        if (addingDetailToGroupId) {
          const targetGroupId = addingDetailToGroupId;
          const newDetailPhotos = result.assets.map((asset, index) => ({
            id: `detail-gallery-${Date.now()}-${index}`,
            uri: asset.uri,
          }));
          const nextPendingDetailPhotos = [...pendingDetailPhotosRef.current, ...newDetailPhotos];
          setPendingDetailPhotos(nextPendingDetailPhotos);

          Alert.alert(
            'Photos de détail ajoutées',
            `${newDetailPhotos.length} photo(s) de détail ajoutée(s) au lot.`,
            [
              {
                text: 'Ajouter encore',
                onPress: () => setShowGroupDetail(true),
              },
              {
                text: 'Analyser',
                style: 'default',
                onPress: async () => {
                  await processDetailPhotosForGroup(targetGroupId, nextPendingDetailPhotos);
                },
              },
            ]
          );
          return;
        }

        const newPendingPhotos = result.assets.map((asset, index) => ({
          id: `${Date.now()}-${index}`,
          uri: asset.uri,
        }));

        setPendingPhotos(prev => [...prev, ...newPendingPhotos]);
        setShowMultiPhotoModal(true);
      }
    } catch (error) {
      console.error('Erreur sélection photos:', error);
      Alert.alert('Erreur', 'Impossible de sélectionner les photos');
    } finally {
      setIsLoadingPhotos(false);
    }
  };

  // Remove a pending photo with option to delete from device
  const removePendingPhoto = (photoId: string, photoUri: string) => {
    Alert.alert(
      'Supprimer la photo',
      'Voulez-vous aussi supprimer cette photo de votre appareil ?',
      [
        {
          text: 'Annuler',
          style: 'cancel',
        },
        {
          text: 'Retirer uniquement',
          onPress: () => {
            setPendingPhotos(prev => prev.filter(p => p.id !== photoId));
          },
        },
        {
          text: 'Supprimer de l\'appareil aussi',
          style: 'destructive',
          onPress: async () => {
            setPendingPhotos(prev => prev.filter(p => p.id !== photoId));
            try {
              const asset = await MediaLibrary.getAssetInfoAsync(photoUri);
              if (asset) {
                await MediaLibrary.deleteAssetsAsync([asset.id]);
              }
            } catch (error) {
              console.log('Impossible de supprimer du device:', error);
              // Silently fail - photo was at least removed from selection
            }
          },
        },
      ]
    );
  };

  // Open photo editor - try native editing first, fallback to in-app editor
  const openPhotoEditor = async (photoId: string, photoUri: string) => {
    try {
      // Try to open native editor via IntentLauncher or sharing
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets.length > 0) {
        const editedUri = result.assets[0].uri;
        setPendingPhotos(prev => prev.map(p =>
          p.id === photoId ? { ...p, uri: editedUri } : p
        ));
      }
    } catch (error) {
      console.error('Native editor not available, opening in-app editor');
      // Fallback: open in-app editor modal
      openInAppPhotoEditor(photoId, photoUri);
    }
  };

  // In-app photo editor with zoom, crop, flip, rotate
  const openInAppPhotoEditor = (photoId: string, photoUri: string) => {
    setEditingPhotoId(photoId);
    setEditingPhotoUri(photoUri);
    setEditorScale(1);
    setEditorRotation(0);
    setEditorFlipH(false);
    setEditorFlipV(false);
    setShowPhotoEditorModal(true);
  };

  // Apply editor changes using ImageManipulator
  const applyEditorChanges = async () => {
    if (!editingPhotoUri || !editingPhotoId) return;

    try {
      const actions: any[] = [];
      if (editorRotation !== 0) {
        actions.push({ rotate: editorRotation });
      }
      if (editorFlipH) {
        actions.push({ flip: 'horizontal' as const });
      }
      if (editorFlipV) {
        actions.push({ flip: 'vertical' as const });
      }

      if (actions.length > 0) {

        const context = ImageManipulator.manipulate(editingPhotoUri);

        for (const action of actions) {
          if (action.rotate !== undefined) {
            context.rotate(action.rotate);
          }
          if (action.flip !== undefined) {
            context.flip(action.flip === 'horizontal' ? 'Horizontal' : 'Vertical');
          }
        }

        const result = await context.renderAsync();
        const savedImage = await result.saveAsync({ compress: 0.8 });

        setPendingPhotos(prev => prev.map(p =>
          p.id === editingPhotoId ? { ...p, uri: savedImage.uri } : p
        ));
      }

      setShowPhotoEditorModal(false);
    } catch (error) {
      console.error('Error applying editor changes:', error);
      Alert.alert('Erreur', 'Impossible d\'appliquer les modifications');
    }
  };

  // Save photos to device gallery with folder selection
  const savePhotosToDevice = async () => {
    if (pendingPhotos.length === 0) return;

    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Veuillez autoriser l\'accès à la galerie pour sauvegarder les photos.');
        return;
      }

      setIsAnalyzingMultiple(true);
      setMultiAnalysisProgress('Sauvegarde des photos...');

      // Create album with mission name
      const albumName = mission?.title ? `CSPS - ${mission.title}` : 'CSPS Photos';

      for (let i = 0; i < pendingPhotos.length; i++) {
        const pending = pendingPhotos[i];
        setMultiAnalysisProgress(`Sauvegarde photo ${i + 1}/${pendingPhotos.length}...`);

        const asset = await MediaLibrary.createAssetAsync(pending.uri);
        const album = await MediaLibrary.getAlbumAsync(albumName);

        if (album) {
          await MediaLibrary.addAssetsToAlbumAsync([asset], album, true);
        } else {
          await MediaLibrary.createAlbumAsync(albumName, asset, true);
        }
      }

      Alert.alert('Succès', `${pendingPhotos.length} photo(s) sauvegardée(s) dans l'album "${albumName}".`);
    } catch (error) {
      console.error('Erreur sauvegarde photos:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder les photos sur l\'appareil.');
    } finally {
      setIsAnalyzingMultiple(false);
      setMultiAnalysisProgress('');
    }
  };

  // Cancel multi-photo modal
  const cancelMultiPhotoModal = () => {
    setPendingPhotos([]);
    setMultiPhotoDirectives('');
    setShowMultiPhotoModal(false);
  };

  // Save pending photos to device (without analysis)
  const savePendingPhotosOnly = async () => {
    if (pendingPhotos.length === 0) return;

    setIsAnalyzingMultiple(true);
    setMultiAnalysisProgress('Upload des photos...');
    const batchGroupId = `group-${Date.now()}`;

    try {
      for (let i = 0; i < pendingPhotos.length; i++) {
        const pending = pendingPhotos[i];
        setMultiAnalysisProgress(`Upload photo ${i + 1}/${pendingPhotos.length}...`);

        const newPhoto: Photo = {
          id: pending.id,
          uri: pending.uri,
          timestamp: new Date(),
          groupId: batchGroupId,
          comment: '',
          userDirectives: multiPhotoDirectives,
          validated: false,
        };

        setPhotos(prev => [...prev, newPhoto]);
        setHasChanges(true);

        // Upload photo
        let fileToUpload: Blob | string;
        if (Platform.OS === 'web') {
          const response = await fetch(pending.uri);
          fileToUpload = await response.blob();
        } else {
          fileToUpload = pending.uri;
        }

        try {
          const uploadResults = await uploadService.uploadVisitPhotos([fileToUpload]);
          if (uploadResults?.data && uploadResults.data?.length > 0) {
            const s3Url = uploadResults.data[0].url;
            setPhotos(prev => prev.map(p =>
              p.id === pending.id
                ? { ...p, s3Url: s3Url }
                : p
            ));
            setUploadedPhotoUrls(prev => [...prev, s3Url]);
          }
        } catch (error) {
          console.error('Erreur upload photo:', error);
        }
      }

      Alert.alert('Succès', `${pendingPhotos.length} photo(s) sauvegardée(s) avec succès.`);
    } catch (error) {
      console.error('Erreur sauvegarde photos:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder les photos.');
    } finally {
      setPendingPhotos([]);
      setMultiPhotoDirectives('');
      setShowMultiPhotoModal(false);
      setIsAnalyzingMultiple(false);
      setMultiAnalysisProgress('');
    }
  };

  // Process multiple photos: upload all then analyze as batch
  const processMultiplePhotos = async () => {
    if (pendingPhotos.length === 0) return;

    setIsAnalyzingMultiple(true);
    setShowMultiPhotoModal(false);
    setAnalyzingPhoto(true);
    const batchGroupId = `group-${Date.now()}`;
    let unreadableSections = null;

    try {
      // Step 1: Upload all photos first
      const uploadedPhotos: { id: string; uri: string; s3Url: string }[] = [];

      for (let i = 0; i < pendingPhotos.length; i++) {
        const pending = pendingPhotos[i];
        setMultiAnalysisProgress(`Upload photo ${i + 1}/${pendingPhotos.length}...`);

        const newPhoto: Photo = {
          id: pending.id,
          uri: pending.uri,
          timestamp: new Date(),
          groupId: batchGroupId,
          comment: '',
          userDirectives: multiPhotoDirectives,
          validated: false,
        };

        setPhotos(prev => [...prev, newPhoto]);
        setHasChanges(true);

        let fileToUpload: Blob | string;
        if (Platform.OS === 'web') {
          const response = await fetch(pending.uri);
          fileToUpload = await response.blob();
        } else {
          fileToUpload = pending.uri;
        }

        try {
          const uploadResults = await uploadService.uploadVisitPhotos([fileToUpload]);
          if (uploadResults?.data && uploadResults.data?.length > 0) {
            const s3Url = uploadResults.data[0].url;
            newPhoto.s3Url = s3Url;
            setPhotos(prev => prev.map(p =>
              p.id === pending.id ? { ...p, s3Url } : p
            ));
            setUploadedPhotoUrls(prev => [...prev, s3Url]);
            uploadedPhotos.push({ id: pending.id, uri: pending.uri, s3Url });
          } else {
            console.warn('Photo uploadée mais pas de S3 URL');
          }
        } catch (error) {
          console.error('Erreur upload photo:', error);
        }
      }

      // Step 2: Batch analyze all uploaded photos at once
      if (uploadedPhotos.length > 0) {
        setMultiAnalysisProgress(`Analyse IA de ${uploadedPhotos.length} photo(s) en cours...`);
        try {
          const imageUrls = uploadedPhotos.map(p => p.s3Url);
          const batchResult = await aiService.analyzeBatchPhotos(imageUrls, multiPhotoDirectives || undefined);

          if (batchResult?.data) {
            const batchAnalysis = batchResult.data;
            const nonPhotoConformityMsgExists = batchAnalysis.nonConformities && batchAnalysis.nonConformities.length > 0;
            const conformityMsgExist = batchAnalysis.photoConformityMessage && String(batchAnalysis.photoConformityMessage).trim() !== "";

            let refs = batchAnalysis.references;
            if (refs && !Array.isArray(refs)) refs = String(refs).split(', ').filter((s: string) => s.length > 0);
            let observations = batchAnalysis.observations;
            if (observations && !Array.isArray(observations)) observations = String(observations).split(', ').filter((s: string) => s.length > 0);
            let nonConformities = batchAnalysis.nonConformities;
            if (nonConformities && !Array.isArray(nonConformities)) nonConformities = String(nonConformities).split(', ').filter((s: string) => s.length > 0);
            let photoConformityMessage = batchAnalysis.photoConformityMessage;
            if (photoConformityMessage && !Array.isArray(photoConformityMessage)) photoConformityMessage = String(photoConformityMessage).split(', ').filter((s: string) => s.length > 0);
            let recommendations = batchAnalysis.recommendations;
            if (recommendations && !Array.isArray(recommendations)) recommendations = String(recommendations).split(', ').filter((s: string) => s.length > 0);

            unreadableSections = batchAnalysis.unreadableSections;
            if (unreadableSections && !Array.isArray(unreadableSections)) unreadableSections = String(unreadableSections).split(', ').filter((s: string) => s.length > 0);

            const sharedAnalysis = {
              observations: nonPhotoConformityMsgExists ? nonConformities : photoConformityMessage || observations,
              recommendations: recommendations,
              riskLevel: (batchAnalysis.riskLevel === 'faible' ? 'low' : batchAnalysis.riskLevel === 'moyen' ? 'medium' : 'high') as 'low' | 'medium' | 'high',
              confidence: parseInt(batchAnalysis.confidence || 0),
              photoConformity: conformityMsgExist ? false : batchAnalysis.photoConformity || true,
              photoConformityMessage: batchAnalysis.photoConformityMessage || "",
              references: refs || [],
              unreadableSections: unreadableSections || [],
            };

            // Show unreadable sections modal if detected in batch
            if (unreadableSections && unreadableSections.length > 0) {
              setTimeout(() => {
                openUnreadableSectionsModal(batchGroupId, unreadableSections);
              }, 500);
            }

            // Apply the same batch analysis to all uploaded photos
            setPhotos(prev => prev.map(p => {
              if (uploadedPhotos.some(up => up.id === p.id)) {
                return { ...p, aiAnalysis: sharedAnalysis };
              }
              return p;
            }));
          }
        } catch (error) {
          console.error('Erreur analyse IA batch:', error);
          Alert.alert('Erreur', 'L\'analyse IA groupée a échoué.');
        }
      }

      const mergedPhotos = photos.map(p => {
        const match = uploadedPhotos.find(up => up.id === p.id);
        if (!match) return p;
        const analyzedPhoto = uploadedPhotos.find(up => up.id === p.id);
        return {
          ...p,
          s3Url: analyzedPhoto?.s3Url || p.s3Url,
          userDirectives: multiPhotoDirectives,
        };
      });

      await saveVisit(mergedPhotos, true);
      // Alert.alert('Succès', `${pendingPhotos.length} photo(s) traitée(s) avec succès.`);

      // Auto-show group report modal after analysis
      setSelectedGroupId(batchGroupId);
      // Show Group photos repport modal directly if no unreadableSections identified
      if (!unreadableSections || unreadableSections.length == 0) {
        setShowGroupDetail(true);
      }
      setTempGroupDirectives(multiPhotoDirectives || '');
      setTempGroupComments('');
    } catch (error) {
      console.error('Erreur traitement photos:', error);
      Alert.alert('Erreur', 'Erreur lors du traitement des photos.');
    } finally {
      setPendingPhotos([]);
      setMultiPhotoDirectives('');
      setIsAnalyzingMultiple(false);
      setAnalyzingPhoto(false);
      setMultiAnalysisProgress('');
    }
  };

  // Analyze photo with directives (for batch, without depending on selectedPhoto)
  const analyzePhotoWithDirectivesForBatch = async (photoUri: string, directives: string): Promise<Photo['aiAnalysis']> => {
    try {
      const response: any = await aiService.analyzePhotoWithDirectives(photoUri, directives, '');
      if (response.data) {
        let refs = response.data.references;
        if (refs && !Array.isArray(refs)) {
          refs = refs.split(', ').filter((s: string) => s.length > 0);
        }
        let observations = response.data.observations;
        if (observations && !Array.isArray(observations)) {
          observations = observations.split(', ').filter((s: string) => s.length > 0);
        }
        let nonConformities = response.data.nonConformities;
        if (nonConformities && !Array.isArray(nonConformities)) {
          nonConformities = nonConformities.split(', ').filter((s: string) => s.length > 0);
        }
        let photoConformityMessage = response.data.photoConformityMessage;
        if (photoConformityMessage && !Array.isArray(photoConformityMessage)) {
          photoConformityMessage = photoConformityMessage.split(', ').filter((s: string) => s.length > 0);
        }
        let recommendations = response.data.recommendations;
        if (recommendations && !Array.isArray(recommendations)) {
          recommendations = recommendations.split(', ').filter((s: string) => s.length > 0);
        }
        const nonPhotoConfiormityMsgExists = nonConformities && nonConformities.length > 0;
        const conformityMsgExist = response.data.photoConformityMessage && response.data.photoConformityMessage.trim() != "";
        let unreadableSections = response.data.unreadableSections;
        if (unreadableSections && !Array.isArray(unreadableSections)) {
          unreadableSections = String(unreadableSections).split(', ').filter((s: string) => s.length > 0);
        }
        return {
          observations: nonPhotoConfiormityMsgExists ? nonConformities : photoConformityMessage || observations,
          recommendations: recommendations,
          riskLevel: response.data.riskLevel === 'faible' ? 'low' : response.data.riskLevel === 'moyen' ? 'medium' : 'high',
          confidence: parseInt(response.data.confidence || 0),
          photoConformity: conformityMsgExist ? false : response.data.photoConformity || true,
          photoConformityMessage: response.data.photoConformityMessage || "",
          references: refs || [],
          unreadableSections: unreadableSections || [],
        };
      }
    } catch (error) {
      console.error('AI analysis error:', error);
    }
    return {
      observations: [],
      recommendations: [],
      riskLevel: 'low' as const,
      confidence: 0,
      references: [],
    };
  };

  const addDirectivesAndAnalyseAI = async () => {
    await saveDirectives();
    // Lancer l'analyse IA
    setAnalyzingPhoto(true);
    try {
      const analysis = await analyzePhotoWithDirectives(selectedPhoto.s3Url);
      console.log('analisis >>> : ', analysis);
      setPhotos(prev => prev.map(p =>
        p.id === selectedPhoto.id
          ? { ...p, aiAnalysis: analysis }
          : p
      ));
      setShowPhotoDetail(false);
    } catch (error) {
      console.error('Erreur analyse IA:', error);
      Alert.alert('Erreur', "Le rapport CSPS pour la photo n'a pas pu être effectuée.");
    } finally {
      setAnalyzingPhoto(false);
    }
  }

  // Save group directives
  const saveGroupDirectives = () => {
    if (!selectedGroupId) return;
    setPhotos(prev => prev.map(p =>
      (p.groupId || p.id) === selectedGroupId
        ? { ...p, userDirectives: tempGroupDirectives }
        : p
    ));
    setEditingGroupDirectives(false);
    setHasChanges(true);
    setReportSaved(false);
  };

  // Save group report edits (observations, recommendations, references)
  const saveGroupReportEdits = () => {
    if (!selectedGroupId) return;
    setPhotos(prev => prev.map(p => {
      if ((p.groupId || p.id) === selectedGroupId) {
        return {
          ...p,
          aiAnalysis: p.aiAnalysis ? {
            ...p.aiAnalysis,
            observations: tempGroupObservations,
            recommendations: tempGroupRecommendations,
            references: tempGroupReferences,
          } : p.aiAnalysis,
        };
      }
      return p;
    }));
    setEditingGroupReport(false);
    setHasChanges(true);
    setReportSaved(false);
    Alert.alert('Succès', 'Le rapport a été modifié avec succès.');
  };

  // Save group comments
  const saveGroupComments = () => {
    if (!selectedGroupId) return;
    setPhotos(prev => prev.map(p =>
      (p.groupId || p.id) === selectedGroupId
        ? { ...p, comment: tempGroupComments }
        : p
    ));
    setEditingGroupComments(false);
    setHasChanges(true);
    setReportSaved(false);
  };

  // Regenerate group report with directives
  const regenerateGroupReport = async () => {
    if (!selectedGroupId) return;
    const group = reportGroups.find(g => g.groupId === selectedGroupId);
    if (!group) return;

    const directivesToApply = tempGroupDirectives || group.directives;

    setIsRegeneratingGroup(true);
    setAnalyzingPhoto(true);
    try {
      let updatedPhotos = [...photos];
      if (group.isDirectiveOnly) {
        const missionContext = mission ? {
          title: mission.title,
          client: mission.client,
          address: mission.location,
          type: mission.type,
        } : undefined;

        const response = await aiService.analyzeDirectives(directivesToApply, missionContext);

        if (response.data) {
          const aiData = response.data as any;
          const obs = aiData.observations || aiData.nonConformities || [directivesToApply];
          const sharedAnalysis: Photo['aiAnalysis'] = {
            observations: Array.isArray(obs) ? obs : [obs],
            recommendations: aiData.recommendations || [],
            references: aiData.references || [],
            riskLevel: aiData.riskLevel === 'eleve' ? 'high' : aiData.riskLevel === 'moyen' ? 'medium' : 'low',
            confidence: aiData.confidence || 85,
          };

          updatedPhotos = updatedPhotos.map(p => {
            if ((p.groupId || p.id) === selectedGroupId) {
              return { ...p, aiAnalysis: sharedAnalysis, userDirectives: directivesToApply };
            }
            return p;
          });

          setPhotos(updatedPhotos);
          await saveVisit(updatedPhotos, true);
          setHasChanges(true);
          setReportSaved(false);
          Alert.alert('Succès', 'Le rapport directive a été régénéré avec succès.');
        }
      } else {
        if (group.photos.length === 0) return;
        const s3Urls = group.photos.filter(p => p.s3Url).map(p => p.s3Url!);
        if (s3Urls.length === 0) {
          Alert.alert('Erreur', 'Aucune photo uploadée trouvée dans ce groupe.');
          return;
        }

        const batchResult = await aiService.analyzeBatchPhotos(s3Urls, directivesToApply || undefined);

        if (batchResult?.data) {
          const batchAnalysis = batchResult.data;
          const nonPhotoConformityMsgExists = batchAnalysis.nonConformities && batchAnalysis.nonConformities.length > 0;
          const conformityMsgExist = batchAnalysis.photoConformityMessage && String(batchAnalysis.photoConformityMessage).trim() !== "";

          let refs = batchAnalysis.references;
          if (refs && !Array.isArray(refs)) refs = String(refs).split(', ').filter((s: string) => s.length > 0);
          let observations = batchAnalysis.observations;
          if (observations && !Array.isArray(observations)) observations = String(observations).split(', ').filter((s: string) => s.length > 0);
          let nonConformities = batchAnalysis.nonConformities;
          if (nonConformities && !Array.isArray(nonConformities)) nonConformities = String(nonConformities).split(', ').filter((s: string) => s.length > 0);
          let photoConformityMessage = batchAnalysis.photoConformityMessage;
          if (photoConformityMessage && !Array.isArray(photoConformityMessage)) photoConformityMessage = String(photoConformityMessage).split(', ').filter((s: string) => s.length > 0);
          let recommendations = batchAnalysis.recommendations;
          if (recommendations && !Array.isArray(recommendations)) recommendations = String(recommendations).split(', ').filter((s: string) => s.length > 0);

          const sharedAnalysis = {
            observations: nonPhotoConformityMsgExists ? nonConformities : photoConformityMessage || observations,
            recommendations: recommendations,
            riskLevel: (batchAnalysis.riskLevel === 'faible' ? 'low' : batchAnalysis.riskLevel === 'moyen' ? 'medium' : 'high') as 'low' | 'medium' | 'high',
            confidence: parseInt(batchAnalysis.confidence || 0),
            photoConformity: conformityMsgExist ? false : batchAnalysis.photoConformity || true,
            photoConformityMessage: batchAnalysis.photoConformityMessage || "",
            references: refs || [],
          };

          updatedPhotos = updatedPhotos.map(p => {
            if ((p.groupId || p.id) === selectedGroupId) {
              return { ...p, aiAnalysis: sharedAnalysis, userDirectives: directivesToApply };
            }
            return p;
          });

          setPhotos(updatedPhotos);
          await saveVisit(updatedPhotos, true);
          Alert.alert('Succès', 'Le rapport du groupe a été régénéré avec les nouvelles directives.');
        }
      }
      setHasChanges(true);
      setReportSaved(false);
    } catch (error) {
      console.error('Erreur régénération groupe:', error);
      Alert.alert('Erreur', "L'analyse IA a échoué.");
    } finally {
      setIsRegeneratingGroup(false);
      setAnalyzingPhoto(false);
    }
  };

  // Regenerate ALL groups with global directives
  const regenerateAllGroupsWithGlobalDirectives = async () => {
    if (reportGroups.length === 0 || !visitNotes.trim()) {
      Alert.alert('Info', 'Veuillez saisir des directives globales avant de regénérer.');
      return;
    }

    setIsRegeneratingAllGroups(true);
    setAnalyzingPhoto(true);
    setRegeneratingAllProgress('Regénération en cours...');

    try {
      let nextPhotos = [...photos];

      for (let i = 0; i < reportGroups.length; i++) {
        const group = reportGroups[i];
        setRegeneratingAllProgress(`Groupe ${i + 1}/${reportGroups.length} en cours...`);

        try {
          // Build previousReport from existing group analysis
          const firstPhotoOfGroup = group.photos[0];
          const existingAnalysis = firstPhotoOfGroup?.aiAnalysis;
          let previousReport: string | undefined;
          if (existingAnalysis) {
            previousReport = JSON.stringify({
              observations: existingAnalysis.observations || [],
              recommendations: existingAnalysis.recommendations || [],
              references: existingAnalysis.references || [],
              riskLevel: existingAnalysis.riskLevel,
              confidence: existingAnalysis.confidence,
            });
          }

          if (group.isDirectiveOnly || group.photos.length === 0) {
            const missionContext = mission ? {
              title: mission.title,
              client: mission.client,
              address: mission.location,
              type: mission.type,
            } : undefined;

            const response = await aiService.analyzeDirectives(visitNotes, missionContext, previousReport);
            if (response?.data) {
              const aiData = response.data as any;
              const obs = aiData.observations || aiData.nonConformities || [visitNotes];
              const sharedAnalysis: Photo['aiAnalysis'] = {
                observations: Array.isArray(obs) ? obs : [obs],
                recommendations: aiData.recommendations || [],
                references: aiData.references || [],
                riskLevel: aiData.riskLevel === 'eleve' ? 'high' : aiData.riskLevel === 'moyen' ? 'medium' : 'low',
                confidence: aiData.confidence || 85,
              };

              nextPhotos = nextPhotos.map(p => {
                if ((p.groupId || p.id) === group.groupId) {
                  return { ...p, aiAnalysis: sharedAnalysis, userDirectives: visitNotes };
                }
                return p;
              });
            }
            continue;
          }

          const s3Urls = group.photos.filter(p => p.s3Url).map(p => p.s3Url!);
          if (s3Urls.length === 0) continue;

          const batchResult = await aiService.analyzeBatchPhotos(s3Urls, visitNotes, previousReport);
          if (batchResult?.data) {
            const batchAnalysis = batchResult.data;
            const nonPhotoConformityMsgExists = batchAnalysis.nonConformities && batchAnalysis.nonConformities.length > 0;
            const conformityMsgExist = batchAnalysis.photoConformityMessage && String(batchAnalysis.photoConformityMessage).trim() !== "";

            let refs = batchAnalysis.references;
            if (refs && !Array.isArray(refs)) refs = String(refs).split(', ').filter((s: string) => s.length > 0);
            let observations = batchAnalysis.observations;
            if (observations && !Array.isArray(observations)) observations = String(observations).split(', ').filter((s: string) => s.length > 0);
            let nonConformities = batchAnalysis.nonConformities;
            if (nonConformities && !Array.isArray(nonConformities)) nonConformities = String(nonConformities).split(', ').filter((s: string) => s.length > 0);
            let photoConformityMessage = batchAnalysis.photoConformityMessage;
            if (photoConformityMessage && !Array.isArray(photoConformityMessage)) photoConformityMessage = String(photoConformityMessage).split(', ').filter((s: string) => s.length > 0);
            let recommendations = batchAnalysis.recommendations;
            if (recommendations && !Array.isArray(recommendations)) recommendations = String(recommendations).split(', ').filter((s: string) => s.length > 0);

            const sharedAnalysis = {
              observations: nonPhotoConformityMsgExists ? nonConformities : photoConformityMessage || observations,
              recommendations: recommendations,
              riskLevel: (batchAnalysis.riskLevel === 'faible' ? 'low' : batchAnalysis.riskLevel === 'moyen' ? 'medium' : 'high') as 'low' | 'medium' | 'high',
              confidence: parseInt(batchAnalysis.confidence || 0),
              photoConformity: conformityMsgExist ? false : batchAnalysis.photoConformity || true,
              photoConformityMessage: batchAnalysis.photoConformityMessage || "",
              references: refs || [],
            };

            nextPhotos = nextPhotos.map(p => {
              if ((p.groupId || p.id) === group.groupId) {
                return { ...p, aiAnalysis: sharedAnalysis, userDirectives: visitNotes };
              }
              return p;
            });
          }
        } catch (groupError) {
          console.error(`Erreur régénération groupe ${i + 1}:`, groupError);
        }
      }

      setPhotos(nextPhotos);
      await saveVisit(nextPhotos, true);
      setHasChanges(true);
      setReportSaved(false);
      Alert.alert('Succès', 'Tous les groupes ont été regénérés avec les directives globales.');
    } catch (error) {
      console.error('Erreur régénération globale:', error);
      Alert.alert('Erreur', "La regénération globale a échoué.");
    } finally {
      setIsRegeneratingAllGroups(false);
      setAnalyzingPhoto(false);
      setRegeneratingAllProgress('');
    }
  };

  const deletePhotoFromServer = async (photo: Photo) => {
    if (!photo?.s3Url) return;
    try {
      await uploadService.deletePhotoByUrl(photo?.s3Url);
      const photosParam = photos.filter(p => p.id !== photo.id);
      setPhotos(prev => photosParam);
      // await saveVisit(photosParam);
      setHasChanges(true);
      setReportSaved(false);
      Alert.alert('Succès', 'Photo suppriméee du serveur');
    } catch (error) {
      console.error('Erreur suppression photo S3:', error);
      Alert.alert('Erreur', 'Impossible de supprimer la photo du serveur');
    }
  };

  const handleDeleteAttachedPhotoMobile = async (photo: Photo, groupId: string) => {
    Alert.alert(
      'Supprimer la photo jointe',
      'Cette photo sera supprimée du serveur et du groupe. Confirmer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: async () => {
            try {
              if (photo.s3Url) {
                try { await uploadService.deletePhotoByUrl(photo.s3Url); } catch (e) { console.error('S3 delete error:', e); }
              }
              const updatedPhotos = photosRef.current.filter(p => p.id !== photo.id);
              setPhotos(updatedPhotos);
              setHasChanges(true);
              setReportSaved(false);
              if (existingVisitId) {
                await visitService.updateVisit(existingVisitId, { photos: updatedPhotos as any });
              }
              Alert.alert('Succès', 'Photo jointe supprimée');
            } catch (error) {
              console.error('Erreur suppression photo jointe:', error);
              Alert.alert('Erreur', 'Impossible de supprimer la photo');
            }
          }
        }
      ]
    );
  };

  const processDetailPhotosForGroup = async (targetGroupId: string, detailSources: { id: string; uri: string }[]) => {
    if (!detailSources.length) return;

    try {
      setIsAddingDetailPhotos(true);
      setIsLoadingPhotos(false);
      setAnalyzingPhoto(true);
      setShowGroupDetail(false);

      const group = reportGroups.find(g => g.groupId === targetGroupId);
      const previousAnalysis = group?.aiAnalysis || null;
      const previousUnreadable = group?.aiAnalysis?.unreadableSections || [];

      let nextPhotosSnapshot = [...photosRef.current];
      const uploadedDetailPhotos: { id: string; uri: string; s3Url: string }[] = [];

      for (let i = 0; i < detailSources.length; i++) {
        const asset = detailSources[i];
        const photoId = `detail-${Date.now()}-${i}`;

        const newPhoto: Photo = {
          id: photoId,
          uri: asset.uri,
          timestamp: new Date(),
          groupId: targetGroupId,
          isDetailPhoto: true,
          detailContext: previousUnreadable.length > 0 ? previousUnreadable.join(' | ') : 'Photo de détail',
          comment: '',
          userDirectives: group?.directives || '',
          validated: false,
        };

        nextPhotosSnapshot = [...nextPhotosSnapshot, newPhoto];
        setPhotos(nextPhotosSnapshot);
        setHasChanges(true);

        // Upload
        let fileToUpload: Blob | string;
        if (Platform.OS === 'web') {
          const response = await fetch(asset.uri);
          fileToUpload = await response.blob();
        } else {
          fileToUpload = asset.uri;
        }

        try {
          const uploadResults = await uploadService.uploadVisitPhotos([fileToUpload]);
          if (uploadResults?.data && uploadResults.data?.length > 0) {
            const s3Url = uploadResults.data[0].url;
            newPhoto.s3Url = s3Url;
            nextPhotosSnapshot = nextPhotosSnapshot.map(p =>
              p.id === photoId ? { ...p, s3Url } : p
            );
            setPhotos(nextPhotosSnapshot);
            setUploadedPhotoUrls(prev => [...prev, s3Url]);
            uploadedDetailPhotos.push({ id: photoId, uri: asset.uri, s3Url });
          }
        } catch (error) {
          console.error('Erreur upload photo de détail:', error);
        }
      }

      if (uploadedDetailPhotos.length === 0) {
        Alert.alert('Erreur', 'Aucune photo de détail n\'a pu être uploadée.');
        setIsAddingDetailPhotos(false);
        setAnalyzingPhoto(false);
        return;
      }

      // Get ALL s3Urls of the group (original + new detail)
      const existingS3Urls = (group?.photos || []).filter(p => p.s3Url).map(p => p.s3Url!);
      const newS3Urls = uploadedDetailPhotos.map(up => up.s3Url);
      const allS3Urls = [...existingS3Urls, ...newS3Urls];

      // Enhanced re-analysis with context
      try {
        const enhancedResult = await aiService.analyzeBatchEnhanced(
          allS3Urls,
          previousAnalysis,
          previousUnreadable,
          group?.directives || undefined,
        );

        if (enhancedResult?.data) {
          const batchAnalysis = enhancedResult.data;
          const nonPhotoConformityMsgExists = batchAnalysis.nonConformities && batchAnalysis.nonConformities.length > 0;
          const conformityMsgExist = batchAnalysis.photoConformityMessage && String(batchAnalysis.photoConformityMessage).trim() !== "";

          let refs = batchAnalysis.references;
          if (refs && !Array.isArray(refs)) refs = String(refs).split(', ').filter((s: string) => s.length > 0);
          let observations = batchAnalysis.observations;
          if (observations && !Array.isArray(observations)) observations = String(observations).split(', ').filter((s: string) => s.length > 0);
          let nonConformities = batchAnalysis.nonConformities;
          if (nonConformities && !Array.isArray(nonConformities)) nonConformities = String(nonConformities).split(', ').filter((s: string) => s.length > 0);
          let photoConformityMessage = batchAnalysis.photoConformityMessage;
          if (photoConformityMessage && !Array.isArray(photoConformityMessage)) photoConformityMessage = String(photoConformityMessage).split(', ').filter((s: string) => s.length > 0);
          let recommendations = batchAnalysis.recommendations;
          if (recommendations && !Array.isArray(recommendations)) recommendations = String(recommendations).split(', ').filter((s: string) => s.length > 0);
          let unreadableSections = batchAnalysis.unreadableSections;
          if (unreadableSections && !Array.isArray(unreadableSections)) unreadableSections = String(unreadableSections).split(', ').filter((s: string) => s.length > 0);

          const enhancedAnalysis = {
            observations: nonPhotoConformityMsgExists ? nonConformities : photoConformityMessage || observations,
            recommendations: recommendations,
            riskLevel: (batchAnalysis.riskLevel === 'faible' ? 'low' : batchAnalysis.riskLevel === 'moyen' ? 'medium' : 'high') as 'low' | 'medium' | 'high',
            confidence: parseInt(batchAnalysis.confidence || 0),
            photoConformity: conformityMsgExist ? false : batchAnalysis.photoConformity || true,
            photoConformityMessage: batchAnalysis.photoConformityMessage || "",
            references: refs || [],
            unreadableSections: unreadableSections || [],
          };

          // Apply enhanced analysis to ALL photos in the group
          nextPhotosSnapshot = nextPhotosSnapshot.map(p => {
            if ((p.groupId || p.id) === targetGroupId) {
              return { ...p, aiAnalysis: enhancedAnalysis };
            }
            return p;
          });
          setPhotos(nextPhotosSnapshot);

          const resolvedCount = previousUnreadable.length - (unreadableSections?.length || 0);
          const remainingCount = unreadableSections?.length || 0;

          let successMsg = `${uploadedDetailPhotos.length} photo(s) de détail ajoutée(s). Rapport enrichi avec succès.`;
          if (resolvedCount > 0) {
            successMsg += `\n\n✅ ${resolvedCount} section(s) illisible(s) résolue(s).`;
          }
          if (remainingCount > 0) {
            successMsg += `\n\n⚠️ ${remainingCount} section(s) encore illisible(s) — vous pouvez ajouter d'autres photos de détail.`;
          }

          // Save visit with updated photos
          await saveVisit(nextPhotosSnapshot, true);

          Alert.alert('Analyse enrichie', successMsg, [
            {
              text: 'Voir le rapport',
              onPress: () => {
                setSelectedGroupId(targetGroupId);
                setShowGroupDetail(true);
              }
            },
            { text: 'OK', style: 'default' }
          ]);
        }
      } catch (error) {
        console.error('Erreur analyse enrichie:', error);
        Alert.alert('Erreur', "L'analyse enrichie a échoué. Les photos ont été ajoutées au groupe.");
        await saveVisit(nextPhotosSnapshot, true);
      }
    } catch (error) {
      console.error('Erreur ajout photos de détail:', error);
      Alert.alert('Erreur', 'Impossible d\'ajouter les photos de détail.');
    } finally {
      setIsAddingDetailPhotos(false);
      setAnalyzingPhoto(false);
      setAddingDetailToGroupId(null);
      setPendingDetailPhotos([]);
    }
  };

  // Add detail photos to an existing group for enhanced analysis
  const addDetailPhotosToGroup = async (targetGroupId: string) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Veuillez autoriser l\'accès à la galerie.');
        return;
      }

      setIsLoadingPhotos(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 10,
      });

      if (result.canceled || result.assets.length === 0) {
        setIsLoadingPhotos(false);
        return;
      }

      const selectedDetailPhotos = result.assets.map((asset, index) => ({
        id: `detail-gallery-${Date.now()}-${index}`,
        uri: asset.uri,
      }));

      setPendingDetailPhotos(selectedDetailPhotos);
      await processDetailPhotosForGroup(targetGroupId, selectedDetailPhotos);
    } catch (error) {
      console.error('Erreur ajout photos de détail:', error);
      Alert.alert('Erreur', 'Impossible d\'ajouter les photos de détail.');
      setIsLoadingPhotos(false);
    }
  };

  // Attach photos to a group (join to report without re-analysis)
  const attachPhotosToGroup = async (targetGroupId: string) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Veuillez autoriser l\'accès à la galerie.');
        return;
      }

      setIsLoadingPhotos(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 10,
      });

      if (result.canceled || result.assets.length === 0) {
        setIsLoadingPhotos(false);
        return;
      }

      setUploadingPhotos(true);
      const newPhotos: Photo[] = [];
      for (let i = 0; i < result.assets.length; i++) {
        const asset = result.assets[i];
        try {
          let fileToUpload: Blob | string;
          if (Platform.OS === 'web') {
            const response = await fetch(asset.uri);
            fileToUpload = await response.blob();
          } else {
            fileToUpload = asset.uri;
          }

          const fileName = `photo_attach_${Date.now()}_${i}.jpg`;
          const uploadResult = await uploadService.uploadSingleFile(fileToUpload, fileName);
          const s3Url = uploadResult?.data?.url || uploadResult?.url;

          if (s3Url) {
            newPhotos.push({
              id: `attach-${Date.now()}-${i}`,
              uri: asset.uri,
              s3Url,
              timestamp: new Date(),
              groupId: targetGroupId,
              comment: '',
              userDirectives: '',
              validated: false,
            });
          }
        } catch (error) {
          console.error(`Erreur upload photo jointe ${i}:`, error);
        }
      }

      if (newPhotos.length > 0) {
        const updatedPhotos = [...photos, ...newPhotos];
        setPhotos(updatedPhotos);
        await saveVisit(updatedPhotos, true);
        setHasChanges(true);
        setReportSaved(false);
        Alert.alert('Succès', `${newPhotos.length} photo(s) jointe(s) au rapport du groupe.`);
      } else {
        Alert.alert('Erreur', 'Aucune photo n\'a pu être uploadée.');
      }
    } catch (error) {
      console.error('Erreur joindre photos:', error);
      Alert.alert('Erreur', 'Impossible de joindre les photos.');
    } finally {
      setIsLoadingPhotos(false);
      setUploadingPhotos(false);
    }
  };

  // Open unreadable sections modal
  const openUnreadableSectionsModal = (groupId: string, sections: string[]) => {
    setUnreadableTargetGroupId(groupId);
    setUnreadableSectionsList(sections);
    setSectionPhotosMap({});
    setSelectedUnreadableSection(null);
    setShowUnreadableSectionsModal(true);
  };

  // Add photos for a specific unreadable section
  const addPhotosForSection = async (section: string) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Veuillez autoriser l\'accès à la galerie.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 5,
      });

      if (!result.canceled && result.assets.length > 0) {
        const newPhotos = result.assets.map((asset, i) => ({
          id: `section-${Date.now()}-${i}`,
          uri: asset.uri,
        }));
        setSectionPhotosMap(prev => ({
          ...prev,
          [section]: [...(prev[section] || []), ...newPhotos],
        }));
      }
    } catch (error) {
      console.error('Erreur sélection photos section:', error);
    }
  };

  // Take photo with camera for a specific section
  const takeCameraPhotoForSection = async (section: string) => {
    setSelectedUnreadableSection(section);
    setShowUnreadableSectionsModal(false);
    setTimeout(() => {
      setAddingDetailToGroupId(unreadableTargetGroupId);
      setShowCamera(true);
    }, 300);
  };

  // Remove a photo from a section
  const removeSectionPhoto = (section: string, photoId: string) => {
    setSectionPhotosMap(prev => ({
      ...prev,
      [section]: (prev[section] || []).filter(p => p.id !== photoId),
    }));
  };

  // Skip remaining unreadable sections (remove from analysis)
  const skipRemainingUnreadableSections = () => {
    if (!unreadableTargetGroupId) return;

    Alert.alert(
      'Ignorer les sections illisibles',
      'Les sections restantes seront retirées de la liste des sections illisibles. L\'analyse sera effectuée avec les informations disponibles.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          style: 'default',
          onPress: () => {
            // Remove unreadable sections from the group analysis
            setPhotos(prev => prev.map(p => {
              if ((p.groupId || p.id) === unreadableTargetGroupId && p.aiAnalysis) {
                return {
                  ...p,
                  aiAnalysis: {
                    ...p.aiAnalysis,
                    unreadableSections: [],
                  },
                };
              }
              return p;
            }));
            setHasChanges(true);
            setReportSaved(false);
            setShowUnreadableSectionsModal(false);
            saveVisit(undefined, true);
            Alert.alert('Succès', 'Les sections illisibles ont été ignorées. Le rapport sera généré avec les données disponibles.');
          },
        },
      ]
    );
  };

  // Process all section photos and re-analyze
  const processUnreadableSectionPhotos = async (sectionPhotosOverride?: { [section: string]: { uri: string; id: string }[] }) => {
    if (!unreadableTargetGroupId) return;

    const sectionPhotosSource = sectionPhotosOverride || sectionPhotosMapRef.current;
    const allSectionPhotos = Object.values(sectionPhotosSource).flat();
    if (allSectionPhotos.length === 0) {
      Alert.alert('Info', 'Aucune photo ajoutée. Veuillez ajouter des photos pour les sections illisibles ou les ignorer.');
      return;
    }

    setIsProcessingUnreadable(true);
    setShowUnreadableSectionsModal(false);
    setAnalyzingPhoto(true);

    try {
      const group = reportGroups.find(g => g.groupId === unreadableTargetGroupId);
      const previousAnalysis = group?.aiAnalysis || null;
      const previousUnreadable = [...unreadableSectionsList];

      // Upload all section photos
      const uploadedDetailPhotos: { id: string; uri: string; s3Url: string }[] = [];

      for (let i = 0; i < allSectionPhotos.length; i++) {
        const sectionPhoto = allSectionPhotos[i];
        setUnreadableProgress(`Upload photo ${i + 1}/${allSectionPhotos.length}...`);

        const photoId = `detail-${Date.now()}-${i}`;
        const newPhoto: Photo = {
          id: photoId,
          uri: sectionPhoto.uri,
          timestamp: new Date(),
          groupId: unreadableTargetGroupId,
          isDetailPhoto: true,
          isReadabilityPhoto: true,
          detailContext: Object.entries(sectionPhotosSource)
            .filter(([_, photos]) => photos.some(p => p.id === sectionPhoto.id))
            .map(([section]) => section)
            .join(' | '),
          comment: '',
          userDirectives: group?.directives || '',
          validated: false,
        };

        setPhotos(prev => [...prev, newPhoto]);
        setHasChanges(true);

        let fileToUpload: Blob | string;
        if (Platform.OS === 'web') {
          const response = await fetch(sectionPhoto.uri);
          fileToUpload = await response.blob();
        } else {
          fileToUpload = sectionPhoto.uri;
        }

        try {
          const uploadResults = await uploadService.uploadVisitPhotos([fileToUpload]);
          if (uploadResults?.data && uploadResults.data?.length > 0) {
            const s3Url = uploadResults.data[0].url;
            setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, s3Url } : p));
            setUploadedPhotoUrls(prev => [...prev, s3Url]);
            uploadedDetailPhotos.push({ id: photoId, uri: sectionPhoto.uri, s3Url });
          }
        } catch (error) {
          console.error('Erreur upload photo section:', error);
        }
      }

      if (uploadedDetailPhotos.length === 0) {
        Alert.alert('Erreur', 'Aucune photo n\'a pu être uploadée.');
        return;
      }

      // Get all S3 URLs for the group (original + new)
      const existingS3Urls = (group?.photos || []).filter(p => p.s3Url).map(p => p.s3Url!);
      const newS3Urls = uploadedDetailPhotos.map(up => up.s3Url);
      const allS3Urls = [...existingS3Urls, ...newS3Urls];

      setUnreadableProgress('Analyse IA enrichie en cours...');

      // Enhanced re-analysis
      const enhancedResult = await aiService.analyzeBatchEnhanced(
        allS3Urls, previousAnalysis, previousUnreadable, group?.directives || undefined,
      );

      if (enhancedResult?.data) {
        const ba = enhancedResult.data;
        let obs = ba.observations; if (obs && !Array.isArray(obs)) obs = String(obs).split(', ').filter((s: string) => s.length > 0);
        let recs = ba.recommendations; if (recs && !Array.isArray(recs)) recs = String(recs).split(', ').filter((s: string) => s.length > 0);
        let refs = ba.references; if (refs && !Array.isArray(refs)) refs = String(refs).split(', ').filter((s: string) => s.length > 0);
        let nc = ba.nonConformities; if (nc && !Array.isArray(nc)) nc = String(nc).split(', ').filter((s: string) => s.length > 0);
        let pcm = ba.photoConformityMessage; if (pcm && !Array.isArray(pcm)) pcm = String(pcm).split(', ').filter((s: string) => s.length > 0);
        let us = ba.unreadableSections; if (us && !Array.isArray(us)) us = String(us).split(', ').filter((s: string) => s.length > 0);
        const ncExists = nc && nc.length > 0;

        const enhancedAnalysis = {
          observations: ncExists ? nc : pcm || obs,
          recommendations: recs,
          references: refs || [],
          riskLevel: (ba.riskLevel === 'faible' ? 'low' : ba.riskLevel === 'moyen' ? 'medium' : 'high') as 'low' | 'medium' | 'high',
          confidence: parseInt(ba.confidence || 0),
          unreadableSections: us || [],
        };

        setPhotos(prev => prev.map(p => {
          if ((p.groupId || p.id) === unreadableTargetGroupId) {
            const isNewDetail = uploadedDetailPhotos.some(up => up.id === p.id);
            return {
              ...p,
              aiAnalysis: enhancedAnalysis,
              isDetailPhoto: p.isDetailPhoto || isNewDetail,
              isReadabilityPhoto: p.isReadabilityPhoto || isNewDetail,
            };
          }
          return p;
        }));

        await saveVisit(undefined, true);

        const resolved = previousUnreadable.length - (us?.length || 0);
        const remaining = us?.length || 0;

        if (remaining > 0) {
          // Still have unreadable sections - show modal again with updated list
          setTimeout(() => {
            Alert.alert(
              'Analyse enrichie',
              `✅ ${resolved} section(s) résolue(s)\n⚠️ ${remaining} section(s) encore illisible(s)`,
              [
                {
                  text: 'Ajouter d\'autres photos',
                  onPress: () => openUnreadableSectionsModal(unreadableTargetGroupId!, us),
                },
                {
                  text: 'Ignorer et continuer',
                  onPress: () => {
                    // Remove remaining unreadable sections
                    setPhotos(prev => prev.map(p => {
                      if ((p.groupId || p.id) === unreadableTargetGroupId && p.aiAnalysis) {
                        return { ...p, aiAnalysis: { ...p.aiAnalysis, unreadableSections: [] } };
                      }
                      return p;
                    }));
                    setHasChanges(true);
                    saveVisit(undefined, true);
                  },
                },
                {
                  text: 'Voir le rapport',
                  onPress: () => { setSelectedGroupId(unreadableTargetGroupId!); setShowGroupDetail(true); },
                },
              ]
            );
          }, 300);
        } else {
          Alert.alert('Analyse enrichie', `✅ Toutes les sections illisibles ont été résolues ! Le rapport a été mis à jour.`, [
            { text: 'Voir le rapport', onPress: () => { setSelectedGroupId(unreadableTargetGroupId!); setShowGroupDetail(true); } },
            { text: 'OK' },
          ]);
        }
      }
    } catch (error) {
      console.error('Erreur traitement sections illisibles:', error);
      Alert.alert('Erreur', 'L\'analyse enrichie a échoué.');
    } finally {
      setIsProcessingUnreadable(false);
      setAnalyzingPhoto(false);
      setUnreadableProgress('');
      setSectionPhotosMap({});
      setSelectedUnreadableSection(null);
      setAddingDetailToGroupId(null);
    }
  };

  // Supprimer une photo
  const deletePhoto = async (photo: Photo, isAlert = true) => {
    if (isAlert) {
      Alert.alert(
        'Supprimer la photo',
        'Êtes-vous sûr de vouloir supprimer cette photo et son analyse ?',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Supprimer',
            style: 'destructive',
            onPress: async () => {
              await deletePhotoFromServer(photo);
              if (selectedPhoto?.id === photo.id) {
                setShowPhotoDetail(false);
                setEditingComments(false);
                setEditingDirectives(false);
                setSelectedPhoto(null);
              }
            }
          }
        ]
      );
    } else {
      await deletePhotoFromServer(photo);
      if (selectedPhoto?.id === photo.id) {
        setShowPhotoDetail(false);
        setEditingComments(false);
        setEditingDirectives(false);
        setSelectedPhoto(null);
      }
      setAnalyzingPhoto(false);
    }
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

  // Create directive-only report entry (no photo) - with AI analysis
  const createDirectiveOnlyEntry = async () => {
    if (!directiveOnlyText.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir des directives');
      return;
    }

    setAnalyzingPhoto(true);

    try {
      // Call AI to analyze directives
      const missionContext = mission ? {
        title: mission.title,
        client: mission.client,
        address: mission.location,
        type: mission.type,
      } : undefined;

      const response = await aiService.analyzeDirectives(directiveOnlyText, missionContext);

      const groupId = `directive-${Date.now()}`;
      let aiAnalysis: Photo['aiAnalysis'] = {
        observations: [directiveOnlyText],
        recommendations: [],
        references: [],
        riskLevel: 'low',
        confidence: 100,
      };

      if (response.data) {
        const aiData = response.data as any;
        const obs = aiData.observations || aiData.nonConformities || [directiveOnlyText];
        aiAnalysis = {
          observations: Array.isArray(obs) ? obs : [obs],
          recommendations: aiData.recommendations || [],
          references: aiData.references || [],
          riskLevel: aiData.riskLevel === 'eleve' ? 'high' : aiData.riskLevel === 'moyen' ? 'medium' : 'low',
          confidence: aiData.confidence || 85,
        };
      }

      const newPhoto: Photo = {
        id: `directive-${Date.now()}-${Math.random()}`,
        uri: '',
        timestamp: new Date(),
        groupId,
        isDirectiveOnly: true,
        comment: directiveOnlyComment,
        userDirectives: directiveOnlyText,
        validated: true,
        aiAnalysis,
      };

      const updatedPhotos = [...photos, newPhoto];
      setPhotos(updatedPhotos);
      setHasChanges(true);
      setReportSaved(false);
      setDirectiveOnlyText('');
      setDirectiveOnlyComment('');
      setShowDirectiveOnlyModal(false);
      // Auto-save to DB
      setTimeout(() => saveVisit(updatedPhotos, true), 500);
      Alert.alert('Succès', 'Rapport directive analysé et ajouté avec succès');
    } catch (error) {
      console.error('Error analyzing directives:', error);
      // Fallback: create without AI
      const groupId = `directive-${Date.now()}`;
      const newPhoto: Photo = {
        id: `directive-${Date.now()}-${Math.random()}`,
        uri: '',
        timestamp: new Date(),
        groupId,
        isDirectiveOnly: true,
        comment: directiveOnlyComment,
        userDirectives: directiveOnlyText,
        validated: true,
        aiAnalysis: {
          observations: [directiveOnlyText],
          recommendations: [],
          references: [],
          riskLevel: 'low',
          confidence: 100,
        },
      };
      const updatedPhotos = [...photos, newPhoto];
      setPhotos(updatedPhotos);
      setHasChanges(true);
      setReportSaved(false);
      setDirectiveOnlyText('');
      setDirectiveOnlyComment('');
      setShowDirectiveOnlyModal(false);
      // Auto-save to DB
      setTimeout(() => saveVisit(updatedPhotos, true), 500);
      Alert.alert('Info', 'Rapport directive ajouté (sans analyse IA)');
    } finally {
      setAnalyzingPhoto(false);
    }
  };

  // Delete entire group
  const deleteGroup = (groupId: string) => {
    Alert.alert(
      'Supprimer le rapport',
      'Êtes-vous sûr de vouloir supprimer ce rapport et toutes ses photos ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            const groupPhotos = photos.filter(p => (p.groupId || p.id) === groupId);
            // Delete S3 files
            for (const photo of groupPhotos) {
              if (photo.s3Url) {
                try {
                  await uploadService.deletePhotoByUrl(photo.s3Url);
                } catch (e) {
                  console.error('Error deleting S3 photo:', e);
                }
              }
            }
            setPhotos(prev => prev.filter(p => (p.groupId || p.id) !== groupId));
            setUploadedPhotoUrls(prev => prev.filter(url => !groupPhotos.some(p => p.s3Url === url)));
            setHasChanges(true);
            setReportSaved(false);
            setShowGroupDetail(false);
            setSelectedGroupId(null);
          }
        }
      ]
    );
  };


  const saveComments = async () => {
    if (!selectedPhoto) return;
    const photosData = photos.map(p =>
      p.id === selectedPhoto.id
        ? { ...p, comment: tempComments }
        : p
    )
    setPhotos(photosData);
    setSelectedPhoto(prev => prev ? { ...prev, comment: tempComments } : null);
    // await saveVisit();
    setEditingComments(false);
    setHasChanges(true);
  };

  // Sauvegarder les commentaires
  const saveDirectives = async () => {
    if (!selectedPhoto) return;

    const photosData = photos.map(p =>
      p.id === selectedPhoto.id
        ? { ...p, userDirectives: tempDirectives }
        : p
    )
    setPhotos(photosData);
    setSelectedPhoto(prev => prev ? { ...prev, userDirectives: tempDirectives } : null);
    // await saveVisit(photosData);
    setEditingDirectives(false);
    setHasChanges(true);
  };

  // Sauvegarder la visite
  const saveVisit = async (photosParam = [], silent: boolean = false) => {
    if (!mission) {
      if (!silent) {
        Alert.alert('Erreur', 'Veuillez sélectionner un chantier');
      }
      return;
    }

    const photosData = photosParam && photosParam.length > 0 ? photosParam : photosRef.current;
    const hasDirectiveOnly = photosData.some((p: any) => p.isDirectiveOnly);
    const hasAtLeastOneUploadedPhoto = photosData.some((p: any) => !!p.s3Url);
    if (!hasAtLeastOneUploadedPhoto && !hasDirectiveOnly) {
      if (!silent) {
        Alert.alert('Erreur', 'Veuillez prendre au moins une photo ou ajouter des directives');
      }
      return;
    }

    setSavingVisit(true);

    try {
      const visitPhotos = photosData.map((p: any) => ({
        id: p.id,
        uri: p.uri,
        s3Url: p.s3Url,
        groupId: p.groupId,
        isDirectiveOnly: p.isDirectiveOnly || false,
        isDetailPhoto: p.isDetailPhoto || false,
        isReadabilityPhoto: p.isReadabilityPhoto || false,
        detailContext: p.detailContext || '',
        analysis: {
          observation: p.aiAnalysis?.observations || [],
          recommendation: p.aiAnalysis?.recommendations || [],
          riskLevel: p.aiAnalysis?.riskLevel === 'high' ? 'eleve' as const :
            p.aiAnalysis?.riskLevel === 'medium' ? 'moyen' as const :
              'faible' as const,
          confidence: p.aiAnalysis?.confidence || 0,
          photoConformity: p.aiAnalysis?.photoConformity || true,
          photoConformityMessage: p.aiAnalysis?.photoConformityMessage || "",
          references: p.aiAnalysis?.references || [],
          unreadableSections: p.aiAnalysis?.unreadableSections || [],
        },
        comment: p.comment,
        userDirectives: p.userDirectives,
        validated: p.validated,
      }));

      let visitResponse;
      let visitId = existingVisitId;
      if (existingVisitId) {
        visitResponse = await visitService.updateVisit(existingVisitId, {
          visitDate: new Date().toISOString(),
          photos: visitPhotos,
          notes: visitNotes,
        });
      } else {
        visitResponse = await visitService.createVisit({
          missionId: mission?.id?.toString() || '',
          visitDate: new Date().toISOString(),
          photos: visitPhotos,
          notes: visitNotes,
        });
        visitId = visitResponse.data?.id;
        setExistingVisitId(visitId);
      }

      if (visitResponse.error) {
        console.error('Error saving visit:', visitResponse.error);
        if (!silent) {
          Alert.alert('Erreur', "La visite n'a pas pu être enregistrée, veuillez réessayer ou contacter l'administrateur.");
        }
        return;
      }

      if (!silent) {
        loadExistingVisitData(mission.id, visitId);
        Alert.alert('Succès', 'La visite a été enregistrée avec succès');
      }
    } catch (error: any) {
      if (!silent) {
        Alert.alert('Erreur', error.message || 'Impossible d\'enregistrer la visite');
      }
    } finally {
      setSavingVisit(false);
    }
  };

  const saveReportAndVisit = async () => {
    if (!mission) {
      Alert.alert('Erreur', 'Veuillez sélectionner un chantier');
      return;
    }

    if (photos.length === 0) {
      Alert.alert('Erreur', 'Veuillez ajouter au moins une photo ou un rapport directive');
      return;
    }

    if (!reportContent && !reportHeader && !reportFooter) {
      Alert.alert('Erreur', 'Le rapport ne peut pas être vide');
      return;
    }
    setIsSavingReport(true);
    try {
      const response = await saveSendReport(false);

      if (response) {
        setReportSaved(true);
        setReportValidated(true);
        // setExistingVisitId(savedVisitId);
        // setExistingReportId(reportResponse.data.id);
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
              onPress: () => router.push('/auth/login')
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

  // Générer le rapport via backend API
  const generateReport = async () => {
    if (photos.length < 1) {
      Alert.alert('Insuffisant', 'Vous devez avoir au minimum 1 élément (photo ou directive) pour générer un rapport.');
      return;
    }

    if (!existingVisitId) {
      Alert.alert('Erreur', 'Veuillez d\'abord sauvegarder la visite avant de générer le rapport.');
      return;
    }

    setGeneratingReport(true);
    setReportSaved(false);
    setReportSended(false);

    try {
      const location = mission.address ? mission.address : (mission.location || 'N/A');
      const validatedPhotos = photos.filter(p => p.validated);
      const photoEntries = photos.filter(p => !p.isDirectiveOnly);
      const directiveEntries = photos.filter(p => p.isDirectiveOnly);
      const totalRisks = photos.filter(p => p.aiAnalysis?.riskLevel === 'high').length;
      const mediumRisks = photos.filter(p => p.aiAnalysis?.riskLevel === 'medium').length;

      const header = `RAPPORT DE VISITE SPS
${mission?.title || 'Chantier sans nom'}

CLIENT: ${mission?.client || 'N/A'}
LIEU: ${location}
DATE: ${new Date().toLocaleDateString('fr-FR')}
COORDONNATEUR: ${userProfile.firstName} ${userProfile.lastName}

RÉSUMÉ DE LA VISITE:
${photoEntries.length} photos prises et analysées
${directiveEntries.length} rapport(s) directive(s)
${validatedPhotos.length} analyses validées
${totalRisks} risques élevés identifiés
${mediumRisks} risques moyens identifiés`;

      const footer = `CONCLUSION:
${totalRisks > 0
          ? 'Des actions correctives immédiates sont nécessaires pour les risques élevés identifiés.'
          : mediumRisks > 0
            ? 'Quelques améliorations sont recommandées pour optimiser la sécurité.'
            : 'Le chantier présente un bon niveau de conformité sécurité.'
        }

Coordonnateur: ${userProfile.firstName} ${userProfile.lastName}

Date: ${new Date().toLocaleDateString('fr-FR')}`;

      const response = await visitService.generateReport(existingVisitId, { header, footer, notes: visitNotes });

      if (response.error) {
        Alert.alert('Erreur', response.error);
        return;
      }

      if (response.data) {
        const report = response.data as any;
        setReportContent(report.content || '');
        setReportHeader(report.header || header);
        setReportFooter(report.footer || footer);
        setExistingReportId(report.id);
        setReportStatus(report.status);
        setReportValidated(true);
      }

      setEditingReport(false);
      setShowReportModal(true);
    } catch (error) {
      console.error('Erreur génération rapport:', error);
      Alert.alert('Erreur', 'Impossible de générer le rapport. Veuillez réessayer.');
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleChangeText = (value: string) => {
    const cursor = selection.start;
    // Détection insertion d’un retour à la ligne
    if (value.length > reportContent.length && value[cursor - 1] === "\n") {
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);

      const newText = before + "• " + after;
      const newCursor = before.length + 3; // position exacte après "• "

      setReportContent(newText);

      // ⚠️ important : attendre le rendu
      setTimeout(() => {
        setSelection({ start: newCursor, end: newCursor });
      }, 0);
    } else {
      setReportContent(value);
    }
  };

   // Envoyer le rapport
  const saveSendReport = async (isToSend?: boolean = true) => {
    if (reportStatus == 'envoye_au_client') {
      Alert.alert('Rapport déjà envoyé !', 'Vous ne pouvez pas modifier ni envoyer le rapport.');
      return;
    }
    if (mission?.status == 'terminee') {
      Alert.alert(`Le chantier ${mission?.title} est terminé !`, 'Vous ne pouvez pas modifier ni envoyer le rapport.');
      return;
    }

    // If report was edited, update photos from the edited content
    // if (editingReport) {
    //   updatePhotosFromEditedContent();
    // }
    setIsSavingReport(true);
    setReportSaved(false);
    setReportSended(false);
    try {
      const currentPhotos = photosRef.current;
      const conformity = Math.round(
        currentPhotos.reduce((acc, p) => {
          if (p.aiAnalysis?.riskLevel === 'low') return acc + 100;
          if (p.aiAnalysis?.riskLevel === 'medium') return acc + 80;
          if (p.aiAnalysis?.riskLevel === 'high') return acc + 60;
          return acc + 85;
        }, 0) / currentPhotos.length
      );

      // 1. Save visit to backend
      const visitPhotos = photosRef.current.map(p => ({
        id: p.id,
        uri: p.uri,
        s3Url: p.s3Url,
        groupId: p.groupId,
        isDirectiveOnly: p.isDirectiveOnly || false,
        isDetailPhoto: p.isDetailPhoto || false,
        isReadabilityPhoto: p.isReadabilityPhoto || false,
        detailContext: p.detailContext || '',
        analysis: {
          observation: p.aiAnalysis?.observations || [],
          recommendation: p.aiAnalysis?.recommendations || [],
          riskLevel: p.aiAnalysis?.riskLevel === 'high' ? 'eleve' as const :
            p.aiAnalysis?.riskLevel === 'medium' ? 'moyen' as const :
              'faible' as const,
          confidence: p.aiAnalysis?.confidence || 0,
          references: p.aiAnalysis?.references || [],
          unreadableSections: p.aiAnalysis?.unreadableSections || [],
        },
        comment: p.comment,
        userDirectives: p.userDirectives,
        validated: p.validated,
      }));

      let visitResponse;
      let visitId = existingVisitId;

      // Check if visit already exists for this chantier
      if (existingVisitId) {
        // Update existing visit
        visitResponse = await visitService.updateVisit(existingVisitId, {
          visitDate: new Date().toISOString(),
          photos: visitPhotos,
          notes: visitNotes,
        });
        // console.log('Updated existing visit:', existingVisitId);
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
        // console.log('Created new visit:', visitId);
      }

      if (visitResponse.isTokenExpired) {
        Alert.alert(
          'Session expirée',
          'Votre session a expiré après 24 heures. Veuillez vous reconnecter.',
          [
            {
              text: 'Se reconnecter',
              onPress: () => router.replace('/auth/login')
            }
          ]
        );
        return false;
      }

      if (visitResponse.error) {
        console.error('Error saving visit:', visitResponse.error);
      }

      // 2. Create or update report in backend
      let reportResponse;
      if (existingReportId && (reportStatus !== 'envoye_au_client')) {
        // Update existing report if not validated
        reportResponse = await reportService.updateReport(existingReportId, {
          title: `RAPPORT VISITE - ${mission?.title}`,
          content: reportContent,
          header: reportHeader,
          footer: reportFooter,
          status: 'brouillon',
          conformityPercentage: conformity,
        });
        // console.log('Updated existing report:', existingReportId);
        setReportStatus('brouillon');
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
          status: 'brouillon',
          conformityPercentage: conformity,
          recipientEmail: mission?.contactEmail || undefined,
        });
        setExistingReportId(reportResponse?.data?.id);
        setReportStatus('brouillon');
        setHasChanges(false);
        // console.log('Created new report:', reportResponse.data?.id);
      } else if (reportStatus == 'envoye_au_client') {
        // Report is validated, cannot update
        Alert.alert('Rapport envoyé au client', "Ce rapport a été envoyé au client, il n'est plus possible de le modifier ou l'envoyer");
        return;
      }

      if (reportResponse?.isTokenExpired) {
        Alert.alert(
          'Session expirée',
          'Votre session a expiré après 24 heures. Veuillez vous reconnecter.',
          [
            {
              text: 'Se reconnecter',
              onPress: () => router.replace('/auth/login')
            }
          ]
        );
        return false;
      }

      if (reportResponse?.error) {
        console.error('Error saving report:', reportResponse.error);
        Alert.alert('Erreur', 'Impossible de sauvegarder le rapport sur le serveur');
        return false;
      }
      setReportSaved(true);
      // 3. Also save locally as fallback
      const newReport = {
        id: Date.now(),
        title: `RAPPORT VISITE - ${mission?.title}`,
        mission: mission?.title || 'Chantier inconnu',
        client: mission?.client || 'Client inconnu',
        date: new Date().toISOString().split('T')[0],
        status: 'envoyes',
        type: mission?.type || 'CSPS',
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
      //       if (isToSend) {
      //         setReportSended(false);
      //         // const pdfPhotos = photos.map(p => ({
      //         //   uri: p.s3Url || p.uri,
      //         //   comment: p.comment,
      //         // }));
      //         const pdfData = {
      //           title: `RAPPORT VISITE - ${mission?.title}`,
      //           mission: mission?.title || 'Mission inconnue',
      //           client: mission?.client || 'Client inconnu',
      //           date: new Date().toLocaleDateString('fr-FR'),
      //           conformity,
      //           header: reportHeader,
      //           content: reportContent,
      //           footer: reportFooter,
      //           photos: photos,
      //         };
      //         // const userData = await AsyncStorage.getItem('user_data');
      //         setShowPdfLoadingModal(true);
      //         setPdfLoadingProgress('Conversion des photos...');
      //         const pdfPath = await pdfService.generateReportPDF(pdfData);
      //         const response = await uploadReportFile(pdfPath, reportResponse?.data?.title);
      //         const clientEmail = mission.contact?.email;
      //         let reportFileUrl = '';
      //         if (response) {
      //           reportFileUrl = response.url || '';
      //         }
      //         setPdfLoadingProgress('Finalisation...');
      //         const subject = `Rapport de visite - ${mission?.title}`;
      //         const body = `Bonjour ${mission?.contact?.firstName},
      // Veuillez trouver ci-joint le rapport de visite suivant:

      // Mission: ${mission?.title}
      // Date d'attribution: ${mission.date} à ${mission.time}
      // Date de visite: ${visitResponse.data.createdAt}
      // Adresse chantier: ${mission.location} 
      // Conformité: ${conformity}%
      // Nombre de photos: ${photos.length}

      // Le rapport complet avec les photos est disponible en pièce jointe PDF.

      // Cordialement.
      // ${userProfile && `Coordonnateur: ${userProfile.firstName} ${userProfile.lastName}`}
      // `;
      //         // const mailtoUrl = pdfService.createMailtoLinkWithAttachment(
      //         //   clientEmail,
      //         //   subject,
      //         //   body,
      //         //   pdfPath || undefined
      //         // );
      //         // await Linking.openURL(mailtoUrl);

      //         const isAvailable = await MailComposer.isAvailableAsync();
      //         if (!isAvailable) {
      //           console.warn('📧 MailComposer non disponible sur cet appareil.');
      //           // return pdfPath;
      //         }

      //         // 5️⃣ Préparer l’email avec texte pré-rempli et pièce jointe
      //         const mailOptions = {
      //           recipients: [clientEmail],
      //           subject: subject,
      //           body: body,
      //         };
      //         // console.log('mailOptions mission >>> : ', mission);
      //         if (pdfPath) {
      //           mailOptions.attachments = [pdfPath] // pièce jointe
      //         }
      //         // 6️⃣ Ouvrir le mail ready-to-send
      //         try {
      //           const mail = await MailComposer.composeAsync(mailOptions);

      //           console.log("Send Mail >>> : ", mail);
      //           // console.log('📤 Email prêt à être envoyé !');
      //           // console.log('Generated PDF at:', pdfPath, 'Uploaded to:', reportFileUrl);

      //           setShowPdfLoadingModal(false);
      //           setShowReportModal(false);

      //           Alert.alert(
      //             "Validation de l’envoi du rapport",
      //             `Veuillez confirmer l’envoi du rapport PDF aux destinataires concernés.

      // ⚠️ Après l’envoi, aucune modification ne sera possible.
      //             `,
      //             [
      //               {
      //                 text: 'Oui je confirme',
      //                 style: 'default',
      //                 onPress: async () => {
      //                   await validateSentReport(clientEmail, reportFileUrl);
      //                 }
      //               },
      //               {
      //                 text: 'Non',
      //                 style: 'cancel',
      //               }
      //             ]
      //           );

      //         } catch (error) {
      //           console.error('Erreur sauvegarde rapport:', error);
      //           Alert.alert('Erreur', "Erreur lors de la sauvegarde et d'envoie du rapport");
      //           setShowReportModal(false);
      //           setShowPdfLoadingModal(false);
      //           // return false;
      //         }
      //       }
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
              onPress: () => router.push('/auth/login')
            }
          ]
        );
      } else {
        Alert.alert('Erreur', "Erreur lors de la sauvegarde et d'envoie du rapport");
      }
      return;
    } finally {
      setIsSavingReport(false);
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

  const formatDisplayDate = (date: Date) => {
    if (!date) return null;
    if (date instanceof Date) {
      return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    }
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

  };

  const openReportDetails = () => {
    if (!existingReportId || !mission) return;
    // Encoder les données du chantier pour les passer en paramètres
    const missionData = encodeURIComponent(JSON.stringify({
      ...mission,
      id: mission.id,
      title: mission.title,
      client: mission.client,
      location: mission.location,
      description: mission.description,
      nextVisit: mission.nextVisit,
      type: mission.status,
      reportId: existingReportId
    }));

    setShowReportModal(false);
    router.push(`/tabs/rapports?mission=${missionData}`);
  };

  if (!mission) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>VISITE SPS</Text>
            <Text style={styles.headerSubtitle}>Sélectionnez un chantier</Text>
          </View>
        </View>

        {/* Chantier Selector Modal */}
        <Modal visible={showMissionSelector} animationType="slide" transparent>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1, justifyContent: 'flex-end' }}
          >
            <View style={styles.missionSelectorOverlay}>
              <View style={styles.missionSelectorModal}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.missionSelectorGradient}
                >
                  <View style={styles.missionSelectorHeader}>
                    <Text style={styles.missionSelectorTitle}>SÉLECTIONNER UN CHANTIER</Text>
                    <TouchableOpacity
                      style={styles.closeMissionSelectorButton}
                      onPress={async () => {
                        setMission(null);
                        await loadAvailableMissions();
                        setShowMissionSelector(false);
                      }}
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
                          colors={availableMission.status == 'terminee' ? ['#10b981ec', '#10B981'] : ['#3B82F6', '#2563EB']}
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
                              <ArrowRight size={16} color="#eceff2ff" />
                            </View>
                          </View>
                        </LinearGradient>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </LinearGradient>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <View style={styles.noMissionContainer}>
          <LinearGradient
            colors={['#1E293B', '#374151']}
            style={styles.noMissionGradient}
          >
            <Clipboard size={64} color="#64748B" />
            <Text style={styles.noMissionTitle}>AUCUN CHANTIER SÉLECTIONNÉ</Text>
            <Text style={styles.noMissionText}>
              Vous devez sélectionner un chantier depuis la page "Chantiers" pour commencer une visite.
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
                <Text style={styles.selectMissionText}>SÉLECTIONNER UN CHANTIER</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.goToMissionsButton}
              onPress={() => router.push('/tabs/missions')}
            >
              <Text style={styles.goToMissionsText}>Aller à mes chantiers</Text>
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
      <SafeAreaView style={styles.container} edges={['top']}>
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
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            setMission(null);
            setPhotos([]);
            setReportContent('');
            setReportValidated(false);
            setLoadingMission(false);
          }}
        >
          <X size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>VISITE SPS</Text>
          <Text style={styles.headerSubtitle}>{mission.title}</Text>
        </View>
        {/* <TouchableOpacity
          style={styles.changeMissionButton}
          onPress={() => setShowMissionSelector(true)}
        >
          <RefreshCw size={20} color="#FFFFFF" />
        </TouchableOpacity> */}
        {(uploadedPhotoUrls.length > 0 || photos.some(p => p.isDirectiveOnly)) && (
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

      {/* Chantier Info */}
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
            <Text style={styles.sectionTitle}>{`PHOTOS DU CHANTIER \n`}             ({photos.filter(p => !p.isDetailPhoto).length}/10)</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(reportSended || mission.status == "termine") ? (
                <TouchableOpacity
                  style={styles.generateReportButton}
                  onPress={() => {
                    router.push(`/tabs/rapports`);
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
              ) : photos.length >= 1 && (
                <TouchableOpacity
                  style={styles.generateReportButton}
                  onPress={generateReport}
                  disabled={generatingReport || analyzingPhoto}
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

          {/* Add Photo Buttons */}
          {photos.filter(p => !p.isDetailPhoto).length < 10 && (reportStatus !== 'envoye_au_client') && (mission?.status != 'terminee') && (
            <View style={{ gap: 12 }}>
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

              <TouchableOpacity
                style={styles.addPhotoButton}
                onPress={pickPhotosFromGallery}
              >
                <LinearGradient
                  colors={['#8B5CF6', '#7C3AED']}
                  style={styles.addPhotoGradient}
                >
                  <ImagePlus size={24} color="#FFFFFF" />
                  <Text style={styles.addPhotoText}>IMPORTER DES PHOTOS</Text>
                  <Text style={styles.addPhotoSubtext}>Sélectionnez une ou plusieurs photos depuis votre galerie</Text>
                </LinearGradient>
              </TouchableOpacity>

              {/* Directive-only report button */}
              <TouchableOpacity
                style={styles.addPhotoButton}
                onPress={() => setShowDirectiveOnlyModal(true)}
              >
                <LinearGradient
                  colors={['#F59E0B', '#D97706']}
                  style={styles.addPhotoGradient}
                >
                  <FileText size={24} color="#FFFFFF" />
                  <Text style={styles.addPhotoText}>RAPPORT SANS PHOTO</Text>
                  <Text style={styles.addPhotoSubtext}>Créer un rapport uniquement avec des directives du coordonnateur</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* Pending photos indicator */}
          {pendingPhotos.length > 0 && !showMultiPhotoModal && (
            <TouchableOpacity
              style={{ marginBottom: 12 }}
              onPress={() => setShowMultiPhotoModal(true)}
            >
              <LinearGradient
                colors={['#F59E0B', '#D97706']}
                style={{ borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 13 }}>
                  {pendingPhotos.length} photo(s) en attente d'analyse
                </Text>
                <ArrowRight size={16} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Report Groups Grid */}
          {reportGroups.length > 0 && !analyzingPhoto && (
            <View style={styles.photosGrid}>
              {reportGroups.map((group, index) => (
                <TouchableOpacity
                  key={group.groupId}
                  style={[styles.photoCard, { height: 160 }]}
                  onPress={() => {
                    setSelectedGroupId(group.groupId);
                    setShowGroupDetail(true);
                  }}
                >
                  {group.isDirectiveOnly ? (
                    // Directive-only card
                    <LinearGradient
                      colors={['#F59E0B', '#D97706']}
                      style={{ flex: 1, padding: 12, justifyContent: 'space-between' }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 10, letterSpacing: 0.5 }}>#{index + 1} DIRECTIVES</Text>
                        <FileText size={16} color="#FFFFFF" />
                      </View>
                      <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Regular', fontSize: 11, lineHeight: 15 }} numberOfLines={4}>
                        {group.directives}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter-Regular', fontSize: 9 }}>
                        Sans photo
                      </Text>
                    </LinearGradient>
                  ) : (
                    // Photo group card - show mini thumbnails grid (max 4)
                    <>
                      {group.photos.length === 1 ? (
                        <Image source={{ uri: group.photos[0]?.uri }} style={styles.photoImage} />
                      ) : (
                        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }}>
                          {group.photos.slice(0, 4).map((photo, pIdx) => (
                            <View key={photo.id} style={{
                              width: group.photos.length >= 4 ? '50%' : group.photos.length === 2 ? '50%' : pIdx === 0 ? '100%' : '50%',
                              height: group.photos.length >= 4 ? '50%' : group.photos.length === 2 ? '100%' : pIdx === 0 ? '60%' : '40%',
                              position: 'relative',
                            }}>
                              <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} />
                              {pIdx === 3 && group.photos.length > 4 && (
                                <View style={{
                                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                  backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 18 }}>
                                    +{group.photos.length - 4}
                                  </Text>
                                </View>
                              )}
                            </View>
                          ))}
                        </View>
                      )}
                      <View style={styles.photoOverlay}>
                        <View style={styles.photoHeader}>
                          <Text style={styles.photoNumber}>#{index + 1}</Text>
                          {group.photos.length > 1 && (
                            <View style={{ backgroundColor: 'rgba(59, 130, 246, 0.9)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 10 }}>
                                {group.photos.length} photos
                              </Text>
                            </View>
                          )}
                        </View>

                        {group.aiAnalysis ? (
                          <View style={styles.photoFooter}>
                            <View style={[
                              styles.riskBadge,
                              { backgroundColor: getRiskColor(group.aiAnalysis.riskLevel) }
                            ]}>
                              <Text style={styles.riskText}>
                                {getRiskLabel(group.aiAnalysis.riskLevel)}
                              </Text>
                            </View>
                            <Text style={styles.confidenceText}>
                              {group.aiAnalysis.confidence}% confiance
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.analyzingBadge}>
                            <ActivityIndicator size={12} color="#FFFFFF" />
                            <Text style={styles.analyzingText}>Analyse IA...</Text>
                          </View>
                        )}
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Analysis in Progress */}
          {/* {analyzingPhoto && (
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
          )} */}
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
                1. Prenez des photos du chantier
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
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
                  <Text style={styles.cameraTitle}>PHOTO {photos.filter(p => !p.isDetailPhoto).length + 1}/10</Text>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Photo Detail Modal */}
      <Modal visible={showPhotoDetail && !analyzingPhoto} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
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
                          {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') && (
                            <TouchableOpacity
                              style={styles.deletePhotoButton}
                              onPress={() => deletePhoto(selectedPhoto)}
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
                            {selectedPhoto.aiAnalysis?.observations && <View style={styles.analysisBlock}>
                              <Text style={styles.analysisBlockTitle}>OBSERVATIONS</Text>
                              {selectedPhoto.aiAnalysis?.observations?.map((obs, index) => (
                                <View key={index} style={styles.analysisItem}>
                                  <Eye size={14} color="#94A3B8" />
                                  <Text style={styles.analysisText}>{obs}</Text>
                                </View>
                              ))}
                            </View>}

                            {/* Recommendations */}
                            {selectedPhoto.aiAnalysis?.recommendations && <View style={styles.analysisBlock}>
                              <Text style={styles.analysisBlockTitle}>RECOMMANDATIONS</Text>
                              {selectedPhoto.aiAnalysis?.recommendations?.map((rec, index) => (
                                <View key={index} style={styles.analysisItem}>
                                  <AlertTriangle size={14} color="#F59E0B" />
                                  <Text style={styles.analysisText}>{rec}</Text>
                                </View>
                              ))}
                            </View>}
                            {/* Recommendations */}
                            {selectedPhoto.aiAnalysis?.references && <View style={styles.analysisBlock}>
                              <Text style={styles.analysisBlockTitle}>REFERENCES</Text>
                              {selectedPhoto.aiAnalysis?.references?.map((ref, index) => (
                                <View key={index} style={styles.analysisItem}>
                                  <NotebookPen size={14} color="#F59E0B" />
                                  <Text style={styles.analysisText}>{ref}</Text>
                                </View>
                              ))}
                            </View>}
                          </View>
                        ) : (
                          <View style={styles.analyzingDetailContainer}>
                            <ActivityIndicator size={24} color="#8B5CF6" />
                            <Text style={styles.analyzingDetailText}>Analyse IA en cours...</Text>
                          </View>
                        )}

                        {/* User DIRECTIVES */}
                        <View style={styles.commentsSection}>
                          <View style={styles.commentsSectionHeader}>
                            <Text style={styles.commentsSectionTitle}>DIRECTIVES</Text>
                            {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') && (
                              <TouchableOpacity
                                style={styles.editCommentsButton}
                                onPress={() => setEditingDirectives(true)}
                              >
                                <NotebookPen size={16} color="#3B82F6" />
                              </TouchableOpacity>
                            )}
                          </View>

                          {editingDirectives && (reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') ? (
                            <View style={styles.commentsEditContainer}>
                              <TextInput
                                style={styles.commentsInput}
                                placeholder="Ajoutez vos directives ..."
                                placeholderTextColor="#64748B"
                                value={tempDirectives}
                                onChangeText={setTempDirectives}
                                multiline
                                numberOfLines={4}
                                textAlignVertical="top"
                              />
                              <View style={styles.commentsActions}>
                                <TouchableOpacity
                                  style={styles.cancelCommentsButton}
                                  onPress={() => {
                                    setEditingDirectives(false);
                                    setTempDirectives(selectedPhoto.userDirectives);
                                  }}
                                >
                                  <LinearGradient
                                    colors={['#1e293be2', '#1E293B']}
                                    style={styles.saveCommentsGradient}
                                  >
                                    {/* <Check size={16} color="#FFFFFF" /> */}
                                    <Text style={styles.cancelCommentsText}>Annuler</Text>
                                  </LinearGradient>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={styles.saveCommentsButton}
                                  onPress={saveDirectives}
                                >
                                  <LinearGradient
                                    colors={['#10B981', '#059669']}
                                    style={styles.saveCommentsGradient}
                                  >
                                    {/* <Check size={16} color="#FFFFFF" /> */}
                                    <Text style={styles.saveCommentsText}>{`Sauvegarder \ndirectives`}</Text>
                                  </LinearGradient>
                                </TouchableOpacity>

                                {(reportStatus !== 'envoye_au_client' && (!mission || (mission as any).originalStatus !== 'terminee')) && <TouchableOpacity
                                  style={styles.saveCommentsButton}
                                  onPress={() => addDirectivesAndAnalyseAI()}
                                >
                                  <LinearGradient
                                    colors={['#10B981', '#059669']}
                                    style={styles.saveCommentsGradient}
                                  >
                                    {/* <Check size={16} color="#FFFFFF" /> */}
                                    <Text style={styles.saveCommentsText}>{`Regénérer \n rapport`}</Text>
                                  </LinearGradient>
                                </TouchableOpacity>}
                              </View>
                            </View>
                          ) : (
                            <View style={styles.commentsDisplay}>
                              {selectedPhoto.userDirectives ? (
                                <Text style={styles.commentsText}>{selectedPhoto.userDirectives}</Text>
                              ) : (
                                <Text style={styles.noCommentsText}>Aucun commentaire ajouté</Text>
                              )}
                            </View>
                          )}
                        </View>

                        {/* User Comments */}
                        <View style={styles.commentsSection}>
                          <View style={styles.commentsSectionHeader}>
                            <Text style={styles.commentsSectionTitle}>COMMENTAIRES</Text>
                            {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') && (
                              <TouchableOpacity
                                style={styles.editCommentsButton}
                                onPress={() => setEditingComments(true)}
                              >
                                <Edit3 size={16} color="#3B82F6" />
                              </TouchableOpacity>
                            )}
                          </View>

                          {editingComments && (reportStatus !== 'envoye_au_client' && (!mission || (mission as any).originalStatus !== 'terminee')) ? (
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
                                    setTempComments(selectedPhoto.comment);
                                    setTempDirectives(selectedPhoto.userDirectives);
                                  }}
                                >
                                  <LinearGradient
                                    colors={['#1e293be2', '#1E293B']}
                                    style={styles.saveCommentsGradient}
                                  >
                                    {/* <Check size={16} color="#FFFFFF" /> */}
                                    <Text style={styles.cancelCommentsText}>Annuler</Text>
                                  </LinearGradient>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={styles.saveCommentsButton}
                                  onPress={saveComments}
                                >
                                  <LinearGradient
                                    colors={['#10B981', '#059669']}
                                    style={styles.saveCommentsGradient}
                                  >
                                    {/* <Check size={16} color="#FFFFFF" /> */}
                                    <Text style={styles.saveCommentsText}>{`Sauvegarder \ncommentaires`}</Text>
                                  </LinearGradient>
                                </TouchableOpacity>

                                {/* <TouchableOpacity
                                  style={styles.saveCommentsButton}
                                  onPress={() => addDirectivesAndAnalyseAI()}
                                >
                                  <LinearGradient
                                    colors={['#10B981', '#059669']}
                                    style={styles.saveCommentsGradient}
                                  >
                                    
                                    <Text style={styles.saveCommentsText}>{`Regénérer \n rapport`}</Text>
                                  </LinearGradient>
                                </TouchableOpacity> */}
                              </View>
                            </View>
                          ) : (
                            <View style={styles.commentsDisplay}>
                              {selectedPhoto.comment ? (
                                <Text style={styles.commentsText}>{selectedPhoto.comment}</Text>
                              ) : (
                                <Text style={styles.noCommentsText}>Aucune directives ajouté</Text>
                              )}
                            </View>
                          )}
                        </View>
                      </ScrollView>

                      {/* Validation Button */}
                      {selectedPhoto.aiAnalysis && !selectedPhoto.validated && false && (
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
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Report Modal */}
      <Modal visible={showReportModal && !analyzingPhoto} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <View style={styles.reportModalOverlay}>
              <View style={styles.reportModal}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.reportModalGradient}
                >
                  <View style={styles.reportModalHeader}>
                    <Text style={styles.reportModalTitle}>RAPPORT DE VISITE  </Text>
                    <View style={styles.reportModalActions}>
                      {/* {(!mission || (mission as any).originalStatus !== 'terminee') && (
                        <TouchableOpacity
                          style={styles.editReportButton}
                          onPress={() => { setReportSaved(false); setEditingReport(!editingReport) }}
                        >
                          <Edit3 size={20} color={editingReport ? "#F59E0B" : "#3B82F6"} />
                        </TouchableOpacity>
                      )} */}
                      <TouchableOpacity
                        style={styles.closeReportButton}
                        onPress={() => setShowReportModal(false)}
                      >
                        <X size={20} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <ScrollView ref={reportScrollRef} style={styles.reportContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {editingReport && (reportStatus !== 'envoye_au_client' && (!mission || (mission as any).originalStatus !== 'terminee')) ? (
                      <View>
                        <Text style={styles.editSectionLabel}>EN-TÊTE</Text>
                        <TextInput
                          style={styles.reportTextInput}
                          value={reportHeader}
                          onChangeText={setReportHeader}
                          multiline
                          numberOfLines={10}
                          textAlignVertical="top"
                          placeholder="En-tête du rapport..."
                          placeholderTextColor="#64748B"
                        />
                        <Text style={styles.editSectionLabel}>OBSERVATIONS</Text>
                        <TextInput
                          style={styles.reportTextInput}
                          value={reportContent}
                          onChangeText={handleChangeText}
                          selection={selection}
                          onSelectionChange={(e) =>
                            setSelection(e.nativeEvent.selection)
                          }
                          multiline
                          numberOfLines={15}
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
                          numberOfLines={10}
                          textAlignVertical="top"
                          placeholder="Conclusion et recommandations..."
                          placeholderTextColor="#64748B"
                        />
                      </View>
                    ) : (
                      <View>
                        <Text style={styles.reportText}>{reportHeader}</Text>
                        <View style={styles.reportPhotoSeparator} />
                        {reportGroups.map((group, groupIdx) => {
                          const getRiskColorLocal = (risk: string) => {
                            const level = risk?.toLowerCase();
                            if (level === 'high' || level === 'eleve') return '#EF4444';
                            if (level === 'medium' || level === 'moyen') return '#F59E0B';
                            if (level === 'low' || level === 'faible') return '#10B981';
                            return '#64748B';
                          };
                          const getRiskLabelLocal = (risk: string) => {
                            const level = risk?.toLowerCase();
                            if (level === 'high' || level === 'eleve') return 'ÉLEVÉ';
                            if (level === 'medium' || level === 'moyen') return 'MOYEN';
                            if (level === 'low' || level === 'faible') return 'FAIBLE';
                            return 'N/A';
                          };
                          const riskLevel = group.aiAnalysis?.riskLevel || 'moyen';
                          const riskColor = getRiskColorLocal(riskLevel);
                          const riskLabel = getRiskLabelLocal(riskLevel);

                          return (
                            <View key={group.groupId} style={{
                              backgroundColor: '#1E293B',
                              borderRadius: 16,
                              padding: 16,
                              marginBottom: 16,
                              borderWidth: 1,
                              borderColor: '#334155',
                            }}>
                              {/* Group Header */}
                              <View style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 12,
                                paddingBottom: 12,
                                borderBottomWidth: 1,
                                borderBottomColor: '#334155',
                              }}>
                                <Text style={{ fontSize: 16, fontFamily: 'Inter-Bold', color: '#F8FAFC' }}>
                                  {group.isDirectiveOnly
                                    ? `📋 Rapport ${groupIdx + 1} — DIRECTIVES`
                                    : `📸 Rapport ${groupIdx + 1} — ${group.photos.length} photo${group.photos.length > 1 ? 's' : ''}`
                                  }
                                </Text>
                                {group.isDirectiveOnly && group.aiAnalysis && (
                                  <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: riskColor }}>
                                    <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: '#FFFFFF', letterSpacing: 0.5 }}>{riskLabel}</Text>
                                  </View>
                                )}
                                {!group.isDirectiveOnly && (
                                  <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: riskColor }}>
                                    <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: '#FFFFFF', letterSpacing: 0.5 }}>{riskLabel}</Text>
                                  </View>
                                )}
                              </View>

                              {/* Photo Grid */}
                              {!group.isDirectiveOnly && group.photos.length > 0 && (
                                group.photos.length > 1 ? (
                                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                                    {group.photos.map((photo, pIdx) => (
                                      <TouchableOpacity
                                        key={photo.id}
                                        style={{ width: '48%', aspectRatio: 3 / 2, borderRadius: 10, overflow: 'hidden', position: 'relative', backgroundColor: '#0F172A' }}
                                        onPress={() => { setZoomedImageUri(photo.uri); setShowImageZoom(true); }}
                                      >
                                        <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                                        <View style={{ position: 'absolute', top: 6, left: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                                          <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#FFFFFF' }}>{pIdx + 1}</Text>
                                        </View>
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                ) : (
                                  <TouchableOpacity
                                    style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}
                                    onPress={() => { setZoomedImageUri(group.photos[0].uri); setShowImageZoom(true); }}
                                  >
                                    <Image source={{ uri: group.photos[0].uri }} style={{ width: '100%', height: 240, backgroundColor: '#0F172A' }} resizeMode="cover" />
                                  </TouchableOpacity>
                                )
                              )}

                              {/* Analysis */}
                              {group.aiAnalysis && (
                                <View style={{ gap: 12, marginBottom: 12 }}>
                                  <View style={{ backgroundColor: '#0F172A', padding: 12, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: '#3B82F6' }}>
                                    <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#CBD5E1', marginBottom: 8 }}>🔍 Observations</Text>
                                    <View style={{ gap: 6 }}>
                                      {group.aiAnalysis?.observations?.map((obs, i) => (
                                        <Text key={i} style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: '#94A3B8', lineHeight: 20 }}>• {obs}</Text>
                                      ))}
                                    </View>
                                  </View>

                                  <View style={{ backgroundColor: '#0F172A', padding: 12, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: '#3B82F6' }}>
                                    <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#CBD5E1', marginBottom: 8 }}>⚠️ Recommandations</Text>
                                    <View style={{ gap: 6 }}>
                                      {group.aiAnalysis?.recommendations?.map((rec, i) => (
                                        <Text key={i} style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: '#94A3B8', lineHeight: 20 }}>• {rec}</Text>
                                      ))}
                                    </View>
                                  </View>

                                  {group.aiAnalysis?.references && Array.isArray(group.aiAnalysis?.references) && group.aiAnalysis.references.length > 0 && (
                                    <View style={{ backgroundColor: '#0F172A', padding: 12, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: '#3B82F6' }}>
                                      <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#CBD5E1', marginBottom: 8 }}>🏛️ Références</Text>
                                      <View style={{ gap: 6 }}>
                                        {group.aiAnalysis.references.map((ref, i) => (
                                          <Text key={i} style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: '#94A3B8', lineHeight: 20 }}>• {ref}</Text>
                                        ))}
                                      </View>
                                    </View>
                                  )}

                                  {/* Unreadable Sections in Report View */}
                                  {/* {group.aiAnalysis?.unreadableSections && group.aiAnalysis.unreadableSections.length > 0 && (
                                    <View style={{ backgroundColor: '#7F1D1D', padding: 12, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: '#EF4444' }}>
                                      <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#FCA5A5', marginBottom: 8 }}>📸 Sections illisibles — Reprise photo nécessaire</Text>
                                      <View style={{ gap: 6 }}>
                                        {group.aiAnalysis.unreadableSections.map((section, i) => (
                                          <Text key={i} style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: '#FECACA', lineHeight: 20 }}>• {section}</Text>
                                        ))}
                                      </View>
                                    </View>
                                  )} */}
                                </View>
                              )}

                              {/* Comment */}
                              {group.comment ? (
                                <View style={{ backgroundColor: '#422006', padding: 12, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: '#F59E0B' }}>
                                  <Text style={{ fontSize: 13, fontFamily: 'Inter-Bold', color: '#FEF3C7', marginBottom: 6 }}>💬 Commentaires du coordonnateur</Text>
                                  <Text style={{ fontSize: 13, fontFamily: 'Inter-Regular', color: '#FDE68A', lineHeight: 20 }}>{group.comment}</Text>
                                </View>
                              ) : null}
                            </View>
                          );
                        })}

                        {/* Global Directives Section */}
                        <View style={{ marginTop: 5, marginBottom: 16 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                            <Clipboard size={18} color="#F59E0B" />
                            <Text style={[styles.reportSectionTitle, { marginLeft: 8, marginBottom: 0, paddingBottom: 10 }]}>DIRECTIVES GLOBALES</Text>
                          </View>
                          {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') ? (
                            <View>
                              <TextInput
                                style={[styles.commentsInput, {
                                  minHeight: 80,
                                  maxHeight: 150,
                                  height: globalDirectivesHeight,
                                  backgroundColor: '#1E293B',
                                  color: '#E2E8F0',
                                }]}
                                placeholder="Ajoutez des directives globales pour tout le rapport..."
                                placeholderTextColor="#64748B"
                                value={visitNotes}
                                onChangeText={(text) => {
                                  setVisitNotes(text);
                                  setReportSaved(false);
                                  setHasChanges(true);
                                }}
                                multiline
                                numberOfLines={3}
                                textAlignVertical="top"
                                onContentSizeChange={(e) => {
                                  const newH = Math.min(150, Math.max(80, e.nativeEvent.contentSize.height));
                                  setGlobalDirectivesHeight(newH);
                                }}
                                onFocus={() => {
                                  setTimeout(() => {
                                    reportScrollRef.current?.scrollToEnd({ animated: true });
                                  }, 300);
                                }}
                              />
                              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 8 }}>
                                <TouchableOpacity
                                  style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                                  onPress={() => {
                                    setHasChanges(true);
                                    setReportSaved(false);
                                    Alert.alert('Succès', 'Directives globales sauvegardées.');
                                  }}
                                >
                                  <LinearGradient
                                    colors={['#10B981', '#059669']}
                                    style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 10, flexDirection: 'row', gap: 6 }}
                                  >
                                    <Save size={16} color="#FFFFFF" />
                                    <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Sauvegarder</Text>
                                  </LinearGradient>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                                  onPress={regenerateAllGroupsWithGlobalDirectives}
                                  disabled={isRegeneratingAllGroups}
                                >
                                  <LinearGradient
                                    colors={isRegeneratingAllGroups ? ['#64748B', '#475569'] : ['#8B5CF6', '#7C3AED']}
                                    style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 10, flexDirection: 'row', gap: 6 }}
                                  >
                                    {isRegeneratingAllGroups ? (
                                      <ActivityIndicator size={14} color="#FFFFFF" />
                                    ) : (
                                      <>
                                        <RefreshCw size={16} color="#FFFFFF" />
                                        <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Regénérer</Text>
                                      </>
                                    )}
                                  </LinearGradient>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : (
                            <View style={styles.commentsDisplay}>
                              {visitNotes ? (
                                <Text style={styles.commentsText}>{visitNotes}</Text>
                              ) : (
                                <Text style={styles.noCommentsText}>Aucune directive globale</Text>
                              )}
                            </View>
                          )}
                        </View>

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
                      disabled={isSavingReport || reportSended || reportSaved}
                    >
                      <View style={styles.validateReportContent}>
                        {isSavingReport ? (
                          <ActivityIndicator size={20} color={reportSaved ? "#ffffffff" : "#3B82F6"} />
                        ) : reportSaved ? (
                          <CheckCircle size={20} color="#FFFFFF" />
                        ) : (
                          <Save size={20} color="#3B82F6" />
                        )}
                        <Text style={[
                          styles.validateReportText,
                          reportSaved && styles.validateReportTextActive
                        ]}>
                          {isSavingReport ? 'Enregistrement...' : 'Enregistrer le rapport'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.sendReportButton,
                        !reportSaved && styles.sendReportButtonDisabled
                      ]}
                      onPress={() => openReportDetails()}
                      disabled={!reportSaved}
                    >
                      <LinearGradient
                        colors={reportSended ? ['#10b981ec', '#10B981'] : ['#64748B', '#475569']}
                        style={styles.sendReportGradient}
                      >
                        <Send size={20} color="#FFFFFF" />
                        <Text style={styles.sendReportText}>Rapport</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </LinearGradient>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* PDF Loading Modal */}
      <Modal visible={showPdfLoadingModal} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

      {/* AI ANALYSING Loading Modal */}
      <Modal visible={analyzingPhoto} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.pdfLoadingOverlay}>
            <View style={styles.pdfLoadingModal}>
              <LinearGradient
                colors={['#8B5CF6', '#A855F7']}
                style={styles.analyzingGradient}
              >
                <ActivityIndicator size={20} color="#FFFFFF" />
                <Text style={styles.analyzingTitle}>ANALYSE IA EN COURS</Text>
                <Text style={styles.analyzingSubtitle}>
                  {regeneratingAllProgress || "L'analyse de la photo pour identifier les risques sécurité en cours ..."}
                </Text>
              </LinearGradient>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showVisitsModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <View style={styles.missionSelectorOverlay}>
              <View style={styles.missionSelectorModal}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.missionSelectorGradient}
                >
                  <ScrollView style={styles.missionSelectorContent} showsVerticalScrollIndicator={false}>
                    <View style={styles.missionSelectorHeader}>
                      <Text style={styles.missionSelectorTitle}>SÉLECTIONNER UNE VISITE</Text>
                      <TouchableOpacity
                        style={styles.closeMissionSelectorButton}
                        onPress={() => { setMission(null); setShowVisitsModal(false); setShowMissionSelector(true); }}
                      >
                        <X size={20} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                    {mission?.visits?.map((visit: any) => (
                      <TouchableOpacity
                        key={visit.id ? visit.id : Math.random() * new Date().getTime()}
                        style={styles.missionSelectorItem}
                        onPress={() => selectVisit(mission, visit.id)}
                      >
                        <LinearGradient
                          colors={visit.report?.status == 'envoye_au_client' ? ['#10b981ec', '#10B981'] : (!visit.id ? ['#c53062ff', '#EC407A'] : ['#3B82F6', '#2563EB'])}
                          style={styles.missionSelectorItemGradient}
                        >
                          <View style={styles.missionSelectorItemContent}>
                            <View style={styles.missionSelectorItemLeft}>
                              <Text style={styles.missionSelectorItemTitle}>{visit.id ? mission.title + ' -- ' + formatDisplayDate(visit.visitDate) : "Créer une nouvelle visite -- " + mission.title}</Text>
                              <Text style={styles.missionSelectorItemClient}>{mission.client}</Text>
                              <Text style={styles.missionSelectorItemLocation}>{mission.location}</Text>
                            </View>
                            <View style={styles.missionSelectorItemRight}>
                              <Text style={styles.missionSelectorItemType}>{mission.type}</Text>
                              <ArrowRight size={16} color="#eceff2ff" />
                            </View>
                          </View>
                        </LinearGradient>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </LinearGradient>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Loading Chantier Modal */}
      <Modal visible={loadingMission} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
                  Chargement des détails du chantier avec les photos en cours ...
                </Text>
              </LinearGradient>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Multi-Photo Selection & Analysis Modal */}
      <Modal visible={showMultiPhotoModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <View style={styles.photoDetailOverlay}>
              <View style={styles.photoDetailModal}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.photoDetailGradient}
                >
                  <View style={styles.photoDetailHeader}>
                    <Text style={styles.photoDetailTitle}>
                      PHOTOS SÉLECTIONNÉES ({pendingPhotos.length})
                    </Text>
                    <TouchableOpacity
                      style={styles.closePhotoDetailButton}
                      onPress={cancelMultiPhotoModal}
                    >
                      <X size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ flex: 1, paddingHorizontal: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {/* Pending photos grid */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                      {pendingPhotos.map((photo, index) => (
                        <View key={photo.id} style={{ width: (width - 82) / 3, height: 120, borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
                          <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} />
                          {/* Edit button */}
                          <TouchableOpacity
                            style={{
                              position: 'absolute', top: 4, left: 4,
                              backgroundColor: 'rgba(59, 130, 246, 0.9)', borderRadius: 12,
                              width: 24, height: 24, alignItems: 'center', justifyContent: 'center'
                            }}
                            onPress={() => openPhotoEditor(photo.id, photo.uri)}
                          >
                            <Pencil size={12} color="#FFFFFF" />
                          </TouchableOpacity>
                          {/* Delete button */}
                          <TouchableOpacity
                            style={{
                              position: 'absolute', top: 4, right: 4,
                              backgroundColor: 'rgba(239, 68, 68, 0.9)', borderRadius: 12,
                              width: 24, height: 24, alignItems: 'center', justifyContent: 'center'
                            }}
                            onPress={() => removePendingPhoto(photo.id, photo.uri)}
                          >
                            <X size={14} color="#FFFFFF" />
                          </TouchableOpacity>
                          <View style={{
                            position: 'absolute', bottom: 4, left: 4,
                            backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8,
                            paddingHorizontal: 6, paddingVertical: 2
                          }}>
                            <Text style={{ color: '#FFFFFF', fontSize: 10, fontFamily: 'Inter-Bold' }}>#{index + 1}</Text>
                          </View>
                        </View>
                      ))}
                    </View>

                    {/* Add more photos buttons */}
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                      <TouchableOpacity
                        style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                        onPress={() => {
                          setShowMultiPhotoModal(false);
                          setShowCamera(true);
                        }}
                      >
                        <LinearGradient
                          colors={['#3B82F6', '#1D4ED8']}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 6 }}
                        >
                          <Camera size={16} color="#FFFFFF" />
                          <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Prendre photo</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                        onPress={async () => {
                          setShowMultiPhotoModal(false);
                          await pickPhotosFromGallery();
                        }}
                      >
                        <LinearGradient
                          colors={['#8B5CF6', '#7C3AED']}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 6 }}
                        >
                          <ImagePlus size={16} color="#FFFFFF" />
                          <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Ajouter photos</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>

                    {/* Directives textarea - resizable */}
                    <View style={{ backgroundColor: '#374151', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#94A3B8', letterSpacing: 1, marginBottom: 8 }}>
                        DIRECTIVES POUR L'ANALYSE IA (optionnel)
                      </Text>
                      <TextInput
                        style={[styles.commentsInput, {
                          width: '100%',
                          minHeight: 80,
                          maxHeight: 200,
                          height: directivesHeight,
                        }]}
                        placeholder="Ajoutez vos directives pour l'analyse IA de toutes les photos..."
                        placeholderTextColor="#64748B"
                        value={multiPhotoDirectives}
                        onChangeText={setMultiPhotoDirectives}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        onContentSizeChange={(e) => {
                          const newHeight = Math.min(200, Math.max(80, e.nativeEvent.contentSize.height));
                          setDirectivesHeight(newHeight);
                        }}
                      />
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: 'Inter-Regular', color: '#64748B' }}>
                          ↕ Redimensionnable
                        </Text>
                      </View>
                    </View>
                  </ScrollView>

                  {/* Footer actions */}
                  <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#374151' }}>
                    <TouchableOpacity
                      style={{ flex: 0.8, borderRadius: 12, overflow: 'hidden' }}
                      onPress={cancelMultiPhotoModal}
                    >
                      <View style={{ backgroundColor: '#475569', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }}>
                        <Text style={{ color: '#94A3B8', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Annuler</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1.2, borderRadius: 12, overflow: 'hidden' }}
                      onPress={savePhotosToDevice}
                      disabled={pendingPhotos.length === 0}
                    >
                      <LinearGradient
                        colors={pendingPhotos.length === 0 ? ['#64748B', '#475569'] : ['#10B981', '#059669']}
                        style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 14, flexDirection: 'row', gap: 6, paddingHorizontal: 10 }}
                      >
                        <FolderDown size={16} color="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Sauvegarder</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1.2, borderRadius: 12, overflow: 'hidden' }}
                      onPress={processMultiplePhotos}
                      disabled={pendingPhotos.length === 0}
                    >
                      <LinearGradient
                        colors={pendingPhotos.length === 0 ? ['#64748B', '#475569'] : ['#8B5CF6', '#A855F7']}
                        style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 14, flexDirection: 'row', gap: 6 }}
                      >
                        <Sparkles size={16} color="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 12 }}>Analyser</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </LinearGradient>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Multi-photo analysis progress modal */}
      <Modal visible={isAnalyzingMultiple && analyzingPhoto} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.pdfLoadingOverlay}>
            <View style={styles.pdfLoadingModal}>
              <LinearGradient
                colors={['#8B5CF6', '#A855F7']}
                style={styles.analyzingGradient}
              >
                <ActivityIndicator size={20} color="#FFFFFF" />
                <Text style={styles.analyzingTitle}>ANALYSE EN COURS</Text>
                <Text style={styles.analyzingSubtitle}>
                  {multiAnalysisProgress || 'Traitement des photos...'}
                </Text>
              </LinearGradient>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Loading photos spinner modal */}
      <Modal visible={isLoadingPhotos} animationType="fade" transparent>
        <View style={styles.pdfLoadingOverlay}>
          <View style={styles.pdfLoadingModal}>
            <LinearGradient
              colors={['#3B82F6', '#2563EB']}
              style={styles.analyzingGradient}
            >
              <ActivityIndicator size={20} color="#FFFFFF" />
              <Text style={styles.analyzingTitle}>CHARGEMENT DES PHOTOS</Text>
              <Text style={styles.analyzingSubtitle}>
                Importation des photos en cours...
              </Text>
            </LinearGradient>
          </View>
        </View>
      </Modal>

      {/* In-app Photo Editor Modal */}
      <Modal visible={showPhotoEditorModal} animationType="slide" transparent={false}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0F172A' }}>
          {/* Editor Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' }}>
            <TouchableOpacity onPress={() => setShowPhotoEditorModal(false)}>
              <Text style={{ color: '#EF4444', fontFamily: 'Inter-SemiBold', fontSize: 16 }}>Annuler</Text>
            </TouchableOpacity>
            <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 16 }}>Éditeur Photo</Text>
            <TouchableOpacity onPress={applyEditorChanges}>
              <Text style={{ color: '#10B981', fontFamily: 'Inter-SemiBold', fontSize: 16 }}>Appliquer</Text>
            </TouchableOpacity>
          </View>

          {/* Photo Preview with transforms */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' }}>
            {editingPhotoUri && (
              <Image
                source={{ uri: editingPhotoUri }}
                style={{
                  width: width * 0.9,
                  height: height * 0.5,
                  resizeMode: 'contain',
                  transform: [
                    { scale: editorScale },
                    { rotate: `${editorRotation}deg` },
                    { scaleX: editorFlipH ? -1 : 1 },
                    { scaleY: editorFlipV ? -1 : 1 },
                  ],
                }}
              />
            )}
          </View>

          {/* Zoom controls */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 12, gap: 20, backgroundColor: '#1E293B' }}>
            <TouchableOpacity
              style={{ backgroundColor: '#374151', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }}
              onPress={() => setEditorScale(prev => Math.max(0.5, prev - 0.1))}
            >
              <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 18 }}>−</Text>
            </TouchableOpacity>
            <Text style={{ color: '#94A3B8', fontFamily: 'Inter-SemiBold', fontSize: 14 }}>
              Zoom : {Math.round(editorScale * 100)}%
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#374151', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }}
              onPress={() => setEditorScale(prev => Math.min(3, prev + 0.1))}
            >
              <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 18 }}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Editor Controls */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 16, paddingHorizontal: 20, backgroundColor: '#1E293B', borderTopWidth: 1, borderTopColor: '#374151' }}>
            <TouchableOpacity
              style={{ alignItems: 'center', gap: 4 }}
              onPress={() => setEditorRotation(prev => prev - 90)}
            >
              <RotateCcw size={24} color="#FFFFFF" />
              <Text style={{ color: '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 10 }}>Rotation -90°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ alignItems: 'center', gap: 4 }}
              onPress={() => setEditorRotation(prev => prev + 90)}
            >
              <RefreshCw size={24} color="#FFFFFF" />
              <Text style={{ color: '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 10 }}>Rotation +90°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ alignItems: 'center', gap: 4 }}
              onPress={() => setEditorFlipH(prev => !prev)}
            >
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <ArrowRight size={24} color={editorFlipH ? '#3B82F6' : '#FFFFFF'} />
              </View>
              <Text style={{ color: editorFlipH ? '#3B82F6' : '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 10 }}>Miroir H</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ alignItems: 'center', gap: 4 }}
              onPress={() => setEditorFlipV(prev => !prev)}
            >
              <View style={{ transform: [{ rotate: '90deg' }, { scaleX: -1 }] }}>
                <ArrowRight size={24} color={editorFlipV ? '#3B82F6' : '#FFFFFF'} />
              </View>
              <Text style={{ color: editorFlipV ? '#3B82F6' : '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 10 }}>Miroir V</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ alignItems: 'center', gap: 4 }}
              onPress={() => {
                setEditorScale(1);
                setEditorRotation(0);
                setEditorFlipH(false);
                setEditorFlipV(false);
              }}
            >
              <X size={24} color="#EF4444" />
              <Text style={{ color: '#EF4444', fontFamily: 'Inter-Regular', fontSize: 10 }}>Réinit.</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Group Detail Modal */}
      <Modal visible={showGroupDetail} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <View style={styles.photoDetailOverlay}>
              <View style={styles.photoDetailModal}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.photoDetailGradient}
                >
                  {selectedGroupId && (() => {
                    const group = reportGroups.find(g => g.groupId === selectedGroupId);
                    if (!group) return null;
                    return (
                      <>
                        <View style={styles.photoDetailHeader}>
                          <Text style={styles.photoDetailTitle}>
                            {group.isDirectiveOnly ? 'RAPPORT DIRECTIVES' : `RAPPORT (${group.photos.length} photo${group.photos.length > 1 ? 's' : ''})`}
                          </Text>
                          <View style={styles.photoDetailActions}>
                            {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') && (
                              <>
                                {group.aiAnalysis && (
                                  <TouchableOpacity
                                    style={[styles.deletePhotoButton, { backgroundColor: editingGroupReport ? '#F59E0B22' : undefined }]}
                                    onPress={() => {
                                      if (editingGroupReport) {
                                        setEditingGroupReport(false);
                                      } else {
                                        setTempGroupObservations([...(group.aiAnalysis?.observations || [])]);
                                        setTempGroupRecommendations([...(group.aiAnalysis?.recommendations || [])]);
                                        setTempGroupReferences([...(group.aiAnalysis?.references || [])]);
                                        setEditingGroupReport(true);
                                      }
                                    }}
                                  >
                                    <Pencil size={18} color={editingGroupReport ? '#F59E0B' : '#3B82F6'} />
                                  </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                  style={styles.deletePhotoButton}
                                  onPress={() => deleteGroup(group.groupId)}
                                >
                                  <Trash2 size={20} color="#EF4444" />
                                </TouchableOpacity>
                              </>
                            )}
                            <TouchableOpacity
                              style={styles.closePhotoDetailButton}
                              onPress={() => { setShowGroupDetail(false); setSelectedGroupId(null); setEditingGroupDirectives(false); setEditingGroupComments(false); setEditingGroupReport(false); }}
                            >
                              <X size={20} color="#FFFFFF" />
                            </TouchableOpacity>
                          </View>
                        </View>

                        <ScrollView style={styles.photoDetailContent} showsVerticalScrollIndicator={false}>
                          {/* AI Analysis */}
                          {group.aiAnalysis && (
                            <View style={styles.aiAnalysisSection}>
                              <View style={styles.aiAnalysisHeader}>
                                <Sparkles size={20} color="#8B5CF6" />
                                <Text style={styles.aiAnalysisTitle}>
                                  {editingGroupReport ? 'MODIFIER LE RAPPORT' : 'ANALYSE IA'}
                                </Text>
                                <View style={[
                                  styles.riskBadgeDetail,
                                  { backgroundColor: getRiskColor(group.aiAnalysis.riskLevel) }
                                ]}>
                                  <Text style={styles.riskTextDetail}>
                                    {getRiskLabel(group.aiAnalysis.riskLevel)}
                                  </Text>
                                </View>
                              </View>

                              <Text style={styles.confidenceDetail}>
                                Confiance: {group.aiAnalysis.confidence}%
                              </Text>

                              {editingGroupReport ? (
                                <>
                                  {/* Editable Observations */}
                                  <View style={styles.analysisBlock}>
                                    <Text style={styles.analysisBlockTitle}>OBSERVATIONS</Text>
                                    {tempGroupObservations.map((obs, idx) => (
                                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                                        <Eye size={14} color="#94A3B8" style={{ marginTop: 10 }} />
                                        <TextInput
                                          style={[styles.commentsInput, { flex: 1, minHeight: 40, fontSize: 13, color: '#E2E8F0' }]}
                                          value={obs}
                                          onChangeText={(text) => {
                                            const updated = [...tempGroupObservations];
                                            updated[idx] = text;
                                            setTempGroupObservations(updated);
                                          }}
                                          multiline
                                          textAlignVertical="top"
                                          placeholderTextColor="#64748B"
                                        />
                                        <TouchableOpacity onPress={() => setTempGroupObservations(prev => prev.filter((_, i) => i !== idx))}>
                                          <X size={16} color="#EF4444" style={{ marginTop: 10 }} />
                                        </TouchableOpacity>
                                      </View>
                                    ))}
                                    <TouchableOpacity
                                      onPress={() => setTempGroupObservations(prev => [...prev, ''])}
                                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                                    >
                                      <Plus size={14} color="#3B82F6" />
                                      <Text style={{ color: '#3B82F6', fontSize: 12, fontFamily: 'Inter-Bold' }}>Ajouter</Text>
                                    </TouchableOpacity>
                                  </View>

                                  {/* Editable Recommendations */}
                                  <View style={styles.analysisBlock}>
                                    <Text style={styles.analysisBlockTitle}>RECOMMANDATIONS</Text>
                                    {tempGroupRecommendations.map((rec, idx) => (
                                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                                        <AlertTriangle size={14} color="#F59E0B" style={{ marginTop: 10 }} />
                                        <TextInput
                                          style={[styles.commentsInput, { flex: 1, minHeight: 40, fontSize: 13, color: '#E2E8F0' }]}
                                          value={rec}
                                          onChangeText={(text) => {
                                            const updated = [...tempGroupRecommendations];
                                            updated[idx] = text;
                                            setTempGroupRecommendations(updated);
                                          }}
                                          multiline
                                          textAlignVertical="top"
                                          placeholderTextColor="#64748B"
                                        />
                                        <TouchableOpacity onPress={() => setTempGroupRecommendations(prev => prev.filter((_, i) => i !== idx))}>
                                          <X size={16} color="#EF4444" style={{ marginTop: 10 }} />
                                        </TouchableOpacity>
                                      </View>
                                    ))}
                                    <TouchableOpacity
                                      onPress={() => setTempGroupRecommendations(prev => [...prev, ''])}
                                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                                    >
                                      <Plus size={14} color="#3B82F6" />
                                      <Text style={{ color: '#3B82F6', fontSize: 12, fontFamily: 'Inter-Bold' }}>Ajouter</Text>
                                    </TouchableOpacity>
                                  </View>

                                  {/* Editable References */}
                                  <View style={styles.analysisBlock}>
                                    <Text style={styles.analysisBlockTitle}>RÉFÉRENCES</Text>
                                    {tempGroupReferences.map((ref, idx) => (
                                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                                        <NotebookPen size={14} color="#F59E0B" style={{ marginTop: 10 }} />
                                        <TextInput
                                          style={[styles.commentsInput, { flex: 1, minHeight: 40, fontSize: 13, color: '#E2E8F0' }]}
                                          value={ref}
                                          onChangeText={(text) => {
                                            const updated = [...tempGroupReferences];
                                            updated[idx] = text;
                                            setTempGroupReferences(updated);
                                          }}
                                          multiline
                                          textAlignVertical="top"
                                          placeholderTextColor="#64748B"
                                        />
                                        <TouchableOpacity onPress={() => setTempGroupReferences(prev => prev.filter((_, i) => i !== idx))}>
                                          <X size={16} color="#EF4444" style={{ marginTop: 10 }} />
                                        </TouchableOpacity>
                                      </View>
                                    ))}
                                    <TouchableOpacity
                                      onPress={() => setTempGroupReferences(prev => [...prev, ''])}
                                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                                    >
                                      <Plus size={14} color="#3B82F6" />
                                      <Text style={{ color: '#3B82F6', fontSize: 12, fontFamily: 'Inter-Bold' }}>Ajouter</Text>
                                    </TouchableOpacity>
                                  </View>

                                  {/* Save / Cancel buttons */}
                                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                                    <TouchableOpacity
                                      style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                                      onPress={() => setEditingGroupReport(false)}
                                    >
                                      <LinearGradient colors={['#1e293be2', '#1E293B']} style={styles.saveCommentsGradient}>
                                        <Text style={styles.cancelCommentsText}>Annuler</Text>
                                      </LinearGradient>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                                      onPress={saveGroupReportEdits}
                                    >
                                      <LinearGradient colors={['#10B981', '#059669']} style={styles.saveCommentsGradient}>
                                        <Text style={styles.saveEditableReportText}>Sauvegarder</Text>
                                      </LinearGradient>
                                    </TouchableOpacity>
                                  </View>
                                </>
                              ) : (
                                <>
                                  {group.aiAnalysis?.observations && group.aiAnalysis.observations.length > 0 && (
                                    <View style={styles.analysisBlock}>
                                      <Text style={styles.analysisBlockTitle}>OBSERVATIONS</Text>
                                      {group.aiAnalysis.observations.map((obs, idx) => (
                                        <View key={idx} style={styles.analysisItem}>
                                          <Eye size={14} color="#94A3B8" />
                                          <Text style={styles.analysisText}>{obs}</Text>
                                        </View>
                                      ))}
                                    </View>
                                  )}

                                  {group.aiAnalysis?.recommendations && group.aiAnalysis.recommendations.length > 0 && (
                                    <View style={styles.analysisBlock}>
                                      <Text style={styles.analysisBlockTitle}>RECOMMANDATIONS</Text>
                                      {group.aiAnalysis.recommendations.map((rec, idx) => (
                                        <View key={idx} style={styles.analysisItem}>
                                          <AlertTriangle size={14} color="#F59E0B" />
                                          <Text style={styles.analysisText}>{rec}</Text>
                                        </View>
                                      ))}
                                    </View>
                                  )}

                                  {group.aiAnalysis?.references && group.aiAnalysis.references.length > 0 && (
                                    <View style={styles.analysisBlock}>
                                      <Text style={styles.analysisBlockTitle}>RÉFÉRENCES</Text>
                                      {group.aiAnalysis.references.map((ref, idx) => (
                                        <View key={idx} style={styles.analysisItem}>
                                          <NotebookPen size={14} color="#F59E0B" />
                                          <Text style={styles.analysisText}>{ref}</Text>
                                        </View>
                                      ))}
                                    </View>
                                  )}

                                  {/* Unreadable Sections Warning */}
                                  {group.aiAnalysis?.unreadableSections && group.aiAnalysis.unreadableSections.length > 0 && (
                                    <View style={[styles.analysisBlock, { backgroundColor: '#7F1D1D', borderLeftWidth: 3, borderLeftColor: '#EF4444', borderRadius: 10, padding: 12 }]}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <Camera size={16} color="#FCA5A5" />
                                        <Text style={[styles.analysisBlockTitle, { color: '#FCA5A5', marginBottom: 0 }]}>SECTIONS ILLISIBLES — REPRISE PHOTO NÉCESSAIRE</Text>
                                      </View>
                                      {group.aiAnalysis.unreadableSections.map((section, idx) => (
                                        <View key={idx} style={[styles.analysisItem, { marginBottom: 6 }]}>
                                          <AlertTriangle size={14} color="#FCA5A5" />
                                          <Text style={[styles.analysisText, { color: '#FECACA' }]}>{section}</Text>
                                        </View>
                                      ))}
                                      {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') && (
                                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                                          <TouchableOpacity
                                            style={{ flex: 1, borderRadius: 8, overflow: 'hidden' }}
                                            onPress={() => {
                                              setShowGroupDetail(false);
                                              setTimeout(() => openUnreadableSectionsModal(group.groupId, group.aiAnalysis?.unreadableSections || []), 300);
                                            }}
                                          >
                                            <LinearGradient
                                              colors={['#7C3AED', '#8B5CF6']}
                                              style={{ paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
                                            >
                                              <Sparkles size={16} color="#FFFFFF" />
                                              <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Résoudre les sections</Text>
                                            </LinearGradient>
                                          </TouchableOpacity>
                                          <TouchableOpacity
                                            style={{ borderRadius: 8, overflow: 'hidden' }}
                                            onPress={() => addDetailPhotosToGroup(group.groupId)}
                                          >
                                            <LinearGradient
                                              colors={['#3B82F6', '#2563EB']}
                                              style={{ paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
                                            >
                                              <ImagePlus size={16} color="#FFFFFF" />
                                              <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>+ Détail</Text>
                                            </LinearGradient>
                                          </TouchableOpacity>
                                        </View>
                                      )}
                                    </View>
                                  )}
                                </>
                              )}
                            </View>
                          )}

                          {/* Directives - Always editable */}
                          <View style={styles.commentsSection}>
                            <View style={styles.commentsSectionHeader}>
                              <Text style={styles.commentsSectionTitle}>DIRECTIVES</Text>
                            </View>

                            {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') ? (
                              <View style={styles.commentsEditContainer}>
                                <TextInput
                                  style={[styles.commentsInput, {
                                    minHeight: 80,
                                    maxHeight: 200,
                                    height: groupDirectivesHeight,
                                  }]}
                                  placeholder="Ajoutez vos directives pour le groupe..."
                                  placeholderTextColor="#64748B"
                                  value={editingGroupDirectives ? tempGroupDirectives : (group.directives || '')}
                                  onChangeText={(text) => {
                                    if (!editingGroupDirectives) {
                                      setTempGroupDirectives(text);
                                      setEditingGroupDirectives(true);
                                    } else {
                                      setTempGroupDirectives(text);
                                    }
                                  }}
                                  onFocus={() => {
                                    if (!editingGroupDirectives) {
                                      setTempGroupDirectives(group.directives || '');
                                      setEditingGroupDirectives(true);
                                    }
                                  }}
                                  multiline
                                  numberOfLines={4}
                                  textAlignVertical="top"
                                  onContentSizeChange={(e) => {
                                    const newH = Math.min(200, Math.max(80, e.nativeEvent.contentSize.height));
                                    setGroupDirectivesHeight(newH);
                                  }}
                                />
                                {editingGroupDirectives && (
                                  <View style={styles.commentsActions}>
                                    <TouchableOpacity
                                      style={styles.cancelCommentsButton}
                                      onPress={() => {
                                        setEditingGroupDirectives(false);
                                        setTempGroupDirectives(group.directives || '');
                                      }}
                                    >
                                      <LinearGradient
                                        colors={['#1e293be2', '#1E293B']}
                                        style={styles.saveCommentsGradient}
                                      >
                                        <Text style={styles.cancelCommentsText}>Annuler</Text>
                                      </LinearGradient>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                      style={styles.saveCommentsButton}
                                      onPress={saveGroupDirectives}
                                    >
                                      <LinearGradient
                                        colors={['#10B981', '#059669']}
                                        style={styles.saveCommentsGradient}
                                      >
                                        <Text style={styles.saveCommentsText}>{`Sauvegarder\ndirectives`}</Text>
                                      </LinearGradient>
                                    </TouchableOpacity>

                                    {(reportStatus !== 'envoye_au_client' && (!mission || (mission as any).originalStatus !== 'terminee')) && (
                                      <TouchableOpacity
                                        style={styles.saveCommentsButton}
                                        onPress={regenerateGroupReport}
                                        disabled={isRegeneratingGroup}
                                      >
                                        <LinearGradient
                                          colors={isRegeneratingGroup ? ['#64748B', '#475569'] : ['#8B5CF6', '#7C3AED']}
                                          style={styles.saveCommentsGradient}
                                        >
                                          {isRegeneratingGroup ? (
                                            <ActivityIndicator size={12} color="#FFFFFF" />
                                          ) : (
                                            <Text style={styles.saveCommentsText}>{`Regénérer\nrapport`}</Text>
                                          )}
                                        </LinearGradient>
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                )}
                              </View>
                            ) : (
                              <View style={styles.commentsDisplay}>
                                {group.directives ? (
                                  <Text style={styles.commentsText}>{group.directives}</Text>
                                ) : (
                                  <Text style={styles.noCommentsText}>Aucune directive ajoutée</Text>
                                )}
                              </View>
                            )}
                          </View>

                          {/* Comments - Always editable */}
                          <View style={styles.commentsSection}>
                            <View style={styles.commentsSectionHeader}>
                              <Text style={styles.commentsSectionTitle}>COMMENTAIRES</Text>
                            </View>

                            {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') ? (
                              <View style={styles.commentsEditContainer}>
                                <TextInput
                                  style={[styles.commentsInput, {
                                    minHeight: 80,
                                    maxHeight: 200,
                                    height: groupCommentsHeight,
                                  }]}
                                  placeholder="Ajoutez vos commentaires pour le groupe..."
                                  placeholderTextColor="#64748B"
                                  value={editingGroupComments ? tempGroupComments : (group.comment || '')}
                                  onChangeText={(text) => {
                                    if (!editingGroupComments) {
                                      setTempGroupComments(text);
                                      setEditingGroupComments(true);
                                    } else {
                                      setTempGroupComments(text);
                                    }
                                  }}
                                  onFocus={() => {
                                    if (!editingGroupComments) {
                                      setTempGroupComments(group.comment || '');
                                      setEditingGroupComments(true);
                                    }
                                  }}
                                  multiline
                                  numberOfLines={4}
                                  textAlignVertical="top"
                                  onContentSizeChange={(e) => {
                                    const newH = Math.min(200, Math.max(80, e.nativeEvent.contentSize.height));
                                    setGroupCommentsHeight(newH);
                                  }}
                                />
                                {editingGroupComments && (
                                  <View style={styles.commentsActions}>
                                    <TouchableOpacity
                                      style={styles.cancelCommentsButton}
                                      onPress={() => {
                                        setEditingGroupComments(false);
                                        setTempGroupComments(group.comment || '');
                                      }}
                                    >
                                      <LinearGradient
                                        colors={['#1e293be2', '#1E293B']}
                                        style={styles.saveCommentsGradient}
                                      >
                                        <Text style={styles.cancelCommentsText}>Annuler</Text>
                                      </LinearGradient>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                      style={styles.saveCommentsButton}
                                      onPress={saveGroupComments}
                                    >
                                      <LinearGradient
                                        colors={['#10B981', '#059669']}
                                        style={styles.saveCommentsGradient}
                                      >
                                        <Text style={styles.saveCommentsText}>{`Sauvegarder\ncommentaires`}</Text>
                                      </LinearGradient>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            ) : (
                              <View style={styles.commentsDisplay}>
                                {group.comment ? (
                                  <Text style={styles.commentsText}>{group.comment}</Text>
                                ) : (
                                  <Text style={styles.noCommentsText}>Aucun commentaire</Text>
                                )}
                              </View>
                            )}
                          </View>

                          {/* Photos - moved to end, after comments */}
                          {!group.isDirectiveOnly && group.photos.length > 0 && (
                            <View style={{ marginBottom: 20, marginTop: 8 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#94A3B8', letterSpacing: 1 }}>
                                  PHOTOS ({group.photos.length})
                                  {group.photos.some(p => p.isDetailPhoto) && (
                                    <Text style={{ color: '#3B82F6' }}> • {group.photos.filter(p => p.isDetailPhoto).length} détail(s)</Text>
                                  )}
                                </Text>
                                {(reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee') && (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <TouchableOpacity
                                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1E3A5F', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
                                      onPress={() => attachPhotosToGroup(group.groupId)}
                                    >
                                      <ImagePlus size={14} color="#10B981" />
                                      <Text style={{ color: '#10B981', fontSize: 11, fontFamily: 'Inter-SemiBold' }}>Joindre</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1E3A5F', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
                                      onPress={() => addDetailPhotosToGroup(group.groupId)}
                                    >
                                      <ImagePlus size={14} color="#3B82F6" />
                                      <Text style={{ color: '#3B82F6', fontSize: 11, fontFamily: 'Inter-SemiBold' }}>+ Détail</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                              {group.photos.map((photo, idx) => {
                                const isAttachedOnly = !photo.aiAnalysis && !photo.isDirectiveOnly && !photo.isDetailPhoto;
                                const canDeleteAttached = isAttachedOnly && (reportStatus !== 'envoye_au_client') && (!mission || (mission as any).originalStatus !== 'terminee');
                                return (
                                <View key={photo.id} style={{ marginBottom: 12, position: 'relative' }}>
                                <TouchableOpacity
                                  onPress={() => {
                                    setZoomedImageUri(photo.uri);
                                    setShowImageZoom(true);
                                  }}
                                  style={{ borderRadius: 12, overflow: 'hidden', position: 'relative' }}
                                >
                                  <Image
                                    source={{ uri: photo.uri }}
                                    style={{ width: '100%', height: undefined, aspectRatio: 4 / 3 }}
                                    resizeMode="cover"
                                  />
                                  <View style={{
                                    position: 'absolute', bottom: 8, left: 8,
                                    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8,
                                    paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4,
                                  }}>
                                    <Eye size={12} color="#FFFFFF" />
                                    <Text style={{ color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter-Bold' }}>
                                      {photo.isDetailPhoto ? `📷 Détail n°${idx + 1}` : idx === 0 ? '⭐ Photo principale' : `Photo n°${idx + 1}`}
                                    </Text>
                                  </View>
                                  {idx === 0 && !photo.isDetailPhoto && (
                                    <View style={{
                                      position: 'absolute', top: 8, left: 8,
                                      backgroundColor: '#F59E0B', borderRadius: 8,
                                      paddingHorizontal: 8, paddingVertical: 3,
                                    }}>
                                      <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'Inter-Bold' }}>PRINCIPALE</Text>
                                    </View>
                                  )}
                                  {photo.isDetailPhoto && (
                                    <View style={{
                                      position: 'absolute', top: 8, left: 8,
                                      backgroundColor: '#3B82F6', borderRadius: 8,
                                      paddingHorizontal: 8, paddingVertical: 3,
                                    }}>
                                      <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'Inter-Bold' }}>DÉTAIL</Text>
                                    </View>
                                  )}
                                  {photo.aiAnalysis && (
                                    <View style={{
                                      position: 'absolute', top: 8, right: 8,
                                      backgroundColor: getRiskColor(photo.aiAnalysis.riskLevel),
                                      borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
                                    }}>
                                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontFamily: 'Inter-Bold' }}>
                                        {getRiskLabel(photo.aiAnalysis.riskLevel)}
                                      </Text>
                                    </View>
                                  )}
                                </TouchableOpacity>
                                {canDeleteAttached && (
                                  <TouchableOpacity
                                    onPress={() => handleDeleteAttachedPhotoMobile(photo, group.groupId)}
                                    style={{
                                      position: 'absolute', top: 8, right: 8,
                                      backgroundColor: 'rgba(239, 68, 68, 0.9)', borderRadius: 12,
                                      width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
                                    }}
                                  >
                                    <Trash2 size={14} color="#FFFFFF" />
                                  </TouchableOpacity>
                                )}
                                </View>
                                );
                              })}
                            </View>
                          )}
                        </ScrollView>
                      </>
                    );
                  })()}
                </LinearGradient>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Image Zoom Modal */}
      <Modal visible={showImageZoom} animationType="fade" transparent>
        <View style={{
          flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <TouchableOpacity
            style={{
              position: 'absolute', top: 60, right: 20, zIndex: 10,
              backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 20,
              width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
            }}
            onPress={() => { setShowImageZoom(false); setZoomedImageUri(null); }}
          >
            <X size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {zoomedImageUri && (
            <Image
              source={{ uri: zoomedImageUri }}
              style={{ width: width, height: height * 0.75 }}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Unreadable Sections Expert Modal */}
      <Modal visible={showUnreadableSectionsModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <View style={styles.photoDetailOverlay}>
              <View style={[styles.photoDetailModal, { height: '92%' }]}>
                <LinearGradient
                  colors={['#0F172A', '#1E293B']}
                  style={styles.photoDetailGradient}
                >
                  {/* Header */}
                  <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#334155' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <View style={{ backgroundColor: '#EF4444', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'Inter-Bold', letterSpacing: 1 }}>EXPERT CSPS</Text>
                          </View>
                          <View style={{ backgroundColor: '#7C3AED', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: 'Inter-Bold', letterSpacing: 1 }}>ANALYSE SENIOR</Text>
                          </View>
                        </View>
                        <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 16, marginTop: 4 }}>
                          📸 Sections illisibles détectées
                        </Text>
                        <Text style={{ color: '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 12, marginTop: 2 }}>
                          {unreadableSectionsList.length} section(s) nécessitant une reprise photographique
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={{ backgroundColor: '#374151', borderRadius: 20, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
                        onPress={() => setShowUnreadableSectionsModal(false)}
                      >
                        <X size={18} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Expert Info Banner */}
                  <View style={{ marginHorizontal: 20, marginTop: 12, backgroundColor: '#1E3A5F', borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#3B82F6' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <Sparkles size={18} color="#60A5FA" style={{ marginTop: 2 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#93C5FD', fontFamily: 'Inter-Bold', fontSize: 12, marginBottom: 4 }}>
                          PROTOCOLE D'ANALYSE RENFORCÉE
                        </Text>
                        <Text style={{ color: '#BFDBFE', fontFamily: 'Inter-Regular', fontSize: 11, lineHeight: 16 }}>
                          L'IA a identifié des zones illisibles dues à la qualité de la photo (floue, bougée, mal cadrée). Ajoutez des photos de meilleure qualité ciblant chaque section. Les sections cachées ou mal imprimées sur le document original ont déjà été traitées avec les informations disponibles.
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Sections List */}
                  <ScrollView style={{ flex: 1, paddingHorizontal: 20, marginTop: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {unreadableSectionsList.map((section, index) => {
                      const sectionPhotos = sectionPhotosMap[section] || [];
                      const isExpanded = selectedUnreadableSection === section;

                      return (
                        <View key={index} style={{
                          marginBottom: 12, borderRadius: 14, overflow: 'hidden',
                          borderWidth: 1, borderColor: sectionPhotos.length > 0 ? '#10B981' : '#EF4444',
                        }}>
                          {/* Section Header */}
                          <TouchableOpacity
                            onPress={() => setSelectedUnreadableSection(isExpanded ? null : section)}
                            style={{ backgroundColor: sectionPhotos.length > 0 ? '#064E3B' : '#7F1D1D', padding: 14 }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <View style={{
                                backgroundColor: sectionPhotos.length > 0 ? '#10B981' : '#EF4444',
                                borderRadius: 20, width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
                              }}>
                                {sectionPhotos.length > 0 ? (
                                  <CheckCircle size={16} color="#FFFFFF" />
                                ) : (
                                  <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 12 }}>{index + 1}</Text>
                                )}
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{
                                  color: sectionPhotos.length > 0 ? '#A7F3D0' : '#FCA5A5',
                                  fontFamily: 'Inter-SemiBold', fontSize: 13, lineHeight: 18,
                                }}>
                                  {section}
                                </Text>
                                {sectionPhotos.length > 0 && (
                                  <Text style={{ color: '#6EE7B7', fontFamily: 'Inter-Regular', fontSize: 11, marginTop: 2 }}>
                                    ✅ {sectionPhotos.length} photo(s) ajoutée(s)
                                  </Text>
                                )}
                              </View>
                              <ArrowRight size={16} color={sectionPhotos.length > 0 ? '#A7F3D0' : '#FCA5A5'}
                                style={{ transform: [{ rotate: isExpanded ? '90deg' : '0deg' }] }}
                              />
                            </View>
                          </TouchableOpacity>

                          {/* Expanded Section Content */}
                          {isExpanded && (
                            <View style={{ backgroundColor: '#1E293B', padding: 14 }}>
                              {/* Section photos grid */}
                              {sectionPhotos.length > 0 && (
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                                  {sectionPhotos.map((photo) => (
                                    <View key={photo.id} style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
                                      <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} />
                                      <TouchableOpacity
                                        style={{
                                          position: 'absolute', top: 2, right: 2,
                                          backgroundColor: 'rgba(239, 68, 68, 0.9)', borderRadius: 10,
                                          width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
                                        }}
                                        onPress={() => removeSectionPhoto(section, photo.id)}
                                      >
                                        <X size={10} color="#FFFFFF" />
                                      </TouchableOpacity>
                                    </View>
                                  ))}
                                </View>
                              )}

                              {/* Action buttons */}
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                <TouchableOpacity
                                  style={{ flex: 1, borderRadius: 10, overflow: 'hidden' }}
                                  onPress={() => addPhotosForSection(section)}
                                >
                                  <LinearGradient
                                    colors={['#3B82F6', '#2563EB']}
                                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 6 }}
                                  >
                                    <ImagePlus size={14} color="#FFFFFF" />
                                    <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 11 }}>Galerie</Text>
                                  </LinearGradient>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={{ borderRadius: 10, overflow: 'hidden' }}
                                  onPress={() => takeCameraPhotoForSection(section)}
                                >
                                  <LinearGradient
                                    colors={['#8B5CF6', '#7C3AED']}
                                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 14, gap: 6 }}
                                  >
                                    <Camera size={14} color="#FFFFFF" />
                                    <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-SemiBold', fontSize: 11 }}>📸</Text>
                                  </LinearGradient>
                                </TouchableOpacity>
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })}

                    {/* Summary stats */}
                    <View style={{ backgroundColor: '#374151', borderRadius: 12, padding: 14, marginTop: 4, marginBottom: 20 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                        <View style={{ alignItems: 'center' }}>
                          <Text style={{ color: '#EF4444', fontFamily: 'Inter-Bold', fontSize: 20 }}>
                            {unreadableSectionsList.filter(s => !(sectionPhotosMap[s]?.length > 0)).length}
                          </Text>
                          <Text style={{ color: '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 10 }}>Sans photos</Text>
                        </View>
                        <View style={{ width: 1, backgroundColor: '#4B5563' }} />
                        <View style={{ alignItems: 'center' }}>
                          <Text style={{ color: '#10B981', fontFamily: 'Inter-Bold', fontSize: 20 }}>
                            {unreadableSectionsList.filter(s => sectionPhotosMap[s]?.length > 0).length}
                          </Text>
                          <Text style={{ color: '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 10 }}>Avec photos</Text>
                        </View>
                        <View style={{ width: 1, backgroundColor: '#4B5563' }} />
                        <View style={{ alignItems: 'center' }}>
                          <Text style={{ color: '#60A5FA', fontFamily: 'Inter-Bold', fontSize: 20 }}>
                            {Object.values(sectionPhotosMap).flat().length}
                          </Text>
                          <Text style={{ color: '#94A3B8', fontFamily: 'Inter-Regular', fontSize: 10 }}>Total photos</Text>
                        </View>
                      </View>
                    </View>
                  </ScrollView>

                  {/* Footer Actions */}
                  <View style={{ paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#334155', gap: 10 }}>
                    {/* Primary action */}
                    <TouchableOpacity
                      style={{ borderRadius: 12, overflow: 'hidden' }}
                      onPress={processUnreadableSectionPhotos}
                      disabled={Object.values(sectionPhotosMap).flat().length === 0}
                    >
                      <LinearGradient
                        colors={Object.values(sectionPhotosMap).flat().length === 0 ? ['#475569', '#374151'] : ['#8B5CF6', '#7C3AED']}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 8 }}
                      >
                        <Sparkles size={18} color="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 14 }}>
                          Lancer l'analyse enrichie ({Object.values(sectionPhotosMap).flat().length} photos)
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>

                    {/* Secondary actions */}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity
                        style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                        onPress={skipRemainingUnreadableSections}
                      >
                        <View style={{ backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, flexDirection: 'row', gap: 6 }}>
                          <ArrowRight size={14} color="#F59E0B" />
                          <Text style={{ color: '#F59E0B', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Ignorer et continuer</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 0.6, borderRadius: 12, overflow: 'hidden' }}
                        onPress={() => setShowUnreadableSectionsModal(false)}
                      >
                        <View style={{ backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderWidth: 1, borderColor: '#475569', borderRadius: 12 }}>
                          <Text style={{ color: '#94A3B8', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Fermer</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>
                </LinearGradient>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Unreadable sections processing progress */}
      <Modal visible={isProcessingUnreadable && analyzingPhoto} animationType="fade" transparent>
        <View style={styles.pdfLoadingOverlay}>
          <View style={styles.pdfLoadingModal}>
            <LinearGradient
              colors={['#7C3AED', '#8B5CF6']}
              style={styles.analyzingGradient}
            >
              <ActivityIndicator size={20} color="#FFFFFF" />
              <Text style={styles.analyzingTitle}>ANALYSE ENRICHIE EN COURS</Text>
              <Text style={styles.analyzingSubtitle}>
                {unreadableProgress || 'Traitement des photos de détail...'}
              </Text>
            </LinearGradient>
          </View>
        </View>
      </Modal>


      <Modal visible={showDirectiveOnlyModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <View style={styles.photoDetailOverlay}>
              <View style={[styles.photoDetailModal, { height: '85%' }]}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.photoDetailGradient}
                >
                  <View style={styles.photoDetailHeader}>
                    <Text style={styles.photoDetailTitle}>RAPPORT SANS PHOTO</Text>
                    <TouchableOpacity
                      style={styles.closePhotoDetailButton}
                      onPress={() => { setShowDirectiveOnlyModal(false); setDirectiveOnlyText(''); setDirectiveOnlyComment(''); }}
                    >
                      <X size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ flex: 1, paddingHorizontal: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    <View style={{ backgroundColor: '#374151', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#94A3B8', letterSpacing: 1, marginBottom: 8 }}>
                        DIRECTIVES DU COORDONNATEUR *
                      </Text>
                      <TextInput
                        style={[styles.commentsInput, { minHeight: 200 }]}
                        placeholder="Saisissez vos directives et observations..."
                        placeholderTextColor="#64748B"
                        value={directiveOnlyText}
                        onChangeText={setDirectiveOnlyText}
                        multiline
                        numberOfLines={6}
                        textAlignVertical="top"
                      />
                    </View>

                    <View style={{ backgroundColor: '#374151', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                      <Text style={{ fontSize: 12, fontFamily: 'Inter-Bold', color: '#94A3B8', letterSpacing: 1, marginBottom: 8 }}>
                        COMMENTAIRE (optionnel)
                      </Text>
                      <TextInput
                        style={[styles.commentsInput, { minHeight: 80 }]}
                        placeholder="Ajoutez un commentaire..."
                        placeholderTextColor="#64748B"
                        value={directiveOnlyComment}
                        onChangeText={setDirectiveOnlyComment}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                    </View>
                  </ScrollView>

                  <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#374151' }}>
                    <TouchableOpacity
                      style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}
                      onPress={() => { setShowDirectiveOnlyModal(false); setDirectiveOnlyText(''); setDirectiveOnlyComment(''); }}
                    >
                      <View style={{ backgroundColor: '#475569', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }}>
                        <Text style={{ color: '#94A3B8', fontFamily: 'Inter-SemiBold', fontSize: 12 }}>Annuler</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1.5, borderRadius: 12, overflow: 'hidden' }}
                      onPress={createDirectiveOnlyEntry}
                      disabled={!directiveOnlyText.trim() || analyzingPhoto}
                    >
                      <LinearGradient
                        colors={(!directiveOnlyText.trim() || analyzingPhoto) ? ['#64748B', '#475569'] : ['#F59E0B', '#D97706']}
                        style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 14, flexDirection: 'row', gap: 6 }}
                      >
                        {analyzingPhoto ? (
                          <>
                            <ActivityIndicator size="small" color="#FFFFFF" />
                            <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 12 }}>Analyse IA...</Text>
                          </>
                        ) : (
                          <>
                            <Sparkles size={16} color="#FFFFFF" />
                            <Text style={{ color: '#FFFFFF', fontFamily: 'Inter-Bold', fontSize: 12 }}>Analyser & Créer</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </LinearGradient>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
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
    marginBottom: 10,
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
    // backgroundColor: 'rgba(159, 159, 6, 0.69)',
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
    paddingHorizontal: 16,
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
    gap: 6,
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
    width: '100%',
    // alignItems: 'center',
    // justifyContent: 'center',
  },
  cancelCommentsButton: {
    flex: 0.8,
    // backgroundColor: '#1E293B',
    backgroundRepeat: 'no-repeat',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cancelCommentsText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 0.5,
    paddingBottom: 21,
    paddingTop: 21,
    paddingLeft: 6,
    paddingRight: 6,
  },
  saveCommentsButton: {
    flex: 1.1,
    borderRadius: 12,
    overflow: 'hidden',

  },
  saveCommentsGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    gap: 6,

  },
  saveCommentsText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    paddingVertical: 12,
  },
  saveEditableReportText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    paddingVertical: 21,
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
    paddingHorizontal: 12,
  },
  reportModal: {
    height: '95%',
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
    paddingHorizontal: 12,
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
    padding: 10,
    minHeight: 150,
    marginBottom: 10,
    textAlignVertical: 'top',
  },
  reportModalFooter: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: '#374151',
    gap: 8,
  },
  validateReportButton: {
    flex: 1.8,
    backgroundColor: '#475569',
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
    overflow: 'hidden',

    paddingVertical: 16,
  },
  sendReportButtonDisabled: {
    opacity: 0.5,
  },
  sendReportGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
  },
  sendReportText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    paddingVertical: 16,

  },
  // Chantier Selector Modal styles
  missionSelectorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    paddingHorizontal: 20,
    overflowY: 'auto',
  },
  missionSelectorModal: {
    height: '85%',
    borderRadius: 24,
    // overflow: 'hidden',
  },
  missionSelectorGradient: {
    flex: 1,
    // paddingTop: 24,
    alignItems: 'center',
    borderRadius: 24,
    maxHeight: '100%',
    overflowY: 'auto',
  },
  missionSelectorHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
    paddingBottom: 16,
    paddingTop: 24,
    gap: 8,
  },
  missionSelectorTitle: {
    fontSize: 18,
    paddingHorizontal: 24,
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
    width: '90%',
    // flexDirection: 'row',
    gap: 8,
  },
  missionSelectorItem: {
    height: 120,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  missionSelectorItemGradient: {
    flex: 1,
    padding: 16,
  },
  missionSelectorItemContent: {
    flex: 1,
    // flexDirection: 'row',
    justifyContent: 'space-between',
    // alignItems: 'center',
  },
  missionSelectorItemLeft: {
    flex: 1,
    alignItems: "flex-start",
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
    color: '#FFFFFF',
    marginBottom: 2,
  },
  missionSelectorItemLocation: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#eceff2ff',
  },
  missionSelectorItemRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    justifyContent: "flex-end"
  },
  missionSelectorItemType: {
    fontSize: 10,
    fontFamily: 'Inter-Medium',
    color: '#eceff2ff',
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
