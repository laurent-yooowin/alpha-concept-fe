import React, { useState, useEffect, useCallback } from 'react';
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
  ActivityIndicator,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Camera, FileText, Clock, TrendingUp, Calendar, MapPin, ArrowRight, Shield, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Users, Plus, X, Building, User, MapPin as Location, FileText as Description, CalendarDays, Check, Mail, Phone, Mic, MicOff, Save } from 'lucide-react-native';
import { Search, Filter, Download, ChevronDown, CreditCard as Edit3, Trash2, Eye, Image as ImageIcon } from 'lucide-react-native';

import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { missionService } from '@/services/missionService';
import { userService } from '@/services/userService';
import { visitService } from '@/services/visitService';
import { reportService } from '@/services/reportService';
import { getMissionStatusInfo } from '@/utils/missionHelpers';

const { width } = Dimensions.get('window');

export default function HomeScreen() {

  const [userProfile, setUserProfile] = useState < any > (null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [missionsCount, setMissionsCount] = useState(0);
  const [todayMissions, setTodayMissions] = useState < any > ([]);

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
  const [showEditTimePicker, setShowEditTimePicker] = useState(false);



  useEffect(() => {

    loadUserProfile();
    loadMissions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUserProfile();
    }, [])
  );

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

          return {
            id: mission.id,
            title: mission.title?.toUpperCase() || 'MISSION SANS TITRE',
            client: mission.client || 'Client non renseigné',
            status: mission.status === 'en_cours' ? 'aujourdhui' :
              mission.status === 'terminee' ? 'planifiees' :
                mission.status === 'rejetee_replanifiee' ? 'en_retard' :
                  mission.status === 'planifiee' ? 'planifiees' : 'planifiees',

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

        const todayMissions = backendMissions.filter(m => (new Date(m.date).toLocaleDateString('fr-FR') >= new Date().toLocaleDateString('fr-FR') || !m.date || m.status == 'en_cours'));

        setTodayMissions(todayMissions);
      } else {
        setTodayMissions([]);
      }
    } catch (error) {
      console.log('Erreur lors du chargement des missions:', error);
      setTodayMissions([]);
    }
  };

  const loadUserProfile = async () => {
    try {
      setIsLoadingUser(true);
      const response = await userService.getProfile();
      if (response.data) {
        setUserProfile(response.data);
      }

      const missionsResponse = await missionService.getMissions();
      if (missionsResponse.data) {
        setMissionsCount(missionsResponse.data.length);
      }
    } catch (error) {
      console.log('Erreur lors du chargement du profil:', error);
    } finally {
      setIsLoadingUser(false);
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

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const formatDateForInput = (date: Date) => {
    if (!date) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDisplayDate = (date: Date) => {
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
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
  
  
    const onEditEndDateChange = (event: any, selected?: Date) => {
      setShowEditDatePicker(Platform.OS === 'ios');
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

  // Toutes les missions peuvent maintenant avoir un bouton visite
  const canStartVisit = (status: string) => {
    return status != 'terminée'; // Toutes les missions peuvent démarrer une visite
  };

  // Fonction pour démarrer une visite avec les données de la mission
  const startVisitForMission = (mission: any) => {
    // Encoder les données de la mission pour les passer en paramètres
    const missionData = encodeURIComponent(JSON.stringify({
      id: mission.id,
      title: mission.title,
      client: mission.client,
      location: mission.location,
      description: mission.description,
      nextVisit: mission.nextVisit,
      type: mission.status === 'en_retard' ? 'Visite de rattrapage' :
        mission.status === 'aujourdhui' ? 'Visite programmée' : 'Visite anticipée'
    }));

    router.push(`/visite?mission=${missionData}`);
  };

  // Fonction pour ouvrir la fiche de mission
  const openMissionDetail = async (mission: any) => {
    try {
      const isBackendMission = typeof mission.id === 'string' && mission.id.length > 10;

      if (isBackendMission) {
        // Charger les détails complets depuis le backend        
        const response = await missionService.getMission(mission.id);
        if (response.data) {
          let nextVisit = response.data.date ? `${response.data.date}` : new Date().toISOString();
          nextVisit = response.data.time ? `${nextVisit}T${response.data.time}:00` : nextVisit;
          const fullMission = {
            ...mission,
            ...response.data,
            location: response.data.address || mission.location,
            nextVisit: nextVisit,
            date: response.data.date || (response.data.date ? new Date(response.data.date).toLocaleDateString('fr-FR') : ''),
            time: response.data.time || (response.data.time ? new Date(response.data.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''),
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
            setSelectedDate(visitEndDate);
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

  const openReportDetails = (mission: any) => {
    // Encoder les données de la mission pour les passer en paramètres
    const missionData = encodeURIComponent(JSON.stringify({
      id: mission.id,
      title: mission.title,
      client: mission.client,
      location: mission.location,
      description: mission.description,
      nextVisit: mission.nextVisit,
      type: mission.status === 'en_retard' ? 'Visite de rattrapage' :
        mission.status === 'aujourdhui' ? 'Visite programmée' : 'Visite anticipée'
    }));

    router.push(`/rapports?mission=${missionData}`);
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
          date: editSelectedDate.toISOString().slice(0, 10),
          time: editSelectedTime.toLocaleTimeString(),
          type: editedMission.type,
          status: selectedMission.status === 'aujourdhui' ? 'en_cours' as const :
            selectedMission.status === 'terminee' ? 'terminee' as const :
              'planifiee' as const,
          contactFirstName: editedMission.contactFirstName,
          contactLastName: editedMission.contactLastName,
          contactEmail: editedMission.contactEmail,
          contactPhone: editedMission.contactPhone,
          endDate: editSelectedEndDate.toISOString().slice(0, 10),
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
          setTodayMissions(updatedMissions);
  
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
                
              } catch (error) {
                console.log('Erreur lors de la suppression:', error);
                Alert.alert('Erreur', 'Erreur lors de la suppression de la mission');
              }
            },
          },
        ]
      );
    };

  const missionTypes = [
    'CSPS',
    'AEU',
    'Divers'
  ];



  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Bonjour {isLoadingUser ? '...' : userProfile ? userProfile.firstName : 'Pierre'}
          </Text>
          <Text style={styles.subtitle}>
            {isLoadingUser ? 'Chargement...' : userProfile ?
              (userProfile.role === 'admin' ? 'Administrateur' :
                userProfile.role === 'user' ? 'Coordinateur SPS' :
                  'Coordonnateur SPS') : 'Coordonnateur SPS'}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* New Mission Button */}
        {/* <View style={styles.newMissionSection}>
          <Text style={styles.sectionTitle}>PLANIFICATION</Text>
          <TouchableOpacity 
            style={styles.newMissionButton}
            onPress={() => setShowNewMissionModal(true)}
          >
            <LinearGradient
              colors={['#3B82F6', '#1D4ED8']}
              style={styles.newMissionGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Plus size={24} color="#FFFFFF" />
              <Text style={styles.newMissionTitle}>PROGRAMMER UNE NOUVELLE MISSION</Text>
              <Text style={styles.newMissionSubtitle}>Créer et planifier une mission de contrôle SPS</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View> */}

        {/* Today's Missions */}
        <View style={styles.missionsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MISSIONS D'AUJOURD'HUI</Text>
          </View>

          {todayMissions.length === 0 ? (
            <View style={styles.emptyState}>
              <LinearGradient
                colors={['#1E293B', '#374151']}
                style={styles.emptyStateGradient}
              >
                <Calendar size={48} color="#64748B" />
                <Text style={styles.emptyStateTitle}>AUCUNE MISSION</Text>
              </LinearGradient>
            </View>
          ) : (
            todayMissions.map((mission) => {
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
        </View>       

        {/* Coordinator Info */}
        <View style={styles.coordinatorSection}>
          <LinearGradient
            colors={['#1E293B', '#374151']}
            style={styles.coordinatorGradient}
          >
            {isLoadingUser ? (
              <View style={styles.coordinatorLoadingContainer}>
                <ActivityIndicator size="large" color="#3B82F6" />
                <Text style={styles.coordinatorLoadingText}>Chargement du profil...</Text>
              </View>
            ) : userProfile ? (
              <>
                <View style={styles.coordinatorHeader}>
                  <Shield size={24} color="#3B82F6" />
                  <Text style={styles.coordinatorTitle}>
                    {userProfile.firstName?.toUpperCase()} {userProfile.lastName?.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.coordinatorSubtitle}>
                  {userProfile.role === 'admin' ? 'Administrateur' :
                    userProfile.role === 'coordinator' ? 'Coordinateur SPS Niveau 2' :
                      'Coordonnateur SPS'}
                </Text>
                <Text style={styles.coordinatorCompany}>
                  {userProfile.company || 'Alpha Concept SPS'}
                </Text>

                <View style={styles.coordinatorStats}>
                  <View style={styles.coordinatorStat}>
                    <Text style={styles.coordinatorStatValue}>
                      {userProfile?.experience || 0}
                    </Text>
                    <Text style={styles.coordinatorStatLabel}>ans d'expérience</Text>
                  </View>
                  <View style={styles.coordinatorStat}>
                    <Text style={styles.coordinatorStatValue}>{missionsCount}</Text>
                    <Text style={styles.coordinatorStatLabel}>missions réalisées</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.coordinatorHeader}>
                  <Shield size={24} color="#3B82F6" />
                  <Text style={styles.coordinatorTitle}>PIERRE DUPONT</Text>
                </View>
                <Text style={styles.coordinatorSubtitle}>Coordonnateur SPS Niveau 2</Text>
                <Text style={styles.coordinatorCompany}>Alpha Concept SPS</Text>

                <View style={styles.coordinatorStats}>
                  <View style={styles.coordinatorStat}>
                    <Text style={styles.coordinatorStatValue}>
                      {userProfile?.experience || 0}
                    </Text>
                    <Text style={styles.coordinatorStatLabel}>ans d'expérience</Text>
                  </View>
                  <View style={styles.coordinatorStat}>
                    <Text style={styles.coordinatorStatValue}>{missionsCount}</Text>
                    <Text style={styles.coordinatorStatLabel}>missions réalisées</Text>
                  </View>
                </View>
              </>
            )}
          </LinearGradient>
        </View>

        {/* Mission Detail Modal */}
        <Modal visible={showMissionDetail} animationType="slide" transparent>
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
                    {!isEditing ? (
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
                    )}
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
                              value={editSelectedDate}
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
                            {selectedMission?.nextVisit ? selectedMission.date : 'Non définie'}
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
                              value={editSelectedTime}
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
                            onPress={() => setShowEditDatePicker(true)}
                          >
                            <Calendar size={14} color="#94A3B8" style={styles.dateTimeInputIcon} />
                            <Text style={styles.dateTimeTextInput}>
                              {formatDisplayDate(editSelectedEndDate)}
                            </Text>
                          </TouchableOpacity>
                          {showEditDatePicker && (
                            <DateTimePicker
                              value={editSelectedEndDate}
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
                    </View>
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
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: '#0F172A',
//     paddingTop: 20,
//   },
//   header: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     paddingTop: 16,
//     paddingBottom: 20,
//     backgroundColor: '#0F172A',
//   },

//   content: {
//     flex: 1,
//     paddingHorizontal: 20,
//   },
//   statsSection: {
//     marginBottom: 32,
//   },
//   sectionTitle: {
//     fontSize: 14,
//     fontFamily: 'Inter-SemiBold',
//     color: '#94A3B8',
//     letterSpacing: 1,
//     marginBottom: 16,
//   },
//   newMissionSection: {
//     marginBottom: 32,
//   },
//   newMissionButton: {
//     borderRadius: 20,
//     overflow: 'hidden',
//     shadowColor: '#000',
//     shadowOffset: {
//       width: 0,
//       height: 8,
//     },
//     shadowOpacity: 0.3,
//     shadowRadius: 12,
//     elevation: 12,
//   },
//   newMissionGradient: {
//     padding: 24,
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   newMissionTitle: {
//     fontSize: 16,
//     fontFamily: 'Inter-Bold',
//     color: '#FFFFFF',
//     letterSpacing: 1,
//     marginTop: 12,
//     textAlign: 'center',
//   },
//   newMissionSubtitle: {
//     fontSize: 12,
//     fontFamily: 'Inter-Regular',
//     color: '#FFFFFF',
//     opacity: 0.9,
//     marginTop: 4,
//     textAlign: 'center',
//     lineHeight: 16,
//   },
//   missionsSection: {
//     marginBottom: 32,
//   },
//   sectionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     marginBottom: 16,
//   },
//   missionCard: {
//     height: 120,
//     borderRadius: 16,
//     overflow: 'hidden',
//     marginBottom: 12,
//   },
//   missionGradient: {
//     flex: 1,
//   },
//   missionOverlay: {
//     flex: 1,
//     backgroundColor: 'rgba(0, 0, 0, 0.2)',
//     padding: 16,
//     justifyContent: 'space-between',
//   },
//   missionHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'flex-start',
//   },
//   missionTitle: {
//     fontSize: 14,
//     fontFamily: 'Inter-Bold',
//     color: '#FFFFFF',
//     letterSpacing: 0.5,
//     marginBottom: 2,
//   },
//   missionClient: {
//     fontSize: 12,
//     fontFamily: 'Inter-Regular',
//     color: '#FFFFFF',
//     opacity: 0.9,
//   },
//   missionTime: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: 'rgba(255, 255, 255, 0.2)',
//     paddingHorizontal: 8,
//     paddingVertical: 4,
//     borderRadius: 12,
//     gap: 4,
//   },
//   missionTimeText: {
//     fontSize: 11,
//     fontFamily: 'Inter-Bold',
//     color: '#FFFFFF',
//   },
//   missionFooter: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//   },
//   missionLocation: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     gap: 4,
//   },
//   missionLocationText: {
//     fontSize: 11,
//     fontFamily: 'Inter-Regular',
//     color: '#FFFFFF',
//     opacity: 0.9,
//   },
//   missionType: {
//     fontSize: 11,
//     fontFamily: 'Inter-Medium',
//     color: '#FFFFFF',
//     opacity: 0.8,
//   },

//   // Modal styles
//   modalOverlay: {
//     flex: 1,
//     backgroundColor: 'rgba(0, 0, 0, 0.8)',
//     justifyContent: 'center',
//     alignItems: 'center',
//     paddingVertical: 20,
//   },
//   newMissionModal: {
//     width: '95%',
//     maxWidth: 600,
//     height: '90%',
//     borderRadius: 24,
//     overflow: 'hidden',
//   },
//   newMissionModalGradient: {
//     flex: 1,
//     paddingTop: 24,
//   },
//   modalHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 24,
//     marginBottom: 24,
//   },
//   modalTitle: {
//     fontSize: 20,
//     fontFamily: 'Inter-Bold',
//     color: '#FFFFFF',
//     letterSpacing: 1,
//   },
//   modalCloseButton: {
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     backgroundColor: '#374151',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   modalContent: {
//     flex: 1,
//     paddingHorizontal: 24,
//   },
//   modalScrollContent: {
//     paddingBottom: 20,
//   },
//   inputGroup: {
//     marginBottom: 20,
//   },
//   inputLabel: {
//     fontSize: 12,
//     fontFamily: 'Inter-SemiBold',
//     color: '#94A3B8',
//     letterSpacing: 0.5,
//     marginBottom: 8,
//   },
//   inputContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#374151',
//     borderRadius: 12,
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//   },
//   inputIcon: {
//     marginRight: 12,
//   },
//   textInput: {
//     flex: 1,
//     fontSize: 14,
//     fontFamily: 'Inter-Regular',
//     color: '#FFFFFF',
//   },
//   textArea: {
//     textAlignVertical: 'top',
//     minHeight: 80,
//   },
//   // Nouveaux styles pour la section contact
//   contactSection: {
//     marginBottom: 24,
//     padding: 16,
//     backgroundColor: 'rgba(59, 130, 246, 0.1)',
//     borderRadius: 16,
//     borderWidth: 1,
//     borderColor: 'rgba(59, 130, 246, 0.2)',
//   },
//   contactSectionTitle: {
//     fontSize: 14,
//     fontFamily: 'Inter-Bold',
//     color: '#3B82F6',
//     letterSpacing: 1,
//     marginBottom: 16,
//     textAlign: 'center',
//   },
//   // STYLES CORRIGÉS POUR LES CHAMPS PRÉNOM/NOM
//   nameRow: {
//     flexDirection: 'row',
//     gap: 6, // Gap très réduit
//     marginBottom: 20,
//   },
//   nameFieldContainer: {
//     flex: 1,
//     minWidth: 0, // Important pour éviter le débordement
//   },
//   nameInputContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#374151',
//     borderRadius: 12,
//     paddingHorizontal: 6, // Padding très réduit
//     paddingVertical: 10,
//     minHeight: 44,
//   },
//   nameInputIcon: {
//     marginRight: 6, // Marge très réduite
//     flexShrink: 0, // Empêche l'icône de se rétrécir
//   },
//   nameTextInput: {
//     flex: 1,
//     fontSize: 13, // Taille de police réduite
//     fontFamily: 'Inter-Regular',
//     color: '#FFFFFF',
//     paddingRight: 0,
//     minWidth: 0, // Important pour éviter le débordement
//   },
//   // STYLES CORRIGÉS POUR LES CHAMPS DATE/HEURE
//   dateTimeRow: {
//     flexDirection: 'row',
//     gap: 6, // Gap très réduit
//     marginBottom: 20, // Marge normale après date/heure
//   },
//   dateTimeFieldContainer: {
//     flex: 1,
//     minWidth: 0, // Important pour éviter le débordement
//   },
//   dateTimeInputContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#374151',
//     borderRadius: 12,
//     paddingHorizontal: 6, // Padding très réduit
//     paddingVertical: 10,
//     minHeight: 44,
//   },
//   dateTimeInputIcon: {
//     marginRight: 6, // Marge très réduite
//     flexShrink: 0, // Empêche l'icône de se rétrécir
//   },
//   dateTimeTextInput: {
//     flex: 1,
//     fontSize: 13, // Taille de police réduite
//     fontFamily: 'Inter-Regular',
//     color: '#FFFFFF',
//     paddingRight: 0,
//     minWidth: 0, // Important pour éviter le débordement
//   },
//   webDateInput: {
//     cursor: 'pointer',
//     outlineStyle: 'none',
//   },
//   // NOUVEAU STYLE POUR LE CHAMP DESCRIPTION AVEC ESPACEMENT AUGMENTÉ ET SPEECH-TO-TEXT
//   descriptionInputGroup: {
//     marginBottom: 20,
//     marginTop: 32, // ESPACEMENT AUGMENTÉ AVANT LA DESCRIPTION
//   },
//   descriptionLabelContainer: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     marginBottom: 8,
//   },
//   recordingIndicator: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     gap: 6,
//   },
//   recordingDot: {
//     width: 8,
//     height: 8,
//     borderRadius: 4,
//     backgroundColor: '#EF4444',
//   },
//   recordingText: {
//     fontSize: 11,
//     fontFamily: 'Inter-SemiBold',
//     color: '#EF4444',
//     letterSpacing: 0.5,
//   },
//   descriptionInputContainer: {
//     flexDirection: 'row',
//     alignItems: 'flex-start',
//     backgroundColor: '#374151',
//     borderRadius: 12,
//     paddingHorizontal: 16,
//     paddingVertical: 12,
//     gap: 12,
//   },
//   micButton: {
//     width: 36,
//     height: 36,
//     borderRadius: 18,
//     backgroundColor: '#64748B',
//     alignItems: 'center',
//     justifyContent: 'center',
//     marginTop: 4,
//   },
//   micButtonActive: {
//     backgroundColor: '#EF4444',
//   },
//   speechHint: {
//     fontSize: 11,
//     fontFamily: 'Inter-Regular',
//     color: '#94A3B8',
//     marginTop: 8,
//     textAlign: 'center',
//     fontStyle: 'italic',
//   },
//   typeSelector: {
//     flexDirection: 'row',
//     flexWrap: 'wrap',
//     gap: 8,
//   },
//   typeOption: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     backgroundColor: '#374151',
//     paddingHorizontal: 12,
//     paddingVertical: 8,
//     borderRadius: 20,
//     gap: 6,
//   },
//   typeOptionSelected: {
//     backgroundColor: '#3B82F6',
//   },
//   typeOptionText: {
//     fontSize: 12,
//     fontFamily: 'Inter-Medium',
//     color: '#FFFFFF',
//   },
//   typeOptionTextSelected: {
//     fontFamily: 'Inter-SemiBold',
//   },
//   modalActions: {
//     flexDirection: 'row',
//     paddingHorizontal: 24,
//     paddingVertical: 24,
//     borderTopWidth: 1,
//     borderTopColor: '#374151',
//     gap: 12,
//   },
//   cancelButton: {
//     flex: 1,
//     paddingVertical: 16,
//     borderRadius: 16,
//     backgroundColor: '#374151',
//     alignItems: 'center',
//     justifyContent: 'center',
//   },
//   cancelButtonText: {
//     fontSize: 14,
//     fontFamily: 'Inter-SemiBold',
//     color: '#FFFFFF',
//     letterSpacing: 0.5,
//   },
//   createButton: {
//     flex: 1,
//     borderRadius: 16,
//     overflow: 'hidden',
//   },
//   createButtonGradient: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     justifyContent: 'center',
//     paddingVertical: 16,
//     gap: 6,
//   },
//   createButtonText: {
//     fontSize: 14,
//     fontFamily: 'Inter-SemiBold',
//     color: '#FFFFFF',
//     letterSpacing: 0.5,
//     textAlign: 'center',
//   },
// });

const styles = StyleSheet.create({
  coordinatorSection: {
    marginBottom: 40,
    borderRadius: 16,
    overflow: 'hidden',
  },
  coordinatorGradient: {
    padding: 20,
    alignItems: 'center',
  },
  coordinatorLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  coordinatorLoadingText: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 12,
  },
  coordinatorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  coordinatorTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  coordinatorSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    marginBottom: 4,
  },
  coordinatorCompany: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
    marginBottom: 16,
  },
  coordinatorStats: {
    flexDirection: 'row',
    gap: 32,
  },
  coordinatorStat: {
    alignItems: 'center',
  },
  coordinatorStatValue: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#3B82F6',
    marginBottom: 2,
  },
  coordinatorStatLabel: {
    fontSize: 10,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    textAlign: 'center',
  },
  greeting: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    marginTop: 2,
  },
  missionsSection: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 1,
    marginBottom: 16,
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
    gap: 12,
  },
  cancelButton: {
    flex: 1,
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