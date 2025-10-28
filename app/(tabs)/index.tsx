import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  ActivityIndicator,
  Platform
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Camera, FileText, Clock, TrendingUp, Calendar, MapPin, ArrowRight, Shield, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Users, Plus, X, Building, User, MapPin as Location, FileText as Description, CalendarDays, Check, Mail, Phone, Mic, MicOff } from 'lucide-react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { missionService } from '@/services/missionService';
import { userService } from '@/services/userService';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const [showNewMissionModal, setShowNewMissionModal] = useState(false);
  const [isCreatingMission, setIsCreatingMission] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [missionsCount, setMissionsCount] = useState(0);
  const [newMission, setNewMission] = useState({
    title: '',
    client: '',
    location: '',
    description: '',
    date: '',
    time: '',
    type: 'Visite de contrôle',
    contactFirstName: '',
    contactLastName: '',
    contactEmail: '',
    contactPhone: ''
  });

  const [isRecordingDescription, setIsRecordingDescription] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState<any>(null);

  useEffect(() => {
    const today = new Date();
    setSelectedDate(today);
    setSelectedTime(today);
    setNewMission(prev => ({
      ...prev,
      date: formatDate(today),
      time: formatTime(today)
    }));
  }, []);

  useEffect(() => {
    loadUserProfile();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUserProfile();
    }, [])
  );

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

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const formatDisplayDate = (date: Date) => {
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const onDateChange = (event: any, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) {
      setSelectedDate(selected);
      setNewMission(prev => ({ ...prev, date: formatDate(selected) }));
    }
  };

  const onTimeChange = (event: any, selected?: Date) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selected) {
      setSelectedTime(selected);
      setNewMission(prev => ({ ...prev, time: formatTime(selected) }));
    }
  };

  const coordinatorStats = [
    { 
      label: 'VISITES', 
      value: '12', 
      subtitle: 'ce mois',
      gradient: ['#3B82F6', '#1D4ED8'],
      icon: Camera 
    },
    { 
      label: 'RAPPORTS', 
      value: '8', 
      subtitle: 'générés',
      gradient: ['#10B981', '#059669'],
      icon: FileText 
    },
    { 
      label: 'ALERTES', 
      value: '3', 
      subtitle: 'actives',
      gradient: ['#F59E0B', '#D97706'],
      icon: AlertTriangle 
    },
    { 
      label: 'CONFORMITÉ', 
      value: '94%', 
      subtitle: 'moyenne',
      gradient: ['#8B5CF6', '#A855F7'],
      icon: TrendingUp 
    },
  ];

  const todayMissions = [
    {
      id: 1,
      title: 'RÉSIDENCE LES JARDINS',
      client: 'Bouygues Construction',
      time: '14:00',
      location: 'Lyon 69003',
      type: 'Visite mensuelle',
      priority: 'haute',
      status: 'pending',
      gradient: ['#10B981', '#059669'],
    },
    {
      id: 2,
      title: 'BUREAUX PART-DIEU',
      client: 'Eiffage Construction',
      time: '16:30',
      location: 'Lyon 69003',
      type: 'Contrôle final',
      priority: 'moyenne',
      status: 'pending',
      gradient: ['#3B82F6', '#1D4ED8'],
    },
  ];

  const missionTypes = [
    'Visite de contrôle',
    'Inspection sécurité',
    'Contrôle périodique',
    'Visite mensuelle',
    'Contrôle final',
    'Audit conformité',
    'Inspection préalable'
  ];

  const resetForm = () => {
    setNewMission({
      title: '',
      client: '',
      location: '',
      description: '',
      date: '',
      time: '',
      type: 'Visite de contrôle',
      contactFirstName: '',
      contactLastName: '',
      contactEmail: '',
      contactPhone: ''
    });
    // Arrêter l'enregistrement si en cours
    if (isRecordingDescription) {
      stopRecording();
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
          setNewMission(prev => ({
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

  const handleCreateMission = async () => {
    // Validation des champs obligatoires
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
    if (!newMission.time.trim()) {
      Alert.alert('Erreur', 'L\'heure est obligatoire');
      return;
    }
    if (!newMission.contactEmail.trim()) {
      Alert.alert('Erreur', 'L\'email du contact est obligatoire');
      return;
    }

    // Validation de l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newMission.contactEmail)) {
      Alert.alert('Erreur', 'Veuillez saisir un email valide');
      return;
    }

    setIsCreatingMission(true);

    try {
      // Créer la mission via l'API
      const missionData = {
        title: newMission.title,
        client: newMission.client,
        address: newMission.location,
        date: newMission.date,
        time: newMission.time,
        type: newMission.type,
        description: newMission.description || undefined,
        status: 'planifiee',
        contactFirstName: newMission.contactFirstName || undefined,
        contactLastName: newMission.contactLastName || undefined,
        contactEmail: newMission.contactEmail,
        contactPhone: newMission.contactPhone || undefined,
      };

      await missionService.createMission(missionData);

      // Fermer le modal et réinitialiser le formulaire
      setShowNewMissionModal(false);
      resetForm();

      Alert.alert(
        'Mission créée !',
        `La mission "${newMission.title}" a été programmée avec succès pour le ${newMission.date} à ${newMission.time}.\n\nContact: ${newMission.contactFirstName} ${newMission.contactLastName}\nEmail: ${newMission.contactEmail}`,
        [
          {
            text: 'Voir mes missions',
            onPress: () => {
              router.push('/missions');
            }
          },
          {
            text: 'OK',
            style: 'default'
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

  const handleCancelButton = () => {
    const hasData = Object.values(newMission).some(value => 
      value.trim() !== '' && value !== 'Visite de contrôle'
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
              setShowNewMissionModal(false);
              resetForm();
            }
          }
        ]
      );
    } else {
      setShowNewMissionModal(false);
      resetForm();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Bonjour {isLoadingUser ? '...' : userProfile ? userProfile.firstName : 'Pierre'}
          </Text>
          <Text style={styles.subtitle}>
            {isLoadingUser ? 'Chargement...' : userProfile ?
              (userProfile.role === 'admin' ? 'Administrateur' :
               userProfile.role === 'coordinator' ? 'Coordinateur' :
               'Coordonnateur SPS') : 'Coordonnateur SPS'}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* New Mission Button */}
        <View style={styles.newMissionSection}>
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
        </View>

        {/* Today's Missions */}
        <View style={styles.missionsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MISSIONS D'AUJOURD'HUI</Text>
          </View>

          {todayMissions.map((mission) => (
            <TouchableOpacity key={mission.id} style={styles.missionCard}>
              <LinearGradient
                colors={mission.gradient}
                style={styles.missionGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <View style={styles.missionOverlay}>
                  <View style={styles.missionHeader}>
                    <View>
                      <Text style={styles.missionTitle}>{mission.title}</Text>
                      <Text style={styles.missionClient}>{mission.client}</Text>
                    </View>
                    <View style={styles.missionTime}>
                      <Clock size={14} color="#FFFFFF" />
                      <Text style={styles.missionTimeText}>{mission.time}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.missionFooter}>
                    <View style={styles.missionLocation}>
                      <MapPin size={12} color="#FFFFFF" />
                      <Text style={styles.missionLocationText}>{mission.location}</Text>
                    </View>
                    <Text style={styles.missionType}>{mission.type}</Text>
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ))}
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
      </ScrollView>

      {/* New Mission Modal */}
      <Modal visible={showNewMissionModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.newMissionModal}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.newMissionModalGradient}
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
                  
                  {/* Prénom et Nom - VERSION CORRIGÉE */}
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

                {/* Date et heure - WITH DATE/TIME PICKERS */}
                <View style={styles.dateTimeRow}>
                  <View style={styles.dateTimeFieldContainer}>
                    <Text style={styles.inputLabel}>DATE *</Text>
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
                    <Text style={styles.inputLabel}>HEURE *</Text>
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

                {/* Description - AVEC ESPACEMENT AUGMENTÉ ET SPEECH-TO-TEXT */}
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
                  </View>
                  {isRecordingDescription && (
                    <Text style={styles.speechHint}>
                      Parlez maintenant... Appuyez à nouveau sur le micro pour arrêter.
                    </Text>
                  )}
                </View>
              </ScrollView>

              {/* Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={styles.cancelButton}
                  onPress={handleCancelButton}
                >
                  <Text style={styles.cancelButtonText}>ANNULER</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.createButton}
                  onPress={handleCreateMission}
                  disabled={isCreatingMission}
                >
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.createButtonGradient}
                  >
                    {isCreatingMission ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <Plus size={16} color="#FFFFFF" />
                        <Text style={styles.createButtonText}>CRÉER LA MISSION</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
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
    paddingBottom: 20,
    backgroundColor: '#0F172A',
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  statsSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 1,
    marginBottom: 16,
  },
  newMissionSection: {
    marginBottom: 32,
  },
  newMissionButton: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  newMissionGradient: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newMissionTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: 12,
    textAlign: 'center',
  },
  newMissionSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 16,
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
  missionCard: {
    height: 120,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
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
  missionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  missionClient: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
  },
  missionTime: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  missionTimeText: {
    fontSize: 11,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  missionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  missionLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  missionLocationText: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    opacity: 0.9,
  },
  missionType: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
    color: '#FFFFFF',
    opacity: 0.8,
  },
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  newMissionModal: {
    width: '95%',
    maxWidth: 600,
    height: '90%',
    borderRadius: 24,
    overflow: 'hidden',
  },
  newMissionModalGradient: {
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
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  textArea: {
    textAlignVertical: 'top',
    minHeight: 80,
  },
  // Nouveaux styles pour la section contact
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
  // STYLES CORRIGÉS POUR LES CHAMPS PRÉNOM/NOM
  nameRow: {
    flexDirection: 'row',
    gap: 6, // Gap très réduit
    marginBottom: 20,
  },
  nameFieldContainer: {
    flex: 1,
    minWidth: 0, // Important pour éviter le débordement
  },
  nameInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 6, // Padding très réduit
    paddingVertical: 10,
    minHeight: 44,
  },
  nameInputIcon: {
    marginRight: 6, // Marge très réduite
    flexShrink: 0, // Empêche l'icône de se rétrécir
  },
  nameTextInput: {
    flex: 1,
    fontSize: 13, // Taille de police réduite
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    paddingRight: 0,
    minWidth: 0, // Important pour éviter le débordement
  },
  // STYLES CORRIGÉS POUR LES CHAMPS DATE/HEURE
  dateTimeRow: {
    flexDirection: 'row',
    gap: 6, // Gap très réduit
    marginBottom: 20, // Marge normale après date/heure
  },
  dateTimeFieldContainer: {
    flex: 1,
    minWidth: 0, // Important pour éviter le débordement
  },
  dateTimeInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 6, // Padding très réduit
    paddingVertical: 10,
    minHeight: 44,
  },
  dateTimeInputIcon: {
    marginRight: 6, // Marge très réduite
    flexShrink: 0, // Empêche l'icône de se rétrécir
  },
  dateTimeTextInput: {
    flex: 1,
    fontSize: 13, // Taille de police réduite
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    paddingRight: 0,
    minWidth: 0, // Important pour éviter le débordement
  },
  webDateInput: {
    cursor: 'pointer',
    outlineStyle: 'none',
  },
  // NOUVEAU STYLE POUR LE CHAMP DESCRIPTION AVEC ESPACEMENT AUGMENTÉ ET SPEECH-TO-TEXT
  descriptionInputGroup: {
    marginBottom: 20,
    marginTop: 32, // ESPACEMENT AUGMENTÉ AVANT LA DESCRIPTION
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
  createButton: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  createButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  createButtonText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});