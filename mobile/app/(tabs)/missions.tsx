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
  Image,
  Alert,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, Filter, Plus, MapPin, Calendar, Clock, Building, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, ArrowRight, Camera, FileText, Download, ChevronDown, X, User, Mail, Phone, Mic, MicOff, Check, CreditCard as Edit3, Save, Trash2, MapPin as Location, FileText as Description, Eye, Image as ImageIcon } from 'lucide-react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getMissionStatusInfo } from '@/utils/missionHelpers';
import { visitService } from '@/services/visitService';
import { reportService } from '@/services/reportService';
import { missionService } from '@/services/missionService';
import { userService } from '@/services/userService';

const { width } = Dimensions.get('window');

export default function MissionsScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('toutes');
  const [userMissions, setUserMissions] = useState < any[] > ([]);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showMissionDetail, setShowMissionDetail] = useState(false);
  const [selectedMission, setSelectedMission] = useState < any > (null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedMission, setEditedMission] = useState < any > (null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreatingMission, setIsCreatingMission] = useState(false);
  const [selectedDate, setSelectedDate] = useState();
  const [selectedTime, setSelectedTime] = useState();
  const [selectedEndDate, setSelectedEndDate] = useState();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [editSelectedDate, setEditSelectedDate] = useState();
  const [editSelectedTime, setEditSelectedTime] = useState();
  const [editSelectedEndDate, setEditSelectedEndDate] = useState();
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [showEditEndDatePicker, setShowEditEndDatePicker] = useState(false);
  const [showEditTimePicker, setShowEditTimePicker] = useState(false);
  const [filteredMissions, setFilteredMissions] = useState([]);
  const [newMission, setNewMission] = useState({
    title: '',
    client: '',
    location: '',
    description: '',
    date: '',
    time: '',
    endDate: '',
    type: 'CSPS',
    contactFirstName: '',
    contactLastName: '',
    contactEmail: '',
    contactPhone: '',
    refBusiness: '',
    refClient: '',
  });

  // État pour la reconnaissance vocale
  const [isRecordingDescription, setIsRecordingDescription] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState < any > (null);

  // État pour le modal de détails de visite
  const [showVisitDetailModal, setShowVisitDetailModal] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState < any > (null);
  const [photos, setPhotos] = useState < any > (null);
  const [selectedReport, setSelectedReport] = useState < any > (null);
  const [showEditReportModal, setShowEditReportModal] = useState(false);
  const [editedReportHeader, setEditedReportHeader] = useState('');
  const [editedReportContent, setEditedReportContent] = useState('');
  const [editedReportFooter, setEditedReportFooter] = useState('');
  const [isSavingReport, setIsSavingReport] = useState(false);

  const filters = [
    { id: 'toutes', label: 'Toutes les missions', count: 15, color: '#8B5CF6', icon: FileText },
    { id: 'aujourdhui', label: 'Missions d\'aujourd\'hui', count: 3, color: '#3B82F6', icon: Clock },
    { id: 'en_retard', label: 'Missions en retard', count: 2, color: '#EF4444', icon: AlertTriangle },
    { id: 'planifiees', label: 'Missions planifiées', count: 10, color: '#10B981', icon: Calendar },
  ];

  const missionTypes = [
    'CSPS',
    'AEU',
    'Divers'
  ];
  const [missions, setMissions] = useState < any[] > ([]);

  // Initialize date and time for new mission
  // Charger les missions depuis le backend
  useEffect(() => {
    const today = new Date();
    // setSelectedDate(today);
    // setSelectedTime(today);
    // setEditSelectedTime(today);
    setNewMission(prev => ({
      ...prev,
      date: formatDateForInput(today),
      endDate: formatDateForInput(today),
      time: formatTime(today)
    }));

    loadMissions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMissions();
    }, [])
  );

  const formatDateForInput = (date: Date) => {
    if (!date) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatTime = (date: Date) => {
    if (!date) return null;
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
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

  const onTimeChange = (event: any, selected?: Date) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selected) {
      setSelectedTime(selected);
      setNewMission(prev => ({ ...prev, time: formatTime(selected) }));
    }
  };

  const onDateChange = (event: any, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) {
      setSelectedDate(selected);
      setNewMission(prev => ({ ...prev, date: formatDateForInput(selected) }));
    }
  };

  const onEditDateChange = (event: any, selected?: Date) => {
    setShowEditDatePicker(Platform.OS === 'ios');
    if (selected) {
      setEditSelectedDate(selected);
      setEditedMission((prev: any) => ({
        ...prev,
        date: formatDateForInput(selected)
      }));
    }
  };

  const onEndDateChange = (event: any, selected?: Date) => {
    setShowEndDatePicker(Platform.OS === 'ios');
    if (selected) {
      setSelectedEndDate(selected);
      setNewMission(prev => ({ ...prev, endDate: formatDateForInput(selected) }));
    }
  };

  const onEditEndDateChange = (event: any, selected?: Date) => {
    setShowEditEndDatePicker(Platform.OS === 'ios');
    if (selected) {
      setEditSelectedEndDate(selected);
      setEditedMission((prev: any) => ({
        ...prev,
        endDate: formatDateForInput(selected)
      }));
    }
  };

  const onEditTimeChange = (event: any, selected?: Date) => {
    setShowEditTimePicker(Platform.OS === 'ios');
    if (selected) {
      setEditSelectedTime(selected);
      setEditedMission((prev: any) => ({
        ...prev,
        time: formatTime(selected)
      }));
    }
  };

  const loadMissions = async () => {
    try {
      const response = await missionService.getMissions();
      const visitsResponse = await visitService.getVisits();
      const reportsResponse = await reportService.getReports();

      if (response.data && Array.isArray(response.data)) {
        // console.log('response.data IDs:', response.data.map(m => m.id));
        const backendMissions = response.data.map((mission: any) => {
          const missionStatusInfo = getMissionStatusInfo(mission.status);
          let hasVisit = false;
          let visitId = null;
          let reportId = null;

          try {
            if (visitsResponse.data) {
              const missionVisit = visitsResponse.data.find((v: any) => v.missionId === mission.id);
              if (missionVisit) {
                hasVisit = true;
                visitId = missionVisit.id;
                if (reportsResponse.data) {
                  const visitReport = reportsResponse.data.find((r: any) => r.visitId === visitId);
                  if (visitReport) {
                    reportId = visitReport.id;
                  }
                }
              }
            }
          } catch (error) {
            console.log('Error checking visit/report for mission:', mission.id, error);
          }

          let nextVisit = mission.date ? `${mission.date}` : new Date().toISOString();
          nextVisit = mission.time ? `${nextVisit}T${mission.time}:00` : nextVisit;

          return {
            id: mission.id,
            title: mission.title?.toUpperCase() || 'MISSION SANS TITRE',
            client: mission.client || 'Client non renseigné',
            status: mission.status === 'en_cours' ? 'aujourdhui' :
              mission.status === 'terminee' ? 'planifiees' :
                mission.status === 'rejetee_replanifiee' ? 'en_retard' :
                  mission.status === 'planifiee' ? 'planifiees' : 'planifiees',
            nextVisit: nextVisit,
            date: mission.date,
            time: mission.time,
            endDate: mission.endDate || (mission.endDate ? new Date(mission.endDate).toLocaleDateString('fr-FR') : ''),
            refBusiness: mission.refBusiness || '',
            refClient: mission.refClient || '',
            location: mission.address || 'Localisation non renseignée',
            description: mission.description || '',
            alerts: mission.status === 'rejetee_replanifiee' ? 1 : 0,
            completion: mission.status == 'terminee' ? 100 : (hasVisit ? 50 : 0),
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
            hasVisit,
            visitId,
            reportId
          };
        });

        setMissions(backendMissions);
        setUserMissions(backendMissions);
        filtermissions(backendMissions, 'toutes');
      } else {
        setMissions([]);
      }
    } catch (error) {
      console.log('Erreur lors du chargement des missions:', error);
      setMissions([]);
    }
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'aujourdhui':
        return { label: 'Aujourd\'hui', color: '#3B82F6', icon: Clock };
      case 'en_retard':
        return { label: 'En retard', color: '#EF4444', icon: AlertTriangle };
      case 'planifiees':
        return { label: 'Planifiée', color: '#10B981', icon: Calendar };
      default:
        return { label: 'Terminée', color: '#10B981', icon: CheckCircle };
    }
  };

  const formatDate = (dateString: any) => {
    if (!dateString) return ""
    const today = new Date();
    let date;
    if (dateString instanceof Date) {
      date = dateString;
    } else {
      date = new Date(dateString);
    }

    if (date.toDateString() === today.toDateString()) {
      return `Aujourd'hui ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (date < today) {
      const daysDiff = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      return `Retard ${daysDiff} jour${daysDiff > 1 ? 's' : ''}`;
    } else {
      return date.toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  // Calculer les compteurs dynamiquement
  const getCounts = () => {
    const counts = {
      toutes: missions.length,
      aujourdhui: missions.filter(m => m.status === 'aujourdhui' || m.date && (new Date(m.date).toLocaleDateString('fr-FR') == new Date().toLocaleDateString('fr-FR'))).length,
      en_retard: missions.filter(m => m.status === 'en_retard' || m.date && (new Date(m.date).toLocaleDateString('fr-FR') > new Date().toLocaleDateString('fr-FR'))).length,
      planifiees: missions.filter(m => m.status === 'planifiees').length,
    };
    return counts;
  };

  const dynamicCounts = getCounts();

  // Mettre à jour les filtres avec les compteurs dynamiques
  const updatedFilters = filters.map(filter => ({
    ...filter,
    count: dynamicCounts[filter.id as keyof typeof dynamicCounts] || 0
  }));

  const filtermissions = (missionsParam, filterId) => {
    const data = missionsParam && missionsParam.length > 0 ? missionsParam : missions;
    const filterItem = filterId ? filterId : activeFilter;
    const filtred = data.filter(mission => {
      const matchesSearch = mission.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mission.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mission.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mission.refClient.toLowerCase().includes(searchQuery.toLowerCase()) ||
        mission.refBusiness.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesAllFilter = filterItem === 'toutes';
      // || mission.status === activeFilter;
      let matchesFilter = false;
      switch (filterItem) {
        case "aujourdhui":
          matchesFilter = mission.date && new Date(mission.date).toLocaleDateString() == new Date().toLocaleDateString() || mission.status == "aujourdhui";
          break;
        case "en_retard":
          matchesFilter = mission.date && new Date(mission.date).toLocaleDateString() > new Date().toLocaleDateString() || mission.status == "en_retard";
          break;
        case "planifiees":
          matchesFilter = mission.status == "planifiees";
          break;

        default:
          break;
      }

      return matchesSearch && matchesFilter || matchesAllFilter;
    });
    setFilteredMissions(prev => filtred);
  }

  // Fonction pour démarrer une visite avec les données de la mission
  const startVisitForMission = (mission: any) => {
    console.log('startVisitForMission >>>: ', mission);
    // Encoder les données de la mission pour les passer en paramètres
    const missionData = encodeURIComponent(JSON.stringify({
      ...mission,
      id: mission.id,
      title: mission.title,
      client: mission.client,
      location: mission.location,
      description: mission.description,
      nextVisit: mission.nextVisit,
      type: mission.status,
      contact: {
        firstName: mission.contactFirstName || '',
        lastName: mission.contactLastName || '',
        email: mission.contactEmail || '',
        phone: mission.contactPhone || ''
      }
    }));

    router.push(`/visite?mission=${missionData}`);
  };

  const openReportDetails = (mission: any) => {
    console.log('openReportDetails >>>: ', mission);
    // Encoder les données de la mission pour les passer en paramètres
    const missionData = encodeURIComponent(JSON.stringify({
      ...mission,
      id: mission.id,
      title: mission.title,
      client: mission.client,
      location: mission.location,
      description: mission.description,
      nextVisit: mission.nextVisit,
      type: mission.status
    }));

    router.push(`/rapports?mission=${missionData}`);
  };

  // Toutes les missions peuvent maintenant avoir un bouton visite
  const canStartVisit = (status: string) => {
    return status != 'terminée'; // Toutes les missions peuvent démarrer une visite
  };

  // Fonction pour ouvrir les détails de visite
  const openVisitDetails = async (mission: any) => {
    try {
      if (!mission.visitId) {
        Alert.alert('Erreur', 'Aucune visite trouvée pour cette mission.');
        return;
      }

      const visitResponse = await visitService.getVisit(mission.visitId);
      if (visitResponse.data) {
        const loadedPhotos: Photo[] = visitResponse.data?.photos.map((photo: any) => {
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
            userComments: photo.comment || '',
            validated: photo.validated || true,
          };
        });

        setPhotos(loadedPhotos);

        setSelectedVisit(visitResponse.data);

        if (mission.reportId) {
          const reportResponse = await reportService.getReport(mission.reportId);
          if (reportResponse.data) {
            setSelectedReport(reportResponse.data);
          }
        }

        setShowVisitDetailModal(true);
      }
    } catch (error) {
      console.error('Error loading visit details:', error);
      Alert.alert('Erreur', 'Impossible de charger les détails de la visite.');
    }
  };

  // Fonction pour modifier le rapport
  const handleModifyReport = () => {
    if (selectedReport) {
      setEditedReportHeader(selectedReport.header || '');
      setEditedReportContent(selectedReport.content || '');
      setEditedReportFooter(selectedReport.footer || '');
      setShowEditReportModal(true);
    }
  };

  // Fonction pour sauvegarder les modifications du rapport
  const handleSaveReportModifications = async () => {
    if (!selectedReport) return;

    try {
      setIsSavingReport(true);
      await reportService.updateReport(selectedReport.id, {
        header: editedReportHeader,
        content: editedReportContent,
        footer: editedReportFooter,
      });

      if (selectedVisit) {
        try {
          const visitResponse = await visitService.getVisit(selectedVisit.id);
          if (visitResponse.data && visitResponse.data.photos) {
            const updatedPhotos = visitResponse.data.photos.map((photo: any, index: number) => {
              const photoSectionRegex = new RegExp(
                `Photo ${index + 1}[\\s\\S]*?(?=Photo ${index + 2}|$)`,
                'i'
              );
              const photoSection = editedReportContent.match(photoSectionRegex)?.[0] || '';

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

            await visitService.updateVisit(selectedVisit.id, {
              photos: updatedPhotos,
              notes: visitNotes,
            });
          }
        } catch (visitError) {
          console.log('Note: Could not update related visit:', visitError);
        }
      }

      Alert.alert('Succès', 'Le rapport a été modifié avec succès.');
      setShowEditReportModal(false);

      const reportResponse = await reportService.getReport(selectedReport.id);
      if (reportResponse.data) {
        setSelectedReport(reportResponse.data);
      }

      loadMissions();
    } catch (error) {
      console.error('Error updating report:', error);
      Alert.alert('Erreur', 'Impossible de modifier le rapport.');
    } finally {
      setIsSavingReport(false);
    }
  };

  const activeFilterData = updatedFilters.find(f => f.id === activeFilter);
  const ActiveFilterIcon = activeFilterData?.icon || FileText;

  const handleFilterSelect = (filterId: string) => {
    setActiveFilter(filterId);
    setShowFilterMenu(false);
    // console.log("filterId >>> : ", filterId);
    filtermissions(missions, filterId);
  };

  // Fonction pour ouvrir la fiche de mission
  const openMissionDetail = async (mission: any) => {
    try {
      setEditSelectedDate(null);
      setSelectedDate(null);
      setEditSelectedTime(null);
      setSelectedTime(null);
      setEditSelectedEndDate(null);
      setSelectedEndDate(null);
      const isBackendMission = typeof mission.id === 'string' && mission.id.length > 10;

      if (isBackendMission) {
        // Charger les détails complets depuis le backend        
        const response = await missionService.getMission(mission.id);
        let nextVisit = response.data.date ? `${response.data.date}` : new Date().toISOString();
        nextVisit = response.data.time ? `${nextVisit}T${response.data.time}:00` : nextVisit;
        if (response.data) {
          const fullMission = {
            ...mission,
            ...response.data,
            location: response.data.address || mission.location,
            nextVisit: nextVisit,
            date: response.data.date,
            time: response.data.time,
            endDate: response.data.endDate || (response.data.endDate ? new Date(response.data.endDate).toLocaleDateString('fr-FR') : ''),
            refBusiness: response.data.refBusiness || '',
            refClient: response.data.refClient || '',
            type: response.data.type || mission.type,
            contact: {
              firstName: response.data.contactFirstName || '',
              lastName: response.data.contactLastName || '',
              email: response.data.contactEmail || '',
              phone: response.data.contactPhone || ''
            }
          };
          setSelectedMission(fullMission);
          setEditedMission({
            ...fullMission,
            contactFirstName: response.data.contactFirstName || '',
            contactLastName: response.data.contactLastName || '',
            contactEmail: response.data.contactEmail || '',
            contactPhone: response.data.contactPhone || ''
          });

          // Initialize date/time pickers for edit mode
          if (fullMission.date) {
            const visitDate = new Date(fullMission.date);
            setEditSelectedDate(visitDate);
            setSelectedDate(visitDate);

            if (fullMission.time) {
              const [hours, minutes] = fullMission.time.split(":").map(Number);
              const visitTime = new Date(visitDate.getFullYear(), visitDate.getMonth(), visitDate.getDay(), hours, minutes, 0);
              setEditSelectedTime(visitTime);
              setSelectedTime(visitTime);
            }
          }


          // Initialize date/time pickers for edit mode
          if (fullMission.endDate) {
            const visitEndDate = new Date(fullMission.endDate);
            setEditSelectedEndDate(visitEndDate);
            setSelectedEndDate(visitEndDate);
          }
          console.log("selectedDate >>>: ", selectedDate)
          console.log("selectedTime >>>: ", selectedTime)
          console.log("selectedEndDate >>>: ", selectedEndDate)
        }
      } else {
        setSelectedMission(mission);
        setEditedMission({
          ...mission,
          contactFirstName: mission.contact?.firstName || '',
          contactLastName: mission.contact?.lastName || '',
          contactEmail: mission.contact?.email || '',
          contactPhone: mission.contact?.phone || ''
        });

        // Initialize date/time pickers for edit mode
        if (mission.date) {
          const visitDate = new Date(mission.date);
          const visitTime = new Date(mission.time);
          setEditSelectedDate(visitDate);
          setSelectedDate(visitDate);

          if (mission.time) {
            const [hours, minutes] = mission.time.split(":").map(Number);
            const visitTime = new Date(visitDate.getFullYear(), visitDate.getMonth(), visitDate.getDay(), hours, minutes, 0);
            setEditSelectedTime(visitTime);
            setSelectedTime(visitTime);
          }
        }

        // Initialize date/time pickers for edit mode
        if (mission.endDate) {
          const visitEndDate = new Date(mission.endDate);
          setEditSelectedEndDate(visitEndDate);
          setSelectedDate(visitEndDate);
        }
      }

      setShowMissionDetail(true);
      setIsEditing(false);
    } catch (error) {
      console.log('Erreur lors du chargement de la mission:', error);
      Alert.alert('Erreur', 'Impossible de charger les détails de la mission');
    }
  };

  // Fonction pour démarrer l'enregistrement vocal
  const startRecording = () => {
    if (typeof window !== 'undefined' && 'webkitSpeechRecognition' in window) {
      const recognition = new (window as any).webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'fr-FR';

      recognition.onstart = () => {
        setIsRecordingDescription(true);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setEditedMission((prev: any) => ({
            ...prev,
            description: prev.description + finalTranscript
          }));
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Erreur de reconnaissance vocale:', event.error);
        setIsRecordingDescription(false);
        Alert.alert('Erreur', 'Erreur lors de la reconnaissance vocale. Veuillez réessayer.');
      };

      recognition.onend = () => {
        setIsRecordingDescription(false);
      };

      recognition.start();
      setSpeechRecognition(recognition);
    } else {
      Alert.alert(
        'Fonction non disponible',
        'La reconnaissance vocale n\'est pas disponible sur ce navigateur. Veuillez utiliser Chrome ou Safari.'
      );
    }
  };

  // Fonction pour arrêter l'enregistrement vocal
  const stopRecording = () => {
    if (speechRecognition) {
      speechRecognition.stop();
      setSpeechRecognition(null);
    }
    setIsRecordingDescription(false);
  };

  // Fonction pour basculer l'enregistrement
  const toggleRecording = () => {
    if (isRecordingDescription) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Fonction pour sauvegarder les modifications
  const handleSaveMission = async () => {
    // Validation des champs obligatoires
    if (!editedMission.title.trim()) {
      Alert.alert('Erreur', 'Le titre de la mission est obligatoire');
      return;
    }
    if (!editedMission.client.trim()) {
      Alert.alert('Erreur', 'Le nom du client est obligatoire');
      return;
    }
    if (!editedMission.location.trim()) {
      Alert.alert('Erreur', 'L\'adresse est obligatoire');
      return;
    }
    if (!editedMission.date.trim()) {
      Alert.alert('Erreur', 'La date est obligatoire');
      return;
    }
    // if (!editedMission.time.trim()) {
    //   Alert.alert('Erreur', 'L\'heure est obligatoire');
    //   return;
    // }
    if (!editedMission.contactEmail.trim()) {
      Alert.alert('Erreur', 'L\'email du contact est obligatoire');
      return;
    }

    // Validation de l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(editedMission.contactEmail)) {
      Alert.alert('Erreur', 'Veuillez saisir un email valide');
      return;
    }

    try {
      const isBackendMission = typeof selectedMission.id === 'string' && selectedMission.id.length > 10;

      // if (isBackendMission) {
      // Utiliser l'API pour mettre à jour une mission backend
      const { missionService } = await import('@/services/missionService');

      const updateData = {
        title: editedMission.title,
        client: editedMission.client,
        address: editedMission.location,
        description: editedMission.description,
        date: editSelectedDate?.toISOString().slice(0, 10),
        time: editSelectedTime?.toLocaleTimeString(),
        type: editedMission.type,
        status: selectedMission.status === 'aujourdhui' ? 'en_cours' as const :
          selectedMission.status === 'terminee' ? 'terminee' as const :
            'planifiee' as const,
        contactFirstName: editedMission.contactFirstName,
        contactLastName: editedMission.contactLastName,
        contactEmail: editedMission.contactEmail,
        contactPhone: editedMission.contactPhone,
        endDate: editSelectedEndDate?.toISOString().slice(0, 10),
        refBusiness: editedMission.refBusiness,
        refClient: editedMission.refClient,
      };

      const response = await missionService.updateMission(selectedMission.id, updateData);

      if (response.data) {
        Alert.alert('Succès', 'La mission a été mise à jour avec succès');
        setIsEditing(false);
        loadMissions();
        setShowMissionDetail(false);
      } else if (response.error) {
        Alert.alert('Erreur', response.error);
      }
      // } else {
      if (!isBackendMission) {
        // Mettre à jour localement pour les missions mock
        const updatedMission = {
          ...selectedMission,
          title: editedMission.title.toUpperCase(),
          client: editedMission.client,
          location: editedMission.location,
          description: editedMission.description,
          nextVisit: `${editedMission.date}T${editedMission.time}:00`,
          type: editedMission.type,
          contact: {
            firstName: editedMission.contactFirstName,
            lastName: editedMission.contactLastName,
            email: editedMission.contactEmail,
            phone: editedMission.contactPhone
          }
        };

        const updatedMissions = missions.map(mission =>
          mission.id === selectedMission.id ? updatedMission : mission
        );
        setMissions(updatedMissions);

        setSelectedMission(updatedMission);
        setIsEditing(false);
        Alert.alert('Succès', 'La mission a été mise à jour avec succès');
      }
    } catch (error) {
      console.log('Erreur lors de la sauvegarde:', error);
      Alert.alert('Erreur', 'Erreur lors de la sauvegarde de la mission');
    }
  };

  const handleCancelEdit = () => {
    setEditedMission({
      ...selectedMission,
      // date: selectedMission.nextVisit ? new Date(selectedMission.nextVisit).toLocaleDateString('fr-FR') : '',
      // time: selectedMission.nextVisit ? new Date(selectedMission.nextVisit).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
      contactFirstName: selectedMission.contact?.firstName || '',
      contactLastName: selectedMission.contact?.lastName || '',
      contactEmail: selectedMission.contact?.email || '',
      contactPhone: selectedMission.contact?.phone || ''
    });
    setIsEditing(false);
    // Arrêter l'enregistrement si en cours
    if (isRecordingDescription) {
      stopRecording();
    }
  };

  // Fonction pour supprimer une mission
  const handleDeleteMission = async () => {
    Alert.alert(
      'Supprimer la mission',
      'Êtes-vous sûr de vouloir supprimer cette mission ? Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              const isBackendMission = typeof selectedMission.id === 'string' && selectedMission.id.length > 10;

              if (isBackendMission) {
                // Supprimer via l'API
                const { missionService } = await import('@/services/missionService');
                const response = await missionService.deleteMission(selectedMission.id);

                if (response.error) {
                  Alert.alert('Erreur', response.error);
                  return;
                }

                Alert.alert('Succès', 'La mission a été supprimée avec succès');
                setShowMissionDetail(false);
                loadMissions();
              } else {
                // Supprimer localement pour les missions mock
                const updatedMissions = missions.filter(m => m.id !== selectedMission.id);
                setMissions(updatedMissions);
                Alert.alert('Succès', 'La mission a été supprimée avec succès');
                setShowMissionDetail(false);
              }
            } catch (error) {
              console.log('Erreur lors de la suppression:', error);
              Alert.alert('Erreur', 'Erreur lors de la suppression de la mission');
            }
          },
        },
      ]
    );
  };

  const resetForm = () => {
    setNewMission({
      title: '',
      client: '',
      location: '',
      description: '',
      date: '',
      time: '',
      type: 'CSPS',
      contactFirstName: '',
      contactLastName: '',
      contactEmail: '',
      contactPhone: '',
      endDate: '',
      refBusiness: '',
      refClient: '',
    });
    if (isRecordingDescription) {
      stopRecording();
    }
  };

  const handleCancelButton = () => {
    const hasData = Object.values(newMission).some(value =>
      value.trim() !== '' && value !== 'CSPS'
    );

    if (hasData) {
      Alert.alert(
        'Annuler la création',
        'Êtes-vous sûr de vouloir annuler ? Les informations saisies seront perdues.',
        [
          { text: 'Continuer', style: 'cancel' },
          {
            text: 'Annuler',
            style: 'destructive',
            onPress: () => {
              setShowCreateModal(false);
              resetForm();
            }
          }
        ]
      );
    } else {
      setShowCreateModal(false);
      resetForm();
    }
  };

  const handleCreateMission = async () => {
    if (!newMission.title.trim()) {
      Alert.alert('Erreur', 'Le titre de la mission est obligatoire');
      return;
    }
    if (!newMission.client.trim()) {
      Alert.alert('Erreur', 'Le nom du client est obligatoire');
      return;
    }
    if (!newMission.location.trim()) {
      Alert.alert('Erreur', 'L\'adresse est obligatoire');
      return;
    }
    if (!newMission.date.trim()) {
      Alert.alert('Erreur', 'La date est obligatoire');
      return;
    }
    // if (!newMission.time.trim()) {
    //   Alert.alert('Erreur', 'L\'heure est obligatoire');
    //   return;
    // }
    if (!newMission.contactEmail.trim()) {
      Alert.alert('Erreur', 'L\'email du contact est obligatoire');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newMission.contactEmail)) {
      Alert.alert('Erreur', 'Veuillez saisir un email valide');
      return;
    }

    setIsCreatingMission(true);

    try {
      const { missionService } = await import('@/services/missionService');

      const missionData = {
        title: newMission.title,
        client: newMission.client,
        address: newMission.location,
        date: new Date(newMission.date).toISOString().slice(0, 10),
        time: newMission.time,
        type: newMission.type,
        description: newMission.description,
        status: 'en_cours' as const,
        contactFirstName: newMission.contactFirstName,
        contactLastName: newMission.contactLastName,
        contactEmail: newMission.contactEmail,
        contactPhone: newMission.contactPhone,
        endDate: new Date(newMission.endDate).toISOString().slice(0, 10),
        refBusiness: newMission.refBusiness,
        refClient: newMission.refClient,
      };

      await missionService.createMission(missionData);

      setShowCreateModal(false);
      resetForm();

      Alert.alert(
        'Mission créée !',
        `La mission "${newMission.title}" a été programmée avec succès pour le ${newMission.date} à ${newMission.time}.\n\nContact: ${newMission.contactFirstName} ${newMission.contactLastName}\nEmail: ${newMission.contactEmail}`,
        [
          {
            text: 'OK',
            onPress: () => {
              loadMissions();
            }
          }
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Erreur',
        error.message || 'Impossible de créer la mission. Veuillez réessayer.'
      );
    } finally {
      setIsCreatingMission(false);
    }
  };

  const getDefaultTime = (): Date => {
    const now = new Date();
    const [hours, minutes] = now.toLocaleTimeString().split(":").map(Number);
    return new Date(now.getFullYear(), now.getMonth(), now.getDay(), hours, minutes, 0);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']} >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MES MISSIONS</Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Search size={20} color="#64748B" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une mission..."
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
                <View style={styles.filterDropdownTextContainer}>
                  <Text style={styles.filterDropdownText} numberOfLines={1}>{activeFilterData?.label}</Text>
                  <Text style={styles.filterDropdownCount}>{filteredMissions.length} mission{filteredMissions.length > 1 ? 's' : ''}</Text>
                </View>
              </View>
              <ChevronDown size={20} color="#FFFFFF" />
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Missions List */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {filteredMissions.length === 0 ? (
          <View style={styles.emptyState}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.emptyStateGradient}
            >
              <Calendar size={48} color="#64748B" />
              <Text style={styles.emptyStateTitle}>AUCUNE MISSION</Text>
              <Text style={styles.emptyStateText}>
                {activeFilter === 'toutes'
                  ? 'Aucune mission ne correspond à votre recherche'
                  : `Aucune mission ${activeFilter === 'aujourdhui' ? 'prévue aujourd\'hui' :
                    activeFilter === 'en_retard' ? 'en retard' :
                      activeFilter === 'planifiees' ? 'planifiée' : ''
                  }`
                }
              </Text>
            </LinearGradient>
          </View>
        ) : (
          filteredMissions.map((mission) => {
            const statusInfo = getStatusInfo(mission.status);
            const StatusIcon = statusInfo.icon;
            const showVisitButton = canStartVisit(mission.status);

            return (
              <TouchableOpacity
                key={mission.id}
                style={styles.missionCard}
                onPress={() => openMissionDetail(mission)}
              >
                <LinearGradient
                  colors={mission.gradient}
                  style={styles.missionGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={styles.missionOverlay}>
                    {/* Header */}
                    <View style={styles.missionHeader}>
                      <View style={styles.missionTitleContainer}>
                        <Text style={styles.missionTitle}>{mission.title}</Text>
                        <View style={styles.clientContainer}>
                          <Building size={10} color="#FFFFFF" />
                          <Text style={styles.missionClient}>{mission.client}</Text>
                        </View>
                      </View>

                      <View style={styles.missionHeaderRight}>
                        {mission.alerts > 0 && (
                          <View style={styles.alertBadge}>
                            <AlertTriangle size={10} color="#FFFFFF" />
                            <Text style={styles.alertBadgeText}>{mission.alerts}</Text>
                          </View>
                        )}
                        {mission.originalStatus == 'terminee' ? (
                          <TouchableOpacity
                            style={styles.visitButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              openReportDetails(mission);
                            }}
                          >
                            <LinearGradient
                              colors={['#10B981', '#059669']}
                              style={styles.visitButtonGradient}
                            >
                              <Eye size={14} color="#FFFFFF" />
                              <Text style={[styles.visitButtonText, { color: '#FFFFFF' }]}>Rapport</Text>
                            </LinearGradient>
                          </TouchableOpacity>
                        ) : showVisitButton ? (
                          <TouchableOpacity
                            style={styles.visitButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              startVisitForMission(mission);
                            }}
                          >
                            <LinearGradient
                              colors={['#FFFFFF', '#F8FAFC']}
                              style={styles.visitButtonGradient}
                            >
                              <Camera size={14} color="#1E293B" />
                              <Text style={styles.visitButtonText}>Visite</Text>
                            </LinearGradient>
                          </TouchableOpacity>
                        ) : (
                          <ArrowRight size={16} color="#FFFFFF" />
                        )}
                      </View>
                    </View>

                    {/* Description */}
                    <Text style={styles.missionDescription}>{mission.description}</Text>

                    {/* Progress */}
                    <View style={styles.progressSection}>
                      <View style={styles.progressHeader}>
                        <Text style={styles.progressLabel}>AVANCEMENT</Text>
                        <Text style={styles.progressValue}>{mission.completion}%</Text>
                      </View>
                      <View style={styles.progressBar}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${mission.completion}%` }
                          ]}
                        />
                      </View>
                    </View>

                    {/* Footer */}
                    <View style={styles.missionFooter}>
                      <View style={styles.missionDetails}>
                        <View style={styles.detailRow}>
                          <MapPin size={12} color="#FFFFFF" />
                          <Text style={styles.detailText}>{mission.location}</Text>
                        </View>

                        <View style={styles.detailRow}>
                          <Calendar size={12} color="#FFFFFF" />
                          <Text style={styles.detailText}>{formatDate(mission.date)}</Text>
                        </View>
                      </View>

                      <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '40' }]}>
                        <StatusIcon size={10} color="#FFFFFF" />
                        <Text style={styles.statusText}>{statusInfo.label}</Text>
                      </View>
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Mission Detail Modal */}
      <Modal visible={showMissionDetail} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.missionDetailModal}>
              <LinearGradient
                colors={['#1E293B', '#374151']}
                style={styles.missionDetailModalGradient}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {isEditing ? 'MODIFIER LA MISSION' : 'FICHE DE MISSION'}
                  </Text>
                  <View style={styles.modalHeaderButtons}>
                    {selectedMission?.status != 'terminee' && (!isEditing ? (
                      <>
                        <TouchableOpacity
                          style={styles.editButton}
                          onPress={() => setIsEditing(true)}
                        >
                          <Edit3 size={18} color="#FFFFFF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deleteButton}
                          onPress={() => handleDeleteMission()}
                        >
                          <Trash2 size={18} color="#FFFFFF" />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={styles.saveButton}
                        onPress={handleSaveMission}
                      >
                        <Save size={18} color="#FFFFFF" />
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={styles.modalCloseButton}
                      onPress={() => {
                        if (isEditing) {
                          handleCancelEdit();
                        } else {
                          setShowMissionDetail(false);
                        }
                      }}
                    >
                      <X size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                </View>

                <ScrollView
                  style={styles.modalContent}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.modalScrollContent}
                >
                  {/* Titre de la mission */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>TITRE DE LA MISSION *</Text>
                    <View style={styles.inputContainer}>
                      <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                      {isEditing ? (
                        <TextInput
                          style={styles.textInput}
                          placeholder="Ex: Résidence Les Jardins"
                          placeholderTextColor="#64748B"
                          value={editedMission?.title || ''}
                          onChangeText={(text) => setEditedMission(prev => ({ ...prev, title: text }))}
                        />
                      ) : (
                        <Text style={styles.displayText}>{selectedMission?.title}</Text>
                      )}
                    </View>
                  </View>

                  {/* Client */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>CLIENT / ENTREPRISE *</Text>
                    <View style={styles.inputContainer}>
                      <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                      {isEditing ? (
                        <TextInput
                          style={styles.textInput}
                          placeholder="Ex: Bouygues Construction"
                          placeholderTextColor="#64748B"
                          value={editedMission?.client || ''}
                          onChangeText={(text) => setEditedMission(prev => ({ ...prev, client: text }))}
                        />
                      ) : (
                        <Text style={styles.displayText}>{selectedMission?.client}</Text>
                      )}
                    </View>
                  </View>

                  {/* Contact du client */}
                  <View style={styles.contactSection}>
                    <Text style={styles.contactSectionTitle}>CONTACT CLIENT</Text>

                    {/* Prénom et Nom */}
                    <View style={styles.nameRow}>
                      <View style={styles.nameFieldContainer}>
                        <Text style={styles.inputLabel}>PRÉNOM</Text>
                        <View style={styles.nameInputContainer}>
                          <User size={14} color="#94A3B8" style={styles.nameInputIcon} />
                          {isEditing ? (
                            <TextInput
                              style={styles.nameTextInput}
                              placeholder="Prénom"
                              placeholderTextColor="#64748B"
                              value={editedMission?.contactFirstName || ''}
                              onChangeText={(text) => setEditedMission(prev => ({ ...prev, contactFirstName: text }))}
                            />
                          ) : (
                            <Text style={styles.nameDisplayText}>{selectedMission?.contact?.firstName || 'Non renseigné'}</Text>
                          )}
                        </View>
                      </View>

                      <View style={styles.nameFieldContainer}>
                        <Text style={styles.inputLabel}>NOM</Text>
                        <View style={styles.nameInputContainer}>
                          <User size={14} color="#94A3B8" style={styles.nameInputIcon} />
                          {isEditing ? (
                            <TextInput
                              style={styles.nameTextInput}
                              placeholder="Nom"
                              placeholderTextColor="#64748B"
                              value={editedMission?.contactLastName || ''}
                              onChangeText={(text) => setEditedMission(prev => ({ ...prev, contactLastName: text }))}
                            />
                          ) : (
                            <Text style={styles.nameDisplayText}>{selectedMission?.contact?.lastName || 'Non renseigné'}</Text>
                          )}
                        </View>
                      </View>
                    </View>

                    {/* Email */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>EMAIL *</Text>
                      <View style={styles.inputContainer}>
                        <Mail size={16} color="#94A3B8" style={styles.inputIcon} />
                        {isEditing ? (
                          <TextInput
                            style={styles.textInput}
                            placeholder="contact@entreprise.com"
                            placeholderTextColor="#64748B"
                            value={editedMission?.contactEmail || ''}
                            onChangeText={(text) => setEditedMission(prev => ({ ...prev, contactEmail: text }))}
                            keyboardType="email-address"
                            autoCapitalize="none"
                          />
                        ) : (
                          <Text style={styles.displayText}>{selectedMission?.contact?.email || 'Non renseigné'}</Text>
                        )}
                      </View>
                    </View>

                    {/* Téléphone */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>TÉLÉPHONE</Text>
                      <View style={styles.inputContainer}>
                        <Phone size={16} color="#94A3B8" style={styles.inputIcon} />
                        {isEditing ? (
                          <TextInput
                            style={styles.textInput}
                            placeholder="06 12 34 56 78"
                            placeholderTextColor="#64748B"
                            value={editedMission?.contactPhone || ''}
                            onChangeText={(text) => setEditedMission(prev => ({ ...prev, contactPhone: text }))}
                            keyboardType="phone-pad"
                          />
                        ) : (
                          <Text style={styles.displayText}>{selectedMission?.contact?.phone || 'Non renseigné'}</Text>
                        )}
                      </View>
                    </View>

                    {/* Référence client */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Référence client</Text>
                      <View style={styles.inputContainer}>
                        <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                        {isEditing ? (
                          <TextInput
                            style={styles.textInput}
                            placeholder="Ex: B-2079854"
                            placeholderTextColor="#64748B"
                            value={editedMission.refClient}
                            onChangeText={(text) => setEditedMission(prev => ({ ...prev, refClient: text }))}
                          />
                        ) : (
                          <Text style={styles.displayText}>{selectedMission?.refClient || 'Non renseigné'}</Text>
                        )}
                      </View>
                    </View>
                  </View>

                  {/* Adresse */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>ADRESSE DU CHANTIER *</Text>
                    <View style={styles.inputContainer}>
                      <MapPin size={16} color="#94A3B8" style={styles.inputIcon} />
                      {isEditing ? (
                        <TextInput
                          style={styles.textInput}
                          placeholder="Ex: 123 Rue de la République, Lyon 69003"
                          placeholderTextColor="#64748B"
                          value={editedMission?.location || ''}
                          onChangeText={(text) => setEditedMission(prev => ({ ...prev, location: text }))}
                        />
                      ) : (
                        <Text style={styles.displayText}>{selectedMission?.location}</Text>
                      )}
                    </View>
                  </View>

                  {/* Type de mission */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>TYPE DE MISSION</Text>
                    {isEditing ? (
                      <View style={styles.typeSelector}>
                        {missionTypes.map((type, index) => (
                          <TouchableOpacity
                            key={index}
                            style={[
                              styles.typeOption,
                              editedMission?.type === type && styles.typeOptionSelected
                            ]}
                            onPress={() => setEditedMission(prev => ({ ...prev, type }))}
                          >
                            <Text style={[
                              styles.typeOptionText,
                              editedMission?.type === type && styles.typeOptionTextSelected
                            ]}>
                              {type}
                            </Text>
                            {editedMission?.type === type && (
                              <Check size={14} color="#FFFFFF" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : (
                      <View style={styles.inputContainer}>
                        <FileText size={16} color="#94A3B8" style={styles.inputIcon} />
                        <Text style={styles.displayText}>{selectedMission?.type || 'Non défini'}</Text>
                      </View>
                    )}
                  </View>

                  {/* Date et heure */}
                  <View style={styles.dateTimeRow}>
                    <View style={styles.dateTimeFieldContainer}>
                      <Text style={styles.inputLabel}>Date de début *</Text>
                      {isEditing ? (
                        <>
                          <TouchableOpacity
                            style={styles.dateTimeInputContainer}
                            onPress={() => setShowEditDatePicker(true)}
                          >
                            <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                            <Text style={styles.dateTimeTextInput}>
                              {formatDisplayDate(editSelectedDate)}
                            </Text>
                          </TouchableOpacity>
                          {showEditDatePicker && (
                            <DateTimePicker
                              value={editSelectedDate || new Date()}
                              mode="date"
                              display="default"
                              onChange={onEditDateChange}
                            />
                          )}
                        </>
                      ) : (
                        <View style={styles.dateTimeInputContainer}>
                          <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                          <Text style={styles.dateTimeDisplayText}>
                            {selectedMission?.date ? selectedMission.date : 'Non définie'}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.dateTimeFieldContainer}>
                      <Text style={styles.inputLabel}>Heure de début</Text>
                      {isEditing ? (
                        <>
                          <TouchableOpacity
                            style={styles.dateTimeInputContainer}
                            onPress={() => setShowEditTimePicker(true)}
                          >
                            <Clock size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                            <Text style={styles.dateTimeTextInput}>
                              {formatTime(editSelectedTime)}
                            </Text>
                          </TouchableOpacity>
                          {showEditTimePicker && (
                            <DateTimePicker
                              value={editSelectedTime || getDefaultTime()}
                              mode="time"
                              display="default"
                              onChange={onEditTimeChange}
                              is24Hour={true}
                            />
                          )}
                        </>
                      ) : (
                        <View style={styles.dateTimeInputContainer}>
                          <Clock size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                          <Text style={styles.dateTimeDisplayText}>
                            {selectedMission?.time ? selectedMission.time : 'Non définie'}
                          </Text>
                        </View>
                      )}
                    </View>

                  </View>

                  {/* Date de fin et ref business */}
                  <View style={styles.dateTimeRow}>
                    <View style={styles.dateTimeFieldContainer}>
                      <Text style={styles.inputLabel}>Date de fin</Text>
                      {isEditing ? (
                        <>
                          <TouchableOpacity
                            style={styles.dateTimeInputContainer}
                            onPress={() => setShowEditEndDatePicker(true)}
                          >
                            <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                            <Text style={styles.dateTimeTextInput}>
                              {formatDisplayDate(editSelectedEndDate)}
                            </Text>
                          </TouchableOpacity>
                          {showEditEndDatePicker && (
                            <DateTimePicker
                              value={editSelectedEndDate || new Date()}
                              mode="date"
                              display="default"
                              onChange={onEditEndDateChange}
                            />
                          )}
                        </>
                      ) : (
                        <View style={styles.dateTimeInputContainer}>
                          <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                          <Text style={styles.dateTimeDisplayText}>
                            {selectedMission?.endDate ? selectedMission.endDate : 'Non définie'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Référence affaire */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Référence affaire</Text>
                    <View style={styles.inputRefContainer}>
                      <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                      {isEditing ? (
                        <TextInput
                          style={styles.textInput}
                          placeholder="Ex: 2078569"
                          placeholderTextColor="#64748B"
                          value={editedMission?.refBusiness || ''}
                          onChangeText={(text) => setEditedMission(prev => ({ ...prev, refBusiness: text }))}
                        />
                      ) : (
                        <Text style={styles.displayText}>{selectedMission?.refBusiness}</Text>
                      )}
                    </View>
                  </View>

                  {/* Description */}
                  <View style={styles.descriptionInputGroup}>
                    <View style={styles.descriptionLabelContainer}>
                      <Text style={styles.inputLabel}>DESCRIPTION</Text>
                      {isEditing && isRecordingDescription && (
                        <View style={styles.recordingIndicator}>
                          <View style={styles.recordingDot} />
                          <Text style={styles.recordingText}>Enregistrement...</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.descriptionInputContainer}>
                      <FileText size={16} color="#94A3B8" style={styles.inputIcon} />
                      {isEditing ? (
                        <TextInput
                          style={[styles.textInput, styles.textArea]}
                          placeholder="Détails sur la mission, points particuliers à vérifier..."
                          placeholderTextColor="#64748B"
                          value={editedMission?.description || ''}
                          onChangeText={(text) => setEditedMission(prev => ({ ...prev, description: text }))}
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                      ) : (
                        <Text style={[styles.displayText, styles.descriptionDisplayText]}>
                          {selectedMission?.description || 'Aucune description'}
                        </Text>
                      )}
                      {/* {isEditing && (
                        <TouchableOpacity
                          style={[
                            styles.micButton,
                            isRecordingDescription && styles.micButtonActive
                          ]}
                          onPress={toggleRecording}
                        >
                          {isRecordingDescription ? (
                            <MicOff size={18} color="#FFFFFF" />
                          ) : (
                            <Mic size={18} color="#FFFFFF" />
                          )}
                        </TouchableOpacity>
                      )} */}
                    </View>
                    {/* {isEditing && isRecordingDescription && (
                      <Text style={styles.speechHint}>
                        Parlez maintenant... Appuyez à nouveau sur le micro pour arrêter.
                      </Text>
                    )} */}
                  </View>
                </ScrollView>

                {/* Actions */}
                {isEditing && (
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={handleCancelEdit}
                    >
                      <Text style={styles.cancelButtonText}>ANNULER</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.saveButtonAction}
                      onPress={handleSaveMission}
                    >
                      <LinearGradient
                        colors={['#10B981', '#059669']}
                        style={styles.saveButtonGradient}
                      >
                        <Save size={16} color="#FFFFFF" />
                        <Text style={styles.saveButtonText}>SAUVEGARDER</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                )}
              </LinearGradient>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
            style={styles.filterModalOverlay}
            activeOpacity={1}
            onPress={() => setShowFilterMenu(false)}
          >
            <View style={styles.filterMenu}>
              <LinearGradient
                colors={['#1E293B', '#374151']}
                style={styles.filterMenuGradient}
              >
                <View style={styles.filterMenuHeader}>
                  <Text style={styles.filterMenuTitle}>FILTRER LES MISSIONS</Text>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => setShowFilterMenu(false)}
                  >
                    <X size={20} color="#FFFFFF" />
                  </TouchableOpacity>
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
                          colors={[filter.color, filter.color + 'CC']}
                          style={styles.filterMenuItemGradient}
                        >
                          <View style={styles.filterMenuItemContent}>
                            <View style={styles.filterMenuItemLeft}>
                              <View style={styles.filterMenuIcon}>
                                <FilterIcon size={18} color="#FFFFFF" />
                              </View>
                              <View style={styles.filterMenuTextContainer}>
                                <Text style={styles.filterMenuItemTextActive} numberOfLines={1}>{filter.label}</Text>
                                <Text style={styles.filterMenuItemSubtextActive}>{filter.count} mission{filter.count > 1 ? 's' : ''}</Text>
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
                            <View style={[styles.filterMenuIcon, { backgroundColor: '#374151' }]}>
                              <FilterIcon size={18} color="#94A3B8" />
                            </View>
                            <View style={styles.filterMenuTextContainer}>
                              <Text style={styles.filterMenuItemText} numberOfLines={1}>{filter.label}</Text>
                              <Text style={styles.filterMenuItemSubtext}>{filter.count} mission{filter.count > 1 ? 's' : ''}</Text>
                            </View>
                          </View>
                          <View style={styles.filterMenuBadge}>
                            <Text style={styles.filterMenuBadgeText}>{filter.count}</Text>
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

      {/* FAB Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => {
          const today = new Date()
          setSelectedDate(today);
          setSelectedTime(new Date(today.getFullYear(), today.getMonth(), today.getDay(), today.getHours(), today.getMinutes(), 0));
          setSelectedEndDate(new Date(today.getFullYear(), today.getMonth() + 1), today.getDay() + 1);
          setShowCreateModal(true);
        }}
      >
        <LinearGradient
          colors={['#10B981', '#059669']}
          style={styles.fabGradient}
        >
          <Plus size={24} color="#FFFFFF" />
        </LinearGradient>
      </TouchableOpacity>

      {/* Create Mission Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.missionDetailModal}>
              <LinearGradient
                colors={['#1E293B', '#374151']}
                style={styles.missionDetailModalGradient}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>NOUVELLE MISSION</Text>
                  <TouchableOpacity
                    style={styles.modalCloseButton}
                    onPress={handleCancelButton}
                  >
                    <X size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.modalContent}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.modalScrollContent}
                >
                  {/* Titre de la mission */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>TITRE DE LA MISSION *</Text>
                    <View style={styles.inputContainer}>
                      <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInput}
                        placeholder="Ex: Résidence Les Jardins"
                        placeholderTextColor="#64748B"
                        value={newMission.title}
                        onChangeText={(text) => setNewMission(prev => ({ ...prev, title: text }))}
                      />
                    </View>
                  </View>

                  {/* Client */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>CLIENT / ENTREPRISE *</Text>
                    <View style={styles.inputContainer}>
                      <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInput}
                        placeholder="Ex: Bouygues Construction"
                        placeholderTextColor="#64748B"
                        value={newMission.client}
                        onChangeText={(text) => setNewMission(prev => ({ ...prev, client: text }))}
                      />
                    </View>
                  </View>

                  {/* Contact du client */}
                  <View style={styles.contactSection}>
                    <Text style={styles.contactSectionTitle}>CONTACT CLIENT</Text>

                    {/* Prénom et Nom */}
                    <View style={styles.nameRow}>
                      <View style={styles.nameFieldContainer}>
                        <Text style={styles.inputLabel}>PRÉNOM</Text>
                        <View style={styles.nameInputContainer}>
                          <User size={14} color="#94A3B8" style={styles.nameInputIcon} />
                          <TextInput
                            style={styles.nameTextInput}
                            placeholder="Prénom"
                            placeholderTextColor="#64748B"
                            value={newMission.contactFirstName}
                            onChangeText={(text) => setNewMission(prev => ({ ...prev, contactFirstName: text }))}
                          />
                        </View>
                      </View>

                      <View style={styles.nameFieldContainer}>
                        <Text style={styles.inputLabel}>NOM</Text>
                        <View style={styles.nameInputContainer}>
                          <User size={14} color="#94A3B8" style={styles.nameInputIcon} />
                          <TextInput
                            style={styles.nameTextInput}
                            placeholder="Nom"
                            placeholderTextColor="#64748B"
                            value={newMission.contactLastName}
                            onChangeText={(text) => setNewMission(prev => ({ ...prev, contactLastName: text }))}
                          />
                        </View>
                      </View>
                    </View>

                    {/* Email */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>EMAIL *</Text>
                      <View style={styles.inputContainer}>
                        <Mail size={16} color="#94A3B8" style={styles.inputIcon} />
                        <TextInput
                          style={styles.textInput}
                          placeholder="contact@entreprise.com"
                          placeholderTextColor="#64748B"
                          value={newMission.contactEmail}
                          onChangeText={(text) => setNewMission(prev => ({ ...prev, contactEmail: text }))}
                          keyboardType="email-address"
                          autoCapitalize="none"
                        />
                      </View>
                    </View>

                    {/* Téléphone */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>TÉLÉPHONE</Text>
                      <View style={styles.inputContainer}>
                        <Phone size={16} color="#94A3B8" style={styles.inputIcon} />
                        <TextInput
                          style={styles.textInput}
                          placeholder="06 12 34 56 78"
                          placeholderTextColor="#64748B"
                          value={newMission.contactPhone}
                          onChangeText={(text) => setNewMission(prev => ({ ...prev, contactPhone: text }))}
                          keyboardType="phone-pad"
                        />
                      </View>
                    </View>

                    {/* Référence client */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Référence client</Text>
                      <View style={styles.inputContainer}>
                        <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                        <TextInput
                          style={styles.textInput}
                          placeholder="Ex: 2079854"
                          placeholderTextColor="#64748B"
                          value={newMission.refClient}
                          onChangeText={(text) => setNewMission(prev => ({ ...prev, refClient: text }))}
                        />
                      </View>
                    </View>
                  </View>

                  {/* Adresse */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>ADRESSE DU CHANTIER *</Text>
                    <View style={styles.inputContainer}>
                      <Location size={16} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInput}
                        placeholder="Ex: 123 Rue de la République, Lyon 69003"
                        placeholderTextColor="#64748B"
                        value={newMission.location}
                        onChangeText={(text) => setNewMission(prev => ({ ...prev, location: text }))}
                      />
                    </View>
                  </View>

                  {/* Type de mission */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>TYPE DE MISSION</Text>
                    <View style={styles.typeSelector}>
                      {missionTypes.map((type, index) => (
                        <TouchableOpacity
                          key={index}
                          style={[
                            styles.typeOption,
                            newMission.type === type && styles.typeOptionSelected
                          ]}
                          onPress={() => setNewMission(prev => ({ ...prev, type }))}
                        >
                          <Text style={[
                            styles.typeOptionText,
                            newMission.type === type && styles.typeOptionTextSelected
                          ]}>
                            {type}
                          </Text>
                          {newMission.type === type && (
                            <Check size={14} color="#FFFFFF" />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Date et heure */}
                  <View style={styles.dateTimeRow}>
                    <View style={styles.dateTimeFieldContainer}>
                      <Text style={styles.inputLabel}>Date de début *</Text>
                      {Platform.OS === 'web' ? (
                        <View style={styles.dateTimeInputContainer}>
                          <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                          <TextInput
                            style={[styles.dateTimeTextInput, styles.webDateInput]}
                            type="date"
                            value={newMission.date}
                            onChange={(e: any) => {
                              const dateValue = e.target.value || e.nativeEvent.text;
                              const newDate = new Date(dateValue);
                              setSelectedDate(newDate);
                              setNewMission(prev => ({ ...prev, date: dateValue }));
                            }}
                            placeholderTextColor="#94A3B8"
                          />
                        </View>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.dateTimeInputContainer}
                            onPress={() => setShowDatePicker(true)}
                          >
                            <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                            <Text style={styles.dateTimeTextInput}>
                              {formatDisplayDate(selectedDate)}
                            </Text>
                          </TouchableOpacity>
                          {showDatePicker && (
                            <DateTimePicker
                              value={selectedDate}
                              mode="date"
                              display="default"
                              onChange={onDateChange}
                            />
                          )}
                        </>
                      )}
                    </View>

                    <View style={styles.dateTimeFieldContainer}>
                      <Text style={styles.inputLabel}>Heure de début</Text>
                      {Platform.OS === 'web' ? (
                        <View style={styles.dateTimeInputContainer}>
                          <Clock size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                          <TextInput
                            style={[styles.dateTimeTextInput, styles.webDateInput]}
                            type="time"
                            value={newMission.time}
                            onChange={(e: any) => {
                              const timeValue = e.target.value || e.nativeEvent.text;
                              setNewMission(prev => ({ ...prev, time: timeValue }));
                            }}
                            placeholderTextColor="#94A3B8"
                          />
                        </View>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.dateTimeInputContainer}
                            onPress={() => setShowTimePicker(true)}
                          >
                            <Clock size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                            <Text style={styles.dateTimeTextInput}>
                              {formatTime(selectedTime)}
                            </Text>
                          </TouchableOpacity>
                          {showTimePicker && (
                            <DateTimePicker
                              value={selectedTime}
                              mode="time"
                              display="default"
                              onChange={onTimeChange}
                              is24Hour={true}
                            />
                          )}
                        </>
                      )}
                    </View>
                  </View>


                  {/* Date de fin et ref affaire */}
                  <View style={styles.dateTimeFieldContainer}>
                    <View style={styles.dateTimeFieldContainer}>
                      <Text style={styles.inputLabel}>Date de fin</Text>
                      {Platform.OS === 'web' ? (
                        <View style={styles.dateTimeInputContainer}>
                          <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                          <TextInput
                            style={[styles.dateTimeTextInput, styles.webDateInput]}
                            type="date"
                            value={newMission.endDate}
                            onChange={(e: any) => {
                              const dateValue = e.target.value || e.nativeEvent.text;
                              const newDate = new Date(dateValue);
                              setSelectedEndDate(newDate);
                              setNewMission(prev => ({ ...prev, endDate: dateValue }));
                            }}
                            placeholderTextColor="#94A3B8"
                          />
                        </View>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.dateTimeInputContainer}
                            onPress={() => setShowEndDatePicker(true)}
                          >
                            <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                            <Text style={styles.dateTimeTextInput}>
                              {formatDisplayDate(selectedEndDate)}
                            </Text>
                          </TouchableOpacity>
                          {showEndDatePicker && (
                            <DateTimePicker
                              value={selectedEndDate}
                              mode="date"
                              display="default"
                              onChange={onEndDateChange}
                            />
                          )}
                        </>
                      )}
                    </View>
                  </View>

                  {/* Référence affaire    */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Référence affaire</Text>
                    <View style={styles.inputRefContainer}>
                      <Building size={16} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInput}
                        placeholder="Ex: 2079854"
                        placeholderTextColor="#64748B"
                        value={newMission.refBusiness}
                        onChangeText={(text) => setNewMission(prev => ({ ...prev, refBusiness: text }))}
                      />
                    </View>
                  </View>


                  {/* Description */}
                  <View style={styles.descriptionInputGroup}>
                    <View style={styles.descriptionLabelContainer}>
                      <Text style={styles.inputLabel}>DESCRIPTION (OPTIONNEL)</Text>
                      {isRecordingDescription && (
                        <View style={styles.recordingIndicator}>
                          <View style={styles.recordingDot} />
                          <Text style={styles.recordingText}>Enregistrement...</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.descriptionInputContainer}>
                      <Description size={16} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={[styles.textInput, styles.textArea]}
                        placeholder="Détails sur la mission, points particuliers à vérifier..."
                        placeholderTextColor="#64748B"
                        value={newMission.description}
                        onChangeText={(text) => setNewMission(prev => ({ ...prev, description: text }))}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                      />
                      {/* <TouchableOpacity
                        style={[
                          styles.micButton,
                          isRecordingDescription && styles.micButtonActive
                        ]}
                        onPress={toggleRecording}
                      >
                        {isRecordingDescription ? (
                          <MicOff size={18} color="#FFFFFF" />
                        ) : (
                          <Mic size={18} color="#FFFFFF" />
                        )}
                      </TouchableOpacity> */}
                    </View>
                    {isRecordingDescription && false && (
                      <Text style={styles.speechHint}>
                        Parlez maintenant... Appuyez à nouveau sur le micro pour arrêter.
                      </Text>
                    )}
                  </View>
                </ScrollView>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={handleCancelButton}
                  >
                    <Text style={styles.cancelButtonText}>ANNULER</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.saveButtonAction}
                    onPress={handleCreateMission}
                    disabled={isCreatingMission}
                  >
                    <LinearGradient
                      colors={['#10B981', '#059669']}
                      style={styles.saveButtonGradient}
                    >
                      {isCreatingMission ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <>
                          <Plus size={16} color="#FFFFFF" />
                          <Text style={styles.saveButtonText}>CRÉER LA MISSION</Text>
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Visit Detail Modal */}
      <Modal visible={showVisitDetailModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.visitDetailModal}>
              {selectedVisit && selectedReport && (
                <>
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.visitDetailHeader}
                  >
                    <View style={styles.visitDetailHeaderContent}>
                      <View style={styles.visitDetailHeaderLeft}>
                        <FileText size={24} color="#FFFFFF" />
                        <View>
                          <Text style={styles.visitDetailTitle}>Détails du Rapport</Text>
                          <Text style={styles.visitDetailSubtitle}>
                            {new Date(selectedVisit.visitDate).toLocaleDateString('fr-FR')}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={styles.closeButton}
                        onPress={() => {
                          setShowVisitDetailModal(false);
                          setSelectedVisit(null);
                          setPhotos(null);
                          setSelectedReport(null);
                        }}
                      >
                        <X size={24} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>

                  <ScrollView style={styles.visitDetailContent} showsVerticalScrollIndicator={false}>
                    <View style={styles.visitDetailSection}>
                      <Text style={styles.visitDetailSectionTitle}>CONTENU DU RAPPORT</Text>
                      <View style={styles.visitDetailContentBox}>
                        <Text style={styles.visitDetailContentText}>
                          {selectedReport.header || 'Aucun contenu disponible'}
                        </Text>
                      </View>
                    </View>

                    {photos && photos.length > 0 && (
                      <View style={styles.visitDetailSection}>
                        <View style={styles.reportPhotoSeparator} />
                        {photos.map((photo: any, index: number) => (
                          <View key={index} style={styles.photoItem}>
                            <View style={styles.photoPlaceholder}>
                              <Image
                                source={{ uri: photo.s3Url }}
                                style={styles.detailPhotoImage}
                                resizeMode="cover"
                              />
                              <Text style={styles.photoIndexText}>Photo {index + 1}</Text>
                            </View>
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
                        ))}
                      </View>
                    )}

                    {selectedVisit.notes && (
                      <View style={styles.visitDetailSection}>
                        <Text style={styles.visitDetailSectionTitle}>NOTES</Text>
                        <View style={styles.visitDetailContentBox}>
                          <Text style={styles.visitDetailContentText}>
                            {selectedVisit.notes}
                          </Text>
                        </View>
                      </View>
                    )}
                  </ScrollView>

                  {selectedReport.status !== 'valide' && (
                    <View style={styles.visitDetailActions}>
                      <TouchableOpacity
                        style={styles.modifyReportButton}
                        onPress={handleModifyReport}
                      >
                        <LinearGradient
                          colors={['#F59E0B', '#D97706']}
                          style={styles.modifyReportGradient}
                        >
                          <Edit3 size={20} color="#FFFFFF" />
                          <Text style={styles.modifyReportText}>Modifier le rapport</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Report Modal */}
      <Modal visible={showEditReportModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.visitDetailModal}>
              <LinearGradient
                colors={['#F59E0B', '#D97706']}
                style={styles.visitDetailHeader}
              >
                <View style={styles.visitDetailHeaderContent}>
                  <View style={styles.visitDetailHeaderLeft}>
                    <Edit3 size={24} color="#FFFFFF" />
                    <View>
                      <Text style={styles.visitDetailTitle}>Modifier le Rapport</Text>
                      <Text style={styles.visitDetailSubtitle}>
                        {selectedReport?.title || 'Rapport'}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => setShowEditReportModal(false)}
                  >
                    <X size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              </LinearGradient>

              <ScrollView style={styles.editReportContent}>
                <Text style={styles.editReportLabel}>En-tête du rapport</Text>
                <TextInput
                  style={styles.editReportTextInput}
                  value={editedReportHeader}
                  onChangeText={setEditedReportHeader}
                  multiline
                  numberOfLines={5}
                  placeholder="Saisissez l'en-tête du rapport..."
                  placeholderTextColor="#64748B"
                />

                <Text style={styles.editReportLabel}>Observations (Contenu principal)</Text>
                <TextInput
                  style={styles.editReportTextInput}
                  value={editedReportContent}
                  onChangeText={setEditedReportContent}
                  multiline
                  numberOfLines={10}
                  placeholder="Saisissez les observations du rapport..."
                  placeholderTextColor="#64748B"
                />

                <Text style={styles.editReportLabel}>Conclusion</Text>
                <TextInput
                  style={styles.editReportTextInput}
                  value={editedReportFooter}
                  onChangeText={setEditedReportFooter}
                  multiline
                  numberOfLines={5}
                  placeholder="Saisissez la conclusion du rapport..."
                  placeholderTextColor="#64748B"
                />

                <TouchableOpacity
                  style={styles.saveReportButton}
                  onPress={handleSaveReportModifications}
                  disabled={isSavingReport}
                >
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.saveReportGradient}
                  >
                    {isSavingReport ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Save size={20} color="#FFFFFF" />
                        <Text style={styles.saveReportText}>Enregistrer</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
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
    flex: 1,
    minWidth: 0,
  },
  filterDropdownIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  filterDropdownTextContainer: {
    flex: 1,
    minWidth: 0,
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
  missionCard: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  missionGradient: {
    flex: 1,
  },
  missionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: 16,
    justifyContent: 'space-between',
  },
  missionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  missionTitleContainer: {
    flex: 1,
  },
  missionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  clientContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  missionClient: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
  },
  missionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.8)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    gap: 2,
  },
  alertBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
  visitButton: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  visitButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  visitButtonText: {
    fontSize: 10,
    fontFamily: 'Inter-Bold',
    color: '#1E293B',
    letterSpacing: 0.5,
  },
  missionDescription: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
    lineHeight: 16,
  },
  progressSection: {
    marginVertical: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    opacity: 0.9,
  },
  progressValue: {
    fontSize: 11,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  progressBar: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  missionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  missionDetails: {
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
  // Mission Detail Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  missionDetailModal: {
    width: '95%',
    maxWidth: 600,
    height: '90%',
    borderRadius: 24,
    overflow: 'hidden',
  },
  missionDetailModalGradient: {
    flex: 1,
    paddingTop: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    flex: 1,
  },
  modalHeaderButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  modalScrollContent: {
    paddingBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  inputRefContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 45,
  },
  inputIcon: {
    marginRight: 12,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
  },
  displayText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
  },
  textArea: {
    textAlignVertical: 'top',
    minHeight: 80,
  },
  descriptionDisplayText: {
    minHeight: 60,
    textAlignVertical: 'top',
    paddingTop: 4,
  },
  // Contact section styles
  contactSection: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  contactSectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#3B82F6',
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
  },
  nameFieldContainer: {
    flex: 1,
    minWidth: 0,
  },
  nameInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 10,
    minHeight: 44,
  },
  nameInputIcon: {
    marginRight: 6,
    flexShrink: 0,
  },
  nameTextInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    paddingRight: 0,
    minWidth: 0,
  },
  nameDisplayText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    paddingRight: 0,
    minWidth: 0,
  },
  // Date/Time styles
  dateTimeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
  },
  dateTimeFieldContainer: {
    flex: 1,
    minWidth: 0,
  },
  dateTimeInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 10,
    minHeight: 45,
  },
  dateTimeInputIcon: {
    marginRight: 6,
    flexShrink: 0,
  },
  dateTimeTextInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    paddingRight: 0,
    minWidth: 0,
  },
  dateTimeDisplayText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    paddingRight: 0,
    minWidth: 0,
  },
  // Description with speech-to-text
  descriptionInputGroup: {
    marginBottom: 20,
    marginTop: 20,
  },
  descriptionLabelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  recordingText: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  descriptionInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  micButtonActive: {
    backgroundColor: '#EF4444',
  },
  speechHint: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  // Type selector
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  typeOptionSelected: {
    backgroundColor: '#3B82F6',
  },
  typeOptionText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#FFFFFF',
  },
  typeOptionTextSelected: {
    fontFamily: 'Inter-SemiBold',
  },
  // Modal actions
  modalActions: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: '#374151',
    gap: 6,
  },
  cancelButton: {
    flex: 0.6,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  saveButtonAction: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  saveButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  saveButtonText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  // Filter modal styles
  filterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  filterMenu: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
  },
  filterMenuGradient: {
    padding: 20,
  },
  filterMenuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  filterMenuTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterMenuItem: {
    backgroundColor: '#374151',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  filterMenuItemActive: {
    backgroundColor: 'transparent',
  },
  filterMenuItemGradient: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  filterMenuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  filterMenuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  filterMenuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  filterMenuTextContainer: {
    flex: 1,
    minWidth: 0,
  },
  filterMenuItemText: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  filterMenuItemTextActive: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  filterMenuItemSubtext: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
  },
  filterMenuItemSubtextActive: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.8,
  },
  filterMenuBadge: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 32,
    alignItems: 'center',
    flexShrink: 0,
  },
  filterMenuBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 32,
    alignItems: 'center',
    flexShrink: 0,
  },
  filterMenuBadgeText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
  },
  filterMenuBadgeTextActive: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webDateInput: {
    color: '#FFFFFF',
  },
  visitDetailModal: {
    width: width * 0.95,
    height: '90%',
    backgroundColor: '#1E293B',
    borderRadius: 24,
    overflow: 'hidden',
  },
  visitDetailHeader: {
    padding: 20,
  },
  visitDetailHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  visitDetailHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 12,
  },
  visitDetailTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  visitDetailSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  visitDetailContent: {
    flex: 1,
  },
  visitDetailSection: {
    padding: 20,
  },
  reportPhotoSeparator: {
    height: 2,
    backgroundColor: '#475569',
    marginTop: 16,
    borderRadius: 1,
  },
  visitDetailSectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    marginBottom: 12,
    letterSpacing: 1,
  },
  visitDetailContentBox: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    minHeight: 100,
  },
  visitDetailContentText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#E2E8F0',
    lineHeight: 22,
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
  reportCommentText: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#A5B4FC',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  reportListItem: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#E5E7EB',
    lineHeight: 18,
    marginBottom: 4,
  },
  photoItem: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#1E293B',
    borderRadius: 8,
  },
  detailPhotoImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 20,
  },
  photoIndexText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    marginTop: 8,
  },
  photoComment: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    marginTop: 12,
    lineHeight: 18,
  },
  visitDetailActions: {
    padding: 16,
    backgroundColor: '#0F172A',
  },
  modifyReportButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  modifyReportGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  modifyReportText: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  editReportContent: {
    flex: 1,
    padding: 20,
  },
  editReportLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    marginTop: 16,
    marginBottom: 12,
    letterSpacing: 1,
  },
  editReportTextInput: {
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
  saveReportButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  saveReportGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  saveReportText: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
});