import React from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  TouchableOpacity, 
  StyleSheet, 
  SafeAreaView,
  Switch,
  Dimensions,
  Modal,
  TextInput,
  Alert
} from 'react-native';
import { User, Bell, Download, LogOut, ChevronRight, Award, MapPin, Phone, Mail, Calendar, Database, Lock, Smartphone, CreditCard as Edit, Save, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

export default function ProfilScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [syncEnabled, setSyncEnabled] = React.useState(true);
  const [offlineEnabled, setOfflineEnabled] = React.useState(false);
  const [showEditModal, setShowEditModal] = React.useState(false);
  const [editingField, setEditingField] = React.useState<string | null>(null);
  const [tempValue, setTempValue] = React.useState('');

  const [coordinatorInfo, setCoordinatorInfo] = React.useState({
    name: 'Pierre Dupont',
    role: 'Coordonnateur SPS',
    certification: 'SPS Niveau 2',
    phone: '+33 6 12 34 56 78',
    email: 'pierre.dupont@alphaconcept.fr',
    location: 'Lyon, France',
    memberSince: '2022',
    company: 'Alpha Concept SPS',
  });

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
    } else {
      setTempValue(coordinatorInfo[field as keyof typeof coordinatorInfo] || '');
    }
    setShowEditModal(true);
  };

  const handleSaveField = () => {
    if (!tempValue.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir une valeur');
      return;
    }

    if (editingField === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(tempValue)) {
        Alert.alert('Erreur', 'Veuillez saisir un email valide');
        return;
      }
      setCoordinatorInfo(prev => ({ ...prev, email: tempValue }));
      Alert.alert('Succès', 'Email modifié avec succès');
    } else if (editingField === 'password') {
      if (tempValue.length < 6) {
        Alert.alert('Erreur', 'Le mot de passe doit contenir au moins 6 caractères');
        return;
      }
      Alert.alert('Succès', 'Mot de passe modifié avec succès');
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
      case 'phone': return 'Téléphone';
      case 'email': return 'Adresse email';
      case 'location': return 'Localisation';
      case 'password': return 'Nouveau mot de passe';
      default: return 'Information';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
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
                <Text style={styles.contactText}>{coordinatorInfo.phone}</Text>
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
        <TouchableOpacity style={styles.logoutButton}>
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
      <Modal visible={showEditModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.editModal}>
            <LinearGradient
              colors={['#1E293B', '#374151']}
              style={styles.editModalGradient}
            >
              <View style={styles.editModalHeader}>
                <Text style={styles.editModalTitle}>
                  MODIFIER {getFieldLabel(editingField || '').toUpperCase()}
                </Text>
                <TouchableOpacity
                  style={styles.editModalCloseButton}
                  onPress={handleCancelEdit}
                >
                  <X size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              <View style={styles.editModalContent}>
                <Text style={styles.editInputLabel}>{getFieldLabel(editingField || '')}</Text>
                <View style={styles.editInputContainer}>
                  <TextInput
                    style={styles.editTextInput}
                    placeholder={`Saisir ${getFieldLabel(editingField || '').toLowerCase()}`}
                    placeholderTextColor="#64748B"
                    value={tempValue}
                    onChangeText={setTempValue}
                    secureTextEntry={editingField === 'password'}
                    keyboardType={editingField === 'email' ? 'email-address' : editingField === 'phone' ? 'phone-pad' : 'default'}
                    autoCapitalize={editingField === 'email' ? 'none' : 'words'}
                  />
                </View>
              </View>

              <View style={styles.editModalActions}>
                <TouchableOpacity 
                  style={styles.editCancelButton}
                  onPress={handleCancelEdit}
                >
                  <Text style={styles.editCancelButtonText}>ANNULER</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.editSaveButton}
                  onPress={handleSaveField}
                >
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.editSaveButtonGradient}
                  >
                    <Save size={16} color="#FFFFFF" />
                    <Text style={styles.editSaveButtonText}>ENREGISTRER</Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  editModal: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
  },
  editModalGradient: {
    padding: 24,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  editModalTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  editModalCloseButton: {
    padding: 4,
  },
  editModalContent: {
    marginBottom: 24,
  },
  editInputLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    marginBottom: 8,
  },
  editInputContainer: {
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  editTextInput: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
    minHeight: 24,
  },
  editModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editCancelButton: {
    flex: 1,
    backgroundColor: '#374151',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCancelButtonText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  editSaveButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  editSaveButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  editSaveButtonText: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});