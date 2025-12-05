import React, { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Dimensions,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, Bell, Download, LogOut, ChevronRight, Award, MapPin, Phone, Mail, Calendar, Database, Lock, Smartphone, CreditCard as Edit, Save, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { userService } from '@/services/userService';
import { useAuth } from '@/contexts/AuthContext';

const { width } = Dimensions.get('window');

export default function ProfilScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [syncEnabled, setSyncEnabled] = React.useState(true);
  const [offlineEnabled, setOfflineEnabled] = React.useState(false);
  const [showEditModal, setShowEditModal] = React.useState(false);
  const [editingField, setEditingField] = React.useState<string | null>(null);
  const [tempValue, setTempValue] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const { logout } = useAuth();

  const [coordinatorInfo, setCoordinatorInfo] = React.useState({
    name: 'Chargement...',
    role: 'Coordonnateur SPS',
    certification: 'SPS Niveau 2',
    phone: '',
    email: '',
    location: 'Lyon, France',
    memberSince: '2022',
    company: '',
    experience: 0,
  });

  React.useEffect(() => {
    loadUserProfile();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUserProfile();
    }, [])
  );

  const loadUserProfile = async () => {
    setLoading(true);
    const response = await userService.getProfile();

    if (response.data) {
      const user = response.data;
      setCoordinatorInfo({
        name: `${user.firstName} ${user.lastName}`,
        role: user.role === 'csps' ? 'Coordonnateur SPS' : user.role === 'admin' ? 'Administrateur' : 'Coordinateur',
        certification: 'SPS Niveau 2',
        phone: user.phone || '',
        email: user.email,
        location: 'Lyon, France',
        memberSince: new Date(user.createdAt).getFullYear().toString(),
        company: user.company || '',
        experience: user.experience || 0,
      });
    } else if (response.error) {
      Alert.alert('Erreur', 'Impossible de charger le profil');
    }

    setLoading(false);
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/(auth)/login');
    } catch (error) {
      console.log('Erreur lors de la déconnexion:', error);
      Alert.alert('Erreur', 'Impossible de se déconnecter. Veuillez réessayer.');
    }
    // Alert.alert(
    //   'Déconnexion',
    //   'Êtes-vous sûr de vouloir vous déconnecter ?',
    //   [
    //     { text: 'Annuler', style: 'cancel' },
    //     {
    //       text: 'Déconnexion',
    //       style: 'destructive',
    //       onPress: async () => {
    //         try {
    //           await logout();
    //           router.replace('/(auth)/login');
    //         } catch (error) {
    //           console.log('Erreur lors de la déconnexion:', error);
    //           Alert.alert('Erreur', 'Impossible de se déconnecter. Veuillez réessayer.');
    //         }
    //       },
    //     },
    //   ]
    // );
  };

  const menuSections = [
    {
      title: 'MOT DE PASSE',
      items: [
        { icon: Lock, label: 'Modifier le mot de passe', hasChevron: true, onPress: () => handleEditField('password') },
      ]
    }
  ];

  const handleEditField = (field: string) => {
    setEditingField(field);
    if (field === 'email') {
      setTempValue(coordinatorInfo.email);
    } else if (field === 'password') {
      setTempValue('');
    } else if (field === 'experience') {
      setTempValue(coordinatorInfo.experience.toString());
    } else {
      setTempValue(coordinatorInfo[field as keyof typeof coordinatorInfo]?.toString() || '');
    }
    setShowEditModal(true);
  };

  const handleSaveField = async () => {
    if (!tempValue.trim() && editingField !== 'phone' && editingField !== 'company') {
      Alert.alert('Erreur', 'Veuillez saisir une valeur');
      return;
    }

    if (editingField === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(tempValue)) {
        Alert.alert('Erreur', 'Veuillez saisir un email valide');
        return;
      }

      const response = await userService.updateProfile({ email: tempValue });
      if (response.data) {
        setCoordinatorInfo(prev => ({ ...prev, email: tempValue }));
        Alert.alert('Succès', 'Email modifié avec succès');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder l\'email');
        return;
      }
    } else if (editingField === 'name') {
      const names = tempValue.trim().split(' ');
      if (names.length < 2) {
        Alert.alert('Erreur', 'Veuillez saisir prénom et nom');
        return;
      }
      const firstName = names[0];
      const lastName = names.slice(1).join(' ');

      const response = await userService.updateProfile({ firstName, lastName });
      if (response.data) {
        setCoordinatorInfo(prev => ({ ...prev, name: tempValue }));
        Alert.alert('Succès', 'Nom modifié avec succès');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder le nom');
        return;
      }
    } else if (editingField === 'phone') {
      const response = await userService.updateProfile({ phone: tempValue });
      if (response.data) {
        setCoordinatorInfo(prev => ({ ...prev, phone: tempValue }));
        Alert.alert('Succès', 'Téléphone modifié avec succès');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder le téléphone');
        return;
      }
    } else if (editingField === 'company') {
      const response = await userService.updateProfile({ company: tempValue });
      if (response.data) {
        setCoordinatorInfo(prev => ({ ...prev, company: tempValue }));
        Alert.alert('Succès', 'Entreprise modifiée avec succès');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder l\'entreprise');
        return;
      }
    } else if (editingField === 'experience') {
      const experienceNum = parseInt(tempValue);
      if (isNaN(experienceNum) || experienceNum < 0 || experienceNum > 99) {
        Alert.alert('Erreur', 'Veuillez saisir un nombre valide entre 0 et 99');
        return;
      }

      const response = await userService.updateProfile({ experience: experienceNum });
      if (response.data) {
        setCoordinatorInfo(prev => ({ ...prev, experience: experienceNum }));
        Alert.alert('Succès', 'Expérience modifiée avec succès');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder l\'expérience');
        return;
      }
    } else if (editingField === 'password') {
      if (tempValue.length < 6) {
        Alert.alert('Erreur', 'Le mot de passe doit contenir au moins 6 caractères');
        return;
      }

      const response = await userService.updateProfile({ password: tempValue });
      if (response.data) {
        Alert.alert('Succès', 'Mot de passe modifié avec succès');
      } else {
        Alert.alert('Erreur', 'Impossible de sauvegarder le mot de passe');
        return;
      }
    } else if (editingField && editingField in coordinatorInfo) {
      setCoordinatorInfo(prev => ({ ...prev, [editingField]: tempValue }));
      Alert.alert('Succès', 'Information modifiée avec succès');
    }

    setShowEditModal(false);
    setEditingField(null);
    setTempValue('');
  };

  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditingField(null);
    setTempValue('');
  };

  const getFieldLabel = (field: string) => {
    switch (field) {
      case 'name': return 'Nom complet';
      case 'firstName': return 'Prénom';
      case 'lastName': return 'Nom';
      case 'phone': return 'Téléphone';
      case 'email': return 'Adresse email';
      case 'company': return 'Entreprise';
      case 'location': return 'Localisation';
      case 'experience': return 'Années d\'expérience';
      case 'password': return 'Nouveau mot de passe';
      default: return 'Information';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MON PROFIL</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <LinearGradient
            colors={['#1E293B', '#374151']}
            style={styles.profileGradient}
          >
            <View style={styles.avatarContainer}>
              <LinearGradient
                colors={['#F59E0B', '#D97706']}
                style={styles.avatar}
              >
                <Text style={styles.avatarText}>PD</Text>
              </LinearGradient>
              <View style={styles.onlineStatus} />
            </View>
            
            <View style={styles.profileInfo}>
              <Text style={styles.userName}>{coordinatorInfo.name}</Text>
              <Text style={styles.userRole}>{coordinatorInfo.role}</Text>
              
              <View style={styles.certificationBadge}>
                <LinearGradient
                  colors={['#8B5CF6', '#A855F7']}
                  style={styles.certificationGradient}
                >
                  <Award size={12} color="#FFFFFF" />
                  <Text style={styles.certificationText}>{coordinatorInfo.certification}</Text>
                </LinearGradient>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* Contact Info */}
        <View style={styles.contactSection}>
          <View style={styles.contactSectionHeader}>
            <Text style={styles.sectionTitle}>INFORMATIONS PERSONNELLES</Text>
            <TouchableOpacity 
              style={styles.editAllButton}
              onPress={() => handleEditField('name')}
            >
              <Edit size={16} color="#3B82F6" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.contactCard}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.contactGradient}
            >
              <TouchableOpacity
                style={styles.contactItem}
                onPress={() => handleEditField('name')}
              >
                <User size={16} color="#94A3B8" />
                <Text style={styles.contactText}>{coordinatorInfo.name}</Text>
                <Edit size={14} color="#64748B" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactItem}
                onPress={() => handleEditField('email')}
              >
                <Mail size={16} color="#94A3B8" />
                <Text style={styles.contactText}>{coordinatorInfo.email}</Text>
                <Edit size={14} color="#64748B" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactItem}
                onPress={() => handleEditField('phone')}
              >
                <Phone size={16} color="#94A3B8" />
                <Text style={styles.contactText}>{coordinatorInfo.phone || 'Téléphone non renseigné'}</Text>
                <Edit size={14} color="#64748B" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactItem}
                onPress={() => handleEditField('company')}
              >
                <User size={16} color="#94A3B8" />
                <Text style={styles.contactText}>{coordinatorInfo.company || 'Entreprise non renseignée'}</Text>
                <Edit size={14} color="#64748B" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactItem}
                onPress={() => handleEditField('location')}
              >
                <MapPin size={16} color="#94A3B8" />
                <Text style={styles.contactText}>{coordinatorInfo.location}</Text>
                <Edit size={14} color="#64748B" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactItem}
                onPress={() => handleEditField('experience')}
              >
                <Award size={16} color="#94A3B8" />
                <Text style={styles.contactText}>
                  {coordinatorInfo.experience} ans d'expérience
                </Text>
                <Edit size={14} color="#64748B" />
              </TouchableOpacity>

              <View style={styles.contactItem}>
                <Calendar size={16} color="#94A3B8" />
                <Text style={styles.contactText}>Coordonnateur depuis {coordinatorInfo.memberSince}</Text>
              </View>
            </LinearGradient>
          </View>
        </View>

        {/* Menu Sections */}
        {menuSections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.menuSection}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            
            <View style={styles.menuCard}>
              <LinearGradient
                colors={['#1E293B', '#374151']}
                style={styles.menuGradient}
              >
                {section.items.map((item, itemIndex) => {
                  const IconComponent = item.icon;
                  return (
                    <TouchableOpacity 
                      key={itemIndex} 
                      style={[
                        styles.menuItem,
                        itemIndex < section.items.length - 1 && styles.menuItemBorder
                      ]}
                      disabled={item.hasSwitch}
                      onPress={item.onPress}
                    >
                      <View style={styles.menuItemLeft}>
                        <View style={styles.menuIconContainer}>
                          <IconComponent size={18} color="#94A3B8" />
                        </View>
                        <Text style={styles.menuItemText}>{item.label}</Text>
                      </View>
                      
                      <View style={styles.menuItemRight}>
                        {item.hasSwitch && (
                          <Switch
                            value={item.value}
                            onValueChange={item.onToggle}
                            trackColor={{ false: '#374151', true: '#3B82F6' }}
                            thumbColor={item.value ? '#FFFFFF' : '#94A3B8'}
                          />
                        )}
                        {item.hasChevron && (
                          <ChevronRight size={18} color="#64748B" />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </LinearGradient>
            </View>
          </View>
        ))}

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <LinearGradient
            colors={['#EF4444', '#DC2626']}
            style={styles.logoutGradient}
          >
            <LogOut size={20} color="#FFFFFF" />
            <Text style={styles.logoutText}>SE DÉCONNECTER</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Version */}
        <View style={styles.versionInfo}>
          <Text style={styles.versionText}>Version 1.0.0</Text>
          <Text style={styles.versionSubtext}>© 2025 Alpha Concept SPS</Text>
        </View>
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={showEditModal} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.editModal}>
              <LinearGradient
                colors={['#1E293B', '#0F172A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.editModalGradient}
              >
                <View style={styles.editModalHeader}>
                  <View style={styles.editModalHeaderContent}>
                    <LinearGradient
                      colors={['#3B82F6', '#1D4ED8']}
                      style={styles.editModalIconContainer}
                    >
                      {editingField === 'password' ? (
                        <Lock size={20} color="#FFFFFF" />
                      ) : editingField === 'email' ? (
                        <Mail size={20} color="#FFFFFF" />
                      ) : editingField === 'phone' ? (
                        <Phone size={20} color="#FFFFFF" />
                      ) : editingField === 'company' ? (
                        <User size={20} color="#FFFFFF" />
                      ) : editingField === 'experience' ? (
                        <Award size={20} color="#FFFFFF" />
                      ) : editingField === 'location' ? (
                        <MapPin size={20} color="#FFFFFF" />
                      ) : (
                        <Edit size={20} color="#FFFFFF" />
                      )}
                    </LinearGradient>
                    <View style={styles.editModalTitleContainer}>
                      <Text style={styles.editModalTitle}>
                        {getFieldLabel(editingField || '')}
                      </Text>
                      <Text style={styles.editModalSubtitle}>
                        Modifier votre {getFieldLabel(editingField || '').toLowerCase()}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.editModalCloseButton}
                    onPress={handleCancelEdit}
                  >
                    <X size={22} color="#64748B" />
                  </TouchableOpacity>
                </View>

                <View style={styles.editModalContent}>
                  <View style={styles.editInputWrapper}>
                    <Text style={styles.editInputLabel}>
                      {getFieldLabel(editingField || '')}
                    </Text>
                    <View style={styles.editInputContainer}>
                      <TextInput
                        style={styles.editTextInput}
                        placeholder={`Saisir ${getFieldLabel(editingField || '').toLowerCase()}`}
                        placeholderTextColor="#475569"
                        value={tempValue}
                        onChangeText={setTempValue}
                        secureTextEntry={editingField === 'password'}
                        keyboardType={editingField === 'experience' ? 'numeric' : editingField === 'email' ? 'email-address' : editingField === 'phone' ? 'phone-pad' : 'default'}
                        autoCapitalize={editingField === 'email' ? 'none' : 'words'}
                        autoFocus
                      />
                    </View>
                    {editingField === 'password' && (
                      <Text style={styles.editInputHint}>
                        Le mot de passe doit contenir au moins 6 caractères
                      </Text>
                    )}
                    {editingField === 'name' && (
                      <Text style={styles.editInputHint}>
                        Format: Prénom Nom (ex: Pierre Dupont)
                      </Text>
                    )}
                    {editingField === 'experience' && (
                      <Text style={styles.editInputHint}>
                        Nombre d'années entre 0 et 99
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.editModalActions}>
                  <TouchableOpacity
                    style={styles.editCancelButton}
                    onPress={handleCancelEdit}
                  >
                    <Text style={styles.editCancelButtonText}>Annuler</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.editSaveButton}
                    onPress={handleSaveField}
                  >
                    <LinearGradient
                      colors={['#10B981', '#059669']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.editSaveButtonGradient}
                    >
                      <Save size={18} color="#FFFFFF" />
                      <Text style={styles.editSaveButtonText}>Enregistrer</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  profileCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 20,
    marginBottom: 24,
  },
  profileGradient: {
    padding: 24,
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  onlineStatus: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#374151',
  },
  profileInfo: {
    alignItems: 'center',
  },
  userName: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  userRole: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    marginBottom: 12,
  },
  certificationBadge: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  certificationGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  certificationText: {
    fontSize: 11,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  contactSection: {
    marginBottom: 24,
  },
  contactSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  editAllButton: {
    padding: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    letterSpacing: 1,
    marginBottom: 12,
  },
  contactCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  contactGradient: {
    padding: 16,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  contactText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    flex: 1,
  },
  statsSection: {
    marginBottom: 24,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: (width - 52) / 2,
    height: 80,
    borderRadius: 16,
    overflow: 'hidden',
  },
  statGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  statValue: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.5,
    opacity: 0.9,
  },
  menuSection: {
    marginBottom: 20,
  },
  menuCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  menuGradient: {
    padding: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuItemText: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#FFFFFF',
    flex: 1,
  },
  menuItemRight: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  },
  logoutGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  logoutText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  versionInfo: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  versionText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    marginBottom: 4,
  },
  versionSubtext: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    color: '#475569',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  editModal: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  editModalGradient: {
    padding: 28,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  },
  editModalHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 16,
  },
  editModalIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editModalTitleContainer: {
    flex: 1,
  },
  editModalTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  editModalSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
  },
  editModalCloseButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(100, 116, 139, 0.1)',
  },
  editModalContent: {
    marginBottom: 28,
  },
  editInputWrapper: {
    gap: 12,
  },
  editInputLabel: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#E2E8F0',
    marginBottom: 0,
  },
  editInputContainer: {
    backgroundColor: 'rgba(51, 65, 85, 0.6)',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.1)',
  },
  editTextInput: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    minHeight: 24,
  },
  editInputHint: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
    marginTop: -4,
  },
  editModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editCancelButton: {
    flex: 1,
    backgroundColor: 'rgba(51, 65, 85, 0.5)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  editCancelButtonText: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
    color: '#CBD5E1',
  },
  editSaveButton: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  editSaveButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  editSaveButtonText: {
    fontSize: 15,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
});