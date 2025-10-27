import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
  Modal,
  ScrollView
} from 'react-native';
import { Shield, User, Lock, Eye, EyeOff, ArrowRight, X, Phone, Building } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { authService } from '@/services/authService';
import { useAuth } from '@/contexts/AuthContext';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const { login } = useAuth();

  const [registerData, setRegisterData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    company: '',
  });
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.login({ email, password });

      if (response.error) {
        Alert.alert('Erreur de connexion', response.error);
        setLoading(false);
        return;
      }

      if (response.data && response.data.user) {
        await login(response.data.user);
      }
    } catch (error) {
      Alert.alert('Erreur', 'Une erreur est survenue lors de la connexion');
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail) {
      Alert.alert('Erreur', 'Veuillez entrer votre adresse email');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.forgotPassword(forgotEmail);

      if (response.data?.resetToken) {
        setResetToken(response.data.resetToken);
        setShowForgotPasswordModal(false);
        setShowResetPasswordModal(true);
        setLoading(false);
      } else {
        Alert.alert(
          'Email envoyé',
          'Si votre email est enregistré, vous recevrez un lien de réinitialisation.'
        );
        setShowForgotPasswordModal(false);
        setForgotEmail('');
        setLoading(false);
      }
    } catch (error) {
      Alert.alert('Erreur', 'Une erreur est survenue. Veuillez réessayer.');
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword) {
      Alert.alert('Erreur', 'Veuillez entrer un nouveau mot de passe');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Erreur', 'Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.resetPassword(resetToken, newPassword);

      if (response.data) {
        Alert.alert(
          'Succès',
          'Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.',
          [
            {
              text: 'OK',
              onPress: () => {
                setShowResetPasswordModal(false);
                setResetToken('');
                setNewPassword('');
                setForgotEmail('');
              },
            },
          ]
        );
        setLoading(false);
      }
    } catch (error) {
      Alert.alert('Erreur', 'Le lien de réinitialisation est invalide ou expiré.');
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!registerData.email || !registerData.password || !registerData.firstName || !registerData.lastName) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs obligatoires');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.register(registerData);

      if (response.error) {
        Alert.alert('Erreur d\'inscription', response.error);
        setLoading(false);
        return;
      }

      if (response.data) {
        setShowRegisterModal(false);
        setLoading(false);
        Alert.alert(
          'Compte créé',
          'Votre compte a été créé avec succès. Veuillez vous connecter.',
          [
            {
              text: 'OK',
              onPress: () => {
                setEmail(registerData.email);
                setRegisterData({
                  email: '',
                  password: '',
                  firstName: '',
                  lastName: '',
                  phone: '',
                  company: '',
                });
              },
            },
          ]
        );
      }
    } catch (error) {
      Alert.alert('Erreur', 'Une erreur est survenue lors de l\'inscription');
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F172A', '#1E293B']}
        style={styles.backgroundGradient}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardContainer}
        >
          <View style={styles.content}>
            {/* Logo et titre */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <LinearGradient
                  colors={['#3B82F6', '#1D4ED8']}
                  style={styles.logoGradient}
                >
                  <Shield size={32} color="#FFFFFF" strokeWidth={2} />
                </LinearGradient>
              </View>
              <Text style={styles.title}>CSPS COORDINATEUR</Text>
              <Text style={styles.subtitle}>Application mobile pour coordonnateurs SPS</Text>
            </View>

            {/* Formulaire */}
            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.inputGradient}
                >
                  <User size={20} color="#94A3B8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email professionnel"
                    placeholderTextColor="#64748B"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                </LinearGradient>
              </View>

              <View style={styles.inputContainer}>
                <LinearGradient
                  colors={['#1E293B', '#374151']}
                  style={styles.inputGradient}
                >
                  <Lock size={20} color="#94A3B8" style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, styles.passwordInput]}
                    placeholder="Mot de passe"
                    placeholderTextColor="#64748B"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="password"
                  />
                  <TouchableOpacity 
                    style={styles.eyeIcon}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff size={20} color="#94A3B8" />
                    ) : (
                      <Eye size={20} color="#94A3B8" />
                    )}
                  </TouchableOpacity>
                </LinearGradient>
              </View>

              <TouchableOpacity 
                style={styles.loginButton}
                onPress={handleLogin}
                disabled={loading}
              >
                <LinearGradient
                  colors={loading ? ['#64748B', '#475569'] : ['#3B82F6', '#1D4ED8']}
                  style={styles.loginButtonGradient}
                >
                  <Text style={styles.loginButtonText}>
                    {loading ? 'CONNEXION...' : 'SE CONNECTER'}
                  </Text>
                  {!loading && <ArrowRight size={20} color="#FFFFFF" />}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.forgotPasswordButton}
                onPress={() => setShowForgotPasswordModal(true)}
              >
                <Text style={styles.forgotPasswordText}>Mot de passe oublié ?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.createAccountButton}
                onPress={() => setShowRegisterModal(true)}
              >
                <Text style={styles.createAccountText}>
                  Pas encore de compte ? <Text style={styles.createAccountTextBold}>Créer un compte</Text>
                </Text>
              </TouchableOpacity>
            </View>

            {/* Informations de sécurité */}
            <View style={styles.securityInfo}>
              <LinearGradient
                colors={['#10B981', '#059669']}
                style={styles.securityBadge}
              >
                <Shield size={12} color="#FFFFFF" />
                <Text style={styles.securityText}>Connexion sécurisée - Données chiffrées</Text>
              </LinearGradient>
              <Text style={styles.versionText}>Version 1.0.0 - Coordinateur</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>

      <Modal
        visible={showRegisterModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowRegisterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContainer}
          >
            <LinearGradient
              colors={['#0F172A', '#1E293B']}
              style={styles.modalContent}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Créer un compte</Text>
                <TouchableOpacity onPress={() => setShowRegisterModal(false)}>
                  <X size={24} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalForm} showsVerticalScrollIndicator={false}>
                <View style={styles.inputContainer}>
                  <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
                    <User size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Prénom *"
                      placeholderTextColor="#64748B"
                      value={registerData.firstName}
                      onChangeText={(text) => setRegisterData({...registerData, firstName: text})}
                      autoCapitalize="words"
                    />
                  </LinearGradient>
                </View>

                <View style={styles.inputContainer}>
                  <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
                    <User size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Nom *"
                      placeholderTextColor="#64748B"
                      value={registerData.lastName}
                      onChangeText={(text) => setRegisterData({...registerData, lastName: text})}
                      autoCapitalize="words"
                    />
                  </LinearGradient>
                </View>

                <View style={styles.inputContainer}>
                  <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
                    <User size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Email professionnel *"
                      placeholderTextColor="#64748B"
                      value={registerData.email}
                      onChangeText={(text) => setRegisterData({...registerData, email: text})}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                  </LinearGradient>
                </View>

                <View style={styles.inputContainer}>
                  <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
                    <Lock size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, styles.passwordInput]}
                      placeholder="Mot de passe *"
                      placeholderTextColor="#64748B"
                      value={registerData.password}
                      onChangeText={(text) => setRegisterData({...registerData, password: text})}
                      secureTextEntry={!showRegisterPassword}
                      autoComplete="password"
                    />
                    <TouchableOpacity
                      style={styles.eyeIcon}
                      onPress={() => setShowRegisterPassword(!showRegisterPassword)}
                    >
                      {showRegisterPassword ? (
                        <EyeOff size={20} color="#94A3B8" />
                      ) : (
                        <Eye size={20} color="#94A3B8" />
                      )}
                    </TouchableOpacity>
                  </LinearGradient>
                </View>

                <View style={styles.inputContainer}>
                  <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
                    <Phone size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Téléphone"
                      placeholderTextColor="#64748B"
                      value={registerData.phone}
                      onChangeText={(text) => setRegisterData({...registerData, phone: text})}
                      keyboardType="phone-pad"
                    />
                  </LinearGradient>
                </View>

                <View style={styles.inputContainer}>
                  <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
                    <Building size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Entreprise"
                      placeholderTextColor="#64748B"
                      value={registerData.company}
                      onChangeText={(text) => setRegisterData({...registerData, company: text})}
                    />
                  </LinearGradient>
                </View>

                <TouchableOpacity
                  style={styles.registerButton}
                  onPress={handleRegister}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={loading ? ['#64748B', '#475569'] : ['#10B981', '#059669']}
                    style={styles.registerButtonGradient}
                  >
                    <Text style={styles.registerButtonText}>
                      {loading ? 'CRÉATION...' : 'CRÉER MON COMPTE'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <Text style={styles.requiredText}>* Champs obligatoires</Text>
              </ScrollView>
            </LinearGradient>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={showForgotPasswordModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowForgotPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContainer}
          >
            <LinearGradient
              colors={['#0F172A', '#1E293B']}
              style={styles.modalContent}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Mot de passe oublié</Text>
                <TouchableOpacity onPress={() => setShowForgotPasswordModal(false)}>
                  <X size={24} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalForm} showsVerticalScrollIndicator={false}>
                <Text style={styles.forgotPasswordDescription}>
                  Entrez votre adresse email et nous vous enverrons les instructions pour réinitialiser votre mot de passe.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Email *</Text>
                  <View style={styles.inputContainer}>
                    <User size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="exemple@email.com"
                      placeholderTextColor="#64748B"
                      value={forgotEmail}
                      onChangeText={setForgotEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      editable={!loading}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleForgotPassword}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={loading ? ['#64748B', '#475569'] : ['#3B82F6', '#2563EB']}
                    style={styles.submitButtonGradient}
                  >
                    <Text style={styles.submitButtonText}>
                      {loading ? 'ENVOI EN COURS...' : 'ENVOYER'}
                    </Text>
                    {!loading && <ArrowRight size={20} color="#FFFFFF" />}
                  </LinearGradient>
                </TouchableOpacity>
              </ScrollView>
            </LinearGradient>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={showResetPasswordModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowResetPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.modalContainer}
          >
            <LinearGradient
              colors={['#0F172A', '#1E293B']}
              style={styles.modalContent}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Réinitialiser le mot de passe</Text>
                <TouchableOpacity onPress={() => setShowResetPasswordModal(false)}>
                  <X size={24} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalForm} showsVerticalScrollIndicator={false}>
                <Text style={styles.forgotPasswordDescription}>
                  Entrez votre nouveau mot de passe ci-dessous.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Nouveau mot de passe *</Text>
                  <View style={styles.inputContainer}>
                    <Lock size={20} color="#94A3B8" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Minimum 6 caractères"
                      placeholderTextColor="#64748B"
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry={!showNewPassword}
                      autoCapitalize="none"
                      editable={!loading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowNewPassword(!showNewPassword)}
                      style={styles.eyeIcon}
                    >
                      {showNewPassword ? (
                        <Eye size={20} color="#94A3B8" />
                      ) : (
                        <EyeOff size={20} color="#94A3B8" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleResetPassword}
                  disabled={loading}
                >
                  <LinearGradient
                    colors={loading ? ['#64748B', '#475569'] : ['#10B981', '#059669']}
                    style={styles.submitButtonGradient}
                  >
                    <Text style={styles.submitButtonText}>
                      {loading ? 'RÉINITIALISATION...' : 'RÉINITIALISER'}
                    </Text>
                    {!loading && <ArrowRight size={20} color="#FFFFFF" />}
                  </LinearGradient>
                </TouchableOpacity>
              </ScrollView>
            </LinearGradient>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundGradient: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
  },
  logoGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#94A3B8',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  form: {
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  inputGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#FFFFFF',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeIcon: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },
  loginButton: {
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  loginButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    gap: 8,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    letterSpacing: 1,
  },
  forgotPasswordButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  forgotPasswordText: {
    color: '#3B82F6',
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
  forgotPasswordDescription: {
    color: '#94A3B8',
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    lineHeight: 20,
    marginBottom: 24,
  },
  securityInfo: {
    alignItems: 'center',
    gap: 12,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  securityText: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  versionText: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
  },
  createAccountButton: {
    alignItems: 'center',
    marginTop: 24,
  },
  createAccountText: {
    color: '#94A3B8',
    fontSize: 14,
    fontFamily: 'Inter-Regular',
  },
  createAccountTextBold: {
    color: '#10B981',
    fontFamily: 'Inter-SemiBold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  modalContainer: {
    width: '95%',
    maxWidth: 600,
    height: '90%',
  },
  modalContent: {
    flex: 1,
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    color: '#FFFFFF',
  },
  modalForm: {
    flex: 1,
  },
  registerButton: {
    marginTop: 24,
    borderRadius: 16,
    overflow: 'hidden',
  },
  registerButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
  },
  registerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    letterSpacing: 1,
  },
  requiredText: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#64748B',
    textAlign: 'center',
    marginTop: 16,
  },
  submitButton: {
    marginTop: 24,
    borderRadius: 16,
    overflow: 'hidden',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    paddingHorizontal: 32,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    letterSpacing: 1,
  },
});