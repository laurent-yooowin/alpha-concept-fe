import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  TextInput,
  Dimensions,
  Modal,
  ImageBackground,
  Alert,
  ActivityIndicator
} from 'react-native';
import { Search, Filter, Download, Send, FileText, Calendar, Building, CircleCheck as CheckCircle, Clock, TriangleAlert as AlertTriangle, Eye, Share, Sparkles, ArrowRight, ChevronDown, X, Edit, Mail } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { reportService, ReportStatus } from '@/services/reportService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getReportStatusInfo } from '@/utils/missionHelpers';
import * as Linking from 'expo-linking';
import { pdfService } from '@/services/pdfService';
import { visitService } from '@/services/visitService';

const { width } = Dimensions.get('window');

export default function RapportsScreen() {
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
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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

  const loadReports = async () => {
    try {
      setLoading(true);
      const response = await reportService.getReports();

      if (response.data && Array.isArray(response.data)) {
        const backendReports = response.data.map((report: any) => {
          const statusInfo = getReportStatusInfo(report.status);
          return {
            id: report.id,
            visitId: report.visitId,
            title: report.title,
            mission: report.mission?.title || 'Mission inconnue',
            client: report.mission?.client || 'Client inconnu',
            date: new Date(report.createdAt).toISOString().split('T')[0],
            status: report.status === 'brouillon' ? 'brouillons' :
              report.status === 'envoye' ? 'envoyes' :
                report.status === 'valide' ? 'valides' :
                  report.status === 'rejete' ? 'rejetes' :
                    'archives',
            originalStatus: report.status,
            type: 'Rapport SPS',
            pages: Math.ceil(report.content.length / 500),
            photos: 0,
            anomalies: 0,
            conformity: report.conformityPercentage,
            aiGenerated: true,
            gradient: statusInfo.gradient,
            backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
            reportContent: report.content,
          };
        });

        // Load local reports as well
        const localReports = await AsyncStorage.getItem('userReports');
        const parsedLocalReports = localReports ? JSON.parse(localReports) : [];

        // setReports([...backendReports, ...parsedLocalReports]);
        setReports([...backendReports]);
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
      setEditedContent(selectedReport.reportContent || '');
      setShowEditModal(true);
    }
  };

  const handleSaveModifications = async () => {
    if (!selectedReport) return;

    try {
      setIsSaving(true);
      await reportService.updateReport(selectedReport.id, {
        content: editedContent,
      });

      if (selectedReport.visitId) {
        try {
          const visitResponse = await visitService.getVisit(selectedReport.visitId);
          if (visitResponse.data) {
            const currentNotes = visitResponse.data.notes || '';
            const modificationNote = `\n\n[Modification du ${new Date().toLocaleString('fr-FR')}]\n${editedContent}`;
            await visitService.updateVisit(selectedReport.visitId, {
              notes: currentNotes + modificationNote,
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

  const handleSendReport = async () => {
    if (!selectedReport) return;

    const adminEmail = 'admin@csps.fr';
    const subject = `Rapport SPS: ${selectedReport.title}`;

    try {
      Alert.alert('Génération du PDF', 'Veuillez patienter...');

      let photos: any[] = [];
      if (selectedReport.visitId) {
        try {
          const visitResponse = await visitService.getVisit(selectedReport.visitId);
          if (visitResponse.data && visitResponse.data.photos) {
            photos = visitResponse.data.photos.map((photo: any) => ({
              uri: photo.uri,
              comment: photo.comment,
            }));
          }
        } catch (error) {
          console.log('Could not load visit photos:', error);
        }
      }

      const pdfData = {
        title: selectedReport.title,
        mission: selectedReport.mission,
        client: selectedReport.client,
        date: selectedReport.date,
        conformity: selectedReport.conformity,
        content: selectedReport.reportContent || 'Contenu non disponible',
        photos: photos,
      };

      const pdfPath = await pdfService.generateReportPDF(pdfData);

      await reportService.updateReport(selectedReport.id, {
        status: 'envoye' as ReportStatus,
        recipientEmail: adminEmail,
      });

      const body = `Bonjour,

Veuillez trouver ci-joint le rapport de visite suivant:

Titre: ${selectedReport.title}
Mission: ${selectedReport.mission}
Client: ${selectedReport.client}
Date: ${selectedReport.date}
Conformité: ${selectedReport.conformity}%

Le rapport complet avec les photos est disponible en pièce jointe PDF.

Cordialement`;

      const mailtoUrl = pdfService.createMailtoLinkWithAttachment(
        adminEmail,
        subject,
        body,
        pdfPath || undefined
      );

      await Linking.openURL(mailtoUrl);

      loadReports();
      setShowReportModal(false);
    } catch (error) {
      console.error('Error sending report:', error);
      Alert.alert('Erreur', "Impossible d'ouvrir l'application mail.");
    }
  };

  const filters = [
    { id: 'tous', label: 'Tous les rapports', count: 24, color: '#8B5CF6', icon: FileText },
    { id: 'envoyes', label: 'Rapports envoyés', count: 15, color: '#10B981', icon: CheckCircle },
    { id: 'brouillons', label: 'Brouillons', count: 6, color: '#F59E0B', icon: Clock },
    { id: 'archives', label: 'Rapports archivés', count: 3, color: '#64748B', icon: Download },
  ];

  // Mock data removed - now using reports loaded from backend API via loadReports()
  const mockRapports = [
    // RAPPORTS ENVOYÉS
    {
      id: 1,
      title: 'RAPPORT SPS - RÉSIDENCE LES JARDINS',
      mission: 'Chantier Résidence Les Jardins',
      client: 'Bouygues Construction',
      date: '2025-01-15',
      status: 'envoyes',
      type: 'Visite mensuelle',
      pages: 8,
      photos: 12,
      anomalies: 2,
      conformity: 92,
      aiGenerated: true,
      gradient: ['#10B981', '#059669'],
      backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 2,
      title: 'CONTRÔLE FINAL - BUREAUX PART-DIEU',
      mission: 'Rénovation Bureaux Part-Dieu',
      client: 'Eiffage Construction',
      date: '2025-01-14',
      status: 'envoyes',
      type: 'Contrôle final',
      pages: 12,
      photos: 18,
      anomalies: 1,
      conformity: 96,
      aiGenerated: false,
      gradient: ['#3B82F6', '#1D4ED8'],
      backgroundImage: 'https://images.pexels.com/photos/325229/pexels-photo-325229.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 3,
      title: 'INSPECTION SÉCURITÉ - LYCÉE ÉCOLOGIQUE',
      mission: 'Construction Lycée Écologique',
      client: 'GTM Bâtiment',
      date: '2025-01-13',
      status: 'envoyes',
      type: 'Suivi hebdomadaire',
      pages: 6,
      photos: 10,
      anomalies: 0,
      conformity: 98,
      aiGenerated: true,
      gradient: ['#10B981', '#059669'],
      backgroundImage: 'https://images.pexels.com/photos/256490/pexels-photo-256490.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 4,
      title: 'RAPPORT CONFORMITÉ - ÉCOLE PRIMAIRE',
      mission: 'Rénovation École Primaire',
      client: 'Vinci Construction',
      date: '2025-01-12',
      status: 'envoyes',
      type: 'Inspection préalable',
      pages: 9,
      photos: 14,
      anomalies: 3,
      conformity: 88,
      aiGenerated: true,
      gradient: ['#F59E0B', '#D97706'],
      backgroundImage: 'https://images.pexels.com/photos/159844/school-building-windows-architecture-159844.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 5,
      title: 'VISITE SÉCURITÉ - STATION MÉTRO B',
      mission: 'Nouvelle Station Métro B',
      client: 'SYTRAL',
      date: '2025-01-11',
      status: 'envoyes',
      type: 'Contrôle périodique',
      pages: 15,
      photos: 22,
      anomalies: 1,
      conformity: 94,
      aiGenerated: false,
      gradient: ['#8B5CF6', '#A855F7'],
      backgroundImage: 'https://images.pexels.com/photos/1267338/pexels-photo-1267338.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 6,
      title: 'SUIVI - DATACENTER ORANGE',
      mission: 'Construction Datacenter Orange',
      client: 'Bouygues Energies',
      date: '2025-01-10',
      status: 'envoyes',
      type: 'Suivi mensuel',
      pages: 7,
      photos: 12,
      anomalies: 1,
      conformity: 91,
      aiGenerated: true,
      gradient: ['#3B82F6', '#1D4ED8'],
      backgroundImage: 'https://images.pexels.com/photos/442150/pexels-photo-442150.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 7,
      title: 'CONTRÔLE - CENTRE RECHERCHE CNRS',
      mission: 'Rénovation Centre Recherche',
      client: 'Eiffage Construction',
      date: '2025-01-09',
      status: 'envoyes',
      type: 'Contrôle laboratoires',
      pages: 13,
      photos: 20,
      anomalies: 2,
      conformity: 89,
      aiGenerated: false,
      gradient: ['#8B5CF6', '#A855F7'],
      backgroundImage: 'https://images.pexels.com/photos/2280571/pexels-photo-2280571.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 8,
      title: 'INSPECTION - RAFFINERIE TOTAL',
      mission: 'Maintenance Raffinerie Total',
      client: 'Technip Energies',
      date: '2025-01-08',
      status: 'envoyes',
      type: 'Contrôle ATEX',
      pages: 16,
      photos: 24,
      anomalies: 6,
      conformity: 78,
      aiGenerated: true,
      gradient: ['#EF4444', '#DC2626'],
      backgroundImage: 'https://images.pexels.com/photos/1108572/pexels-photo-1108572.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 9,
      title: 'VISITE - TUNNEL CROIX-ROUSSE',
      mission: 'Rénovation Tunnel Urbain',
      client: 'Vinci Construction',
      date: '2025-01-07',
      status: 'envoyes',
      type: 'Inspection tunnel',
      pages: 11,
      photos: 17,
      anomalies: 4,
      conformity: 83,
      aiGenerated: false,
      gradient: ['#F59E0B', '#D97706'],
      backgroundImage: 'https://images.pexels.com/photos/2219024/pexels-photo-2219024.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 10,
      title: 'RAPPORT - STADE OLYMPIQUE',
      mission: 'Rénovation Groupama Stadium',
      client: 'Bouygues Construction',
      date: '2025-01-06',
      status: 'envoyes',
      type: 'Contrôle périodique',
      pages: 9,
      photos: 15,
      anomalies: 0,
      conformity: 99,
      aiGenerated: true,
      gradient: ['#10B981', '#059669'],
      backgroundImage: 'https://images.pexels.com/photos/1263349/pexels-photo-1263349.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 11,
      title: 'CONTRÔLE - AÉROPORT LYON',
      mission: 'Extension Terminal 2',
      client: 'Vinci Airports',
      date: '2025-01-05',
      status: 'envoyes',
      type: 'Contrôle sécurité',
      pages: 14,
      photos: 23,
      anomalies: 2,
      conformity: 92,
      aiGenerated: false,
      gradient: ['#3B82F6', '#1D4ED8'],
      backgroundImage: 'https://images.pexels.com/photos/2026324/pexels-photo-2026324.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 12,
      title: 'INSPECTION - CENTRALE NUCLÉAIRE',
      mission: 'Maintenance Centrale Bugey',
      client: 'EDF',
      date: '2025-01-04',
      status: 'envoyes',
      type: 'Inspection sécurité',
      pages: 22,
      photos: 31,
      anomalies: 1,
      conformity: 96,
      aiGenerated: false,
      gradient: ['#EF4444', '#DC2626'],
      backgroundImage: 'https://images.pexels.com/photos/9800029/pexels-photo-9800029.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 13,
      title: 'RAPPORT - BARRAGE RHÔNE',
      mission: 'Inspection Barrage Hydroélectrique',
      client: 'CNR',
      date: '2025-01-03',
      status: 'envoyes',
      type: 'Inspection annuelle',
      pages: 19,
      photos: 26,
      anomalies: 0,
      conformity: 98,
      aiGenerated: true,
      gradient: ['#10B981', '#059669'],
      backgroundImage: 'https://images.pexels.com/photos/433308/pexels-photo-433308.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 14,
      title: 'VISITE - PARC ÉOLIEN',
      mission: 'Base Logistique Éolien Offshore',
      client: 'EDF Renouvelables',
      date: '2025-01-02',
      status: 'envoyes',
      type: 'Inspection préparatoire',
      pages: 8,
      photos: 12,
      anomalies: 1,
      conformity: 94,
      aiGenerated: true,
      gradient: ['#8B5CF6', '#A855F7'],
      backgroundImage: 'https://images.pexels.com/photos/433308/pexels-photo-433308.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 15,
      title: 'CONTRÔLE - USINE AUTOMOBILE',
      mission: 'Extension Usine Automobile',
      client: 'Renault',
      date: '2025-01-01',
      status: 'envoyes',
      type: 'Contrôle chaîne production',
      pages: 10,
      photos: 16,
      anomalies: 3,
      conformity: 86,
      aiGenerated: false,
      gradient: ['#F59E0B', '#D97706'],
      backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
    },

    // BROUILLONS
    {
      id: 16,
      title: 'INSPECTION - CENTRE COMMERCIAL',
      mission: 'Extension Centre Commercial',
      client: 'Vinci Construction',
      date: '2025-01-15',
      status: 'brouillons',
      type: 'Inspection préalable',
      pages: 5,
      photos: 8,
      anomalies: 0,
      conformity: 85,
      aiGenerated: true,
      gradient: ['#8B5CF6', '#A855F7'],
      backgroundImage: 'https://images.pexels.com/photos/1040893/pexels-photo-1040893.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 17,
      title: 'CONTRÔLE - RÉSIDENCE ÉTUDIANTE',
      mission: 'Construction Résidence Étudiante',
      client: 'Eiffage Construction',
      date: '2025-01-15',
      status: 'brouillons',
      type: 'Visite intermédiaire',
      pages: 7,
      photos: 11,
      anomalies: 2,
      conformity: 90,
      aiGenerated: true,
      gradient: ['#3B82F6', '#1D4ED8'],
      backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 18,
      title: 'RAPPORT - HÔPITAL MODERNE',
      mission: 'Construction Hôpital Moderne',
      client: 'Bouygues Construction',
      date: '2025-01-14',
      status: 'brouillons',
      type: 'Contrôle installations',
      pages: 10,
      photos: 16,
      anomalies: 4,
      conformity: 82,
      aiGenerated: false,
      gradient: ['#EF4444', '#DC2626'],
      backgroundImage: 'https://images.pexels.com/photos/263402/pexels-photo-263402.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 19,
      title: 'VISITE - USINE PHARMACEUTIQUE',
      mission: 'Rénovation Usine Pharmaceutique',
      client: 'Eiffage Construction',
      date: '2025-01-14',
      status: 'brouillons',
      type: 'Contrôle salle blanche',
      pages: 8,
      photos: 13,
      anomalies: 5,
      conformity: 75,
      aiGenerated: true,
      gradient: ['#F59E0B', '#D97706'],
      backgroundImage: 'https://images.pexels.com/photos/3735747/pexels-photo-3735747.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 20,
      title: 'INSPECTION - COMPLEXE SPORTIF',
      mission: 'Construction Complexe Sportif',
      client: 'GTM Bâtiment',
      date: '2025-01-13',
      status: 'brouillons',
      type: 'Contrôle équipements',
      pages: 6,
      photos: 9,
      anomalies: 1,
      conformity: 93,
      aiGenerated: true,
      gradient: ['#10B981', '#059669'],
      backgroundImage: 'https://images.pexels.com/photos/1263349/pexels-photo-1263349.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 21,
      title: 'RAPPORT - PONT AUTOROUTIER',
      mission: 'Rénovation Pont Autoroutier A6',
      client: 'Colas',
      date: '2025-01-13',
      status: 'brouillons',
      type: 'Inspection structure',
      pages: 11,
      photos: 19,
      anomalies: 3,
      conformity: 87,
      aiGenerated: false,
      gradient: ['#8B5CF6', '#A855F7'],
      backgroundImage: 'https://images.pexels.com/photos/2219024/pexels-photo-2219024.jpeg?auto=compress&cs=tinysrgb&w=800',
    },

    // RAPPORTS ARCHIVÉS
    {
      id: 22,
      title: 'RAPPORT FINAL - ANCIEN PROJET LYON',
      mission: 'Rénovation Immeuble Historique',
      client: 'Bouygues Construction',
      date: '2024-12-20',
      status: 'archives',
      type: 'Rapport final',
      pages: 25,
      photos: 35,
      anomalies: 0,
      conformity: 100,
      aiGenerated: false,
      gradient: ['#64748B', '#475569'],
      backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 23,
      title: 'CLÔTURE - CENTRE LOGISTIQUE',
      mission: 'Construction Centre Logistique',
      client: 'Vinci Construction',
      date: '2024-12-15',
      status: 'archives',
      type: 'Rapport de clôture',
      pages: 18,
      photos: 28,
      anomalies: 2,
      conformity: 95,
      aiGenerated: false,
      gradient: ['#64748B', '#475569'],
      backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 24,
      title: 'BILAN - PARKING SOUTERRAIN',
      mission: 'Construction Parking Souterrain',
      client: 'GTM Bâtiment',
      date: '2024-12-10',
      status: 'archives',
      type: 'Bilan final',
      pages: 14,
      photos: 21,
      anomalies: 1,
      conformity: 97,
      aiGenerated: false,
      gradient: ['#64748B', '#475569'],
      backgroundImage: 'https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
  ];

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'envoyes':
        return { label: 'Envoyé', color: '#10B981', icon: CheckCircle };
      case 'brouillons':
        return { label: 'Brouillon', color: '#F59E0B', icon: Clock };
      case 'archives':
        return { label: 'Archivé', color: '#64748B', icon: Download };
      default:
        return { label: 'En cours', color: '#3B82F6', icon: Clock };
    }
  };

  const filteredRapports = reports.filter(rapport => {
    const matchesSearch = rapport.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rapport.mission.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rapport.client.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter = activeFilter === 'tous' || rapport.status === activeFilter;

    return matchesSearch && matchesFilter;
  });

  // Mettre à jour les compteurs dynamiquement
  const getFilterCounts = () => {
    const counts = {
      tous: reports.length,
      envoyes: reports.filter(r => r.status === 'envoyes').length,
      brouillons: reports.filter(r => r.status === 'brouillons').length,
      archives: reports.filter(r => r.status === 'archives').length,
    };
    return counts;
  };

  const filterCounts = getFilterCounts();

  // Mettre à jour les filtres avec les compteurs corrects
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

  return (
    <SafeAreaView style={styles.container}>
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
                  : `Aucun rapport ${activeFilter === 'envoyes' ? 'envoyé' :
                    activeFilter === 'brouillons' ? 'en brouillon' :
                      activeFilter === 'archives' ? 'archivé' : ''
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
                  setSelectedReport(rapport);
                  setShowReportModal(true);
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
                            {rapport.aiGenerated && (
                              <View style={styles.aiBadge}>
                                <Sparkles size={10} color="#FFFFFF" />
                                <Text style={styles.aiText}>IA</Text>
                              </View>
                            )}
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
                            <View>
                              <Text style={styles.filterMenuItemTextActive}>{filter.label}</Text>
                              <Text style={styles.filterMenuItemSubtextActive}>{filter.count} rapport{filter.count > 1 ? 's' : ''}</Text>
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
                          <View>
                            <Text style={styles.filterMenuItemText}>{filter.label}</Text>
                            <Text style={styles.filterMenuItemSubtext}>{filter.count} rapport{filter.count > 1 ? 's' : ''}</Text>
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
                    <View style={styles.reportDetailContentBox}>
                      <Text style={styles.reportDetailContentText}>
                        {selectedReport.reportContent || 'Aucun contenu disponible pour ce rapport.'}
                      </Text>
                    </View>
                  </View>

                  {selectedReport.aiGenerated && (
                    <View style={styles.reportDetailAiBadge}>
                      <Sparkles size={16} color="#F59E0B" />
                      <Text style={styles.reportDetailAiText}>Généré par IA</Text>
                    </View>
                  )}
                </ScrollView>

                {selectedReport && selectedReport.originalStatus !== 'valide' && (
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
                      onPress={handleValidateReport}
                    >
                      <LinearGradient
                        colors={['#10B981', '#059669']}
                        style={styles.actionButtonGradient}
                      >
                        <CheckCircle size={20} color="#FFFFFF" />
                        <Text style={styles.actionButtonText}>Valider</Text>
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
                        <Mail size={20} color="#FFFFFF" />
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

            <View style={styles.editModalContent}>
              <Text style={styles.editModalLabel}>Contenu du rapport</Text>
              <TextInput
                style={styles.editModalTextInput}
                value={editedContent}
                onChangeText={setEditedContent}
                multiline
                numberOfLines={10}
                placeholder="Saisissez le contenu du rapport..."
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
            </View>
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
    height: 200,
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
    gap: 8,
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
    gap: 2,
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
    paddingVertical: 4,
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
    marginVertical: 8,
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
    marginVertical: 6,
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
  },
  filterMenuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterMenuItemText: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  filterMenuItemTextActive: {
    fontSize: 16,
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
  },
  filterMenuBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 32,
    alignItems: 'center',
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
  reportDetailModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
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
  reportDetailSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: 'rgba(255, 255, 255, 0.8)',
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
    minHeight: 200,
  },
  reportDetailContentText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#E2E8F0',
    lineHeight: 22,
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
  editModalContent: {
    flex: 1,
    padding: 20,
  },
  editModalLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
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
  },
  saveButtonGradient: {
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