import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  ImageBackground,
  Dimensions,
  Modal,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Shield, User, Lock, Eye, EyeOff, ArrowRight, X, Info } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SvgUri } from 'react-native-svg';
import { authService } from '@/services/authService';
import { useAuth } from '@/contexts/AuthContext';
import { organizationService, OrganizationBranding } from '@/services/organizationService';
import {
  DEFAULT_ORG_SLUG,
  getStoredOrganizationSlug,
  normalizeOrgSlug,
  persistOrganizationSlug,
} from '@/services/organizationContext';
import { useLocalSearchParams } from 'expo-router';

const { width } = Dimensions.get('window');

type OrganizationSwitchTarget = {
  id?: string;
  name?: string;
  slug?: string;
};

export default function LoginScreen() {
  const params = useLocalSearchParams<{ organizationSlug?: string; slug?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [organizationSlug, setOrganizationSlug] = useState(DEFAULT_ORG_SLUG);
  const [organization, setOrganization] = useState<OrganizationBranding | null>(null);
  const [organizationLoading, setOrganizationLoading] = useState(true);
  const [showOrganizationInfo, setShowOrganizationInfo] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const { login } = useAuth();

  // Forgot password flow states
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [otpStep, setOtpStep] = useState<'email' | 'code' | 'newPassword'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const loadOrganization = async (slug: string, shouldPersist = true) => {
    setOrganizationSlug(slug);
    setOrganizationLoading(true);

    const response = await organizationService.getPublicBySlug(slug);

    if (response.data) {
      setOrganization(response.data);
      setOrganizationSlug(response.data.slug);
      setLogoLoadFailed(false);
      if (shouldPersist) {
        await persistOrganizationSlug(response.data.slug);
      }
    } else {
      setOrganization(null);
      setLogoLoadFailed(false);
    }

    setOrganizationLoading(false);
    return response.data;
  };

  useEffect(() => {
    let mounted = true;

    const resolveOrganization = async () => {
      const routeSlug = normalizeOrgSlug(params.organizationSlug || params.slug);
      const storedSlug = await getStoredOrganizationSlug();
      const nextSlug = routeSlug || storedSlug || DEFAULT_ORG_SLUG;

      if (!mounted) return;
      setOrganizationLoading(true);
      const response = await organizationService.getPublicBySlug(nextSlug);
      if (!mounted) return;

      if (response.data) {
        setOrganization(response.data);
        await persistOrganizationSlug(response.data.slug);
        setOrganizationSlug(response.data.slug);
        setLogoLoadFailed(false);
      } else {
        setOrganization(null);
        setLogoLoadFailed(false);
      }
      setOrganizationLoading(false);
    };

    resolveOrganization();

    return () => {
      mounted = false;
    };
  }, [params.organizationSlug, params.slug]);

  const getOrganizationSwitchTarget = (response: any): OrganizationSwitchTarget | null => {
    const details = response?.details || {};
    const nested = details?.message && typeof details.message === 'object' ? details.message : {};
    const code = details?.code || nested?.code;
    const target = details?.organization || nested?.organization;

    if (code !== 'ORG_MISMATCH' || !target?.slug) {
      return null;
    }

    return target;
  };

  const continueLoginWithOrganization = async (targetSlug: string) => {
    setLoading(true);

    try {
      const normalizedTargetSlug = normalizeOrgSlug(targetSlug);
      await persistOrganizationSlug(normalizedTargetSlug);
      await loadOrganization(normalizedTargetSlug);

      const response = await authService.login({
        email,
        password,
        organizationSlug: normalizedTargetSlug,
      });

      if (response.error) {
        Alert.alert('Erreur de connexion', `${response.error}\n\nOrganisation: ${normalizedTargetSlug}`);
        setLoading(false);
        return;
      }

      if (response.data?.user) {
        await login(response.data.user);
      }
    } catch (error) {
      Alert.alert('Erreur', 'Une erreur est survenue lors de la connexion');
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }

    setLoading(true);

    try {
      const response = await authService.login({ email, password, organizationSlug });

      if (response.error) {
        const switchTarget = getOrganizationSwitchTarget(response);
        if (switchTarget?.slug) {
          setLoading(false);
          Alert.alert(
            "Changer d'organisation",
            `Ce compte appartient à ${switchTarget.name || switchTarget.slug}. Voulez-vous basculer vers cette organisation et continuer la connexion ?`,
            [
              { text: 'Annuler', style: 'cancel' },
              {
                text: 'Continuer',
                onPress: () => continueLoginWithOrganization(switchTarget.slug as string),
              },
            ],
          );
          return;
        }

        Alert.alert('Erreur de connexion', `${response.error}\n\nOrganisation: ${organizationSlug}`);
        setLoading(false);
        return;
      }

      if (response.data && response.data.user) {
        await persistOrganizationSlug(response.data.user.organizationSlug || organizationSlug);
        await login(response.data.user);
      }
    } catch (error) {
      Alert.alert('Erreur', 'Une erreur est survenue lors de la connexion');
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!forgotEmail) {
      Alert.alert('Erreur', 'Veuillez entrer votre adresse email');
      return;
    }

    setLoading(true);
    try {
      await authService.forgotPassword(forgotEmail);
      setOtpStep('code');
      Alert.alert('Code envoyé', 'Un code de vérification a été envoyé à votre adresse email.');
    } catch (error) {
      Alert.alert('Erreur', 'Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!otpCode || otpCode.length !== 6) {
      Alert.alert('Erreur', 'Veuillez entrer le code à 6 chiffres');
      return;
    }

    setLoading(true);
    try {
      const response = await authService.verifyCode(forgotEmail, otpCode);

      if (response.error) {
        Alert.alert('Erreur', response.error);
      } else if (response.data?.resetToken) {
        setResetToken(response.data.resetToken);
        setOtpStep('newPassword');
      }
    } catch (error: any) {
      Alert.alert('Erreur', error?.message || 'Code invalide ou expiré');
    } finally {
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

    if (newPassword !== confirmPassword) {
      Alert.alert('Erreur', 'Les mots de passe ne correspondent pas');
      return;
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!_.\-]{6,16}$/;
    if (!passwordRegex.test(newPassword)) {
      Alert.alert('Erreur', 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre (6-16 caractères)');
      return;
    }

    setLoading(true);
    try {
      const response = await authService.resetPassword(resetToken, newPassword);

      if (response.data) {
        Alert.alert(
          'Succès',
          'Votre mot de passe a été réinitialisé avec succès.',
          [{ text: 'OK', onPress: () => closeForgotPasswordModal() }]
        );
      }
    } catch (error) {
      Alert.alert('Erreur', 'Le lien de réinitialisation est invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  };

  const closeForgotPasswordModal = () => {
    setShowForgotPasswordModal(false);
    setOtpStep('email');
    setForgotEmail('');
    setOtpCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const renderForgotPasswordContent = () => {
    if (otpStep === 'email') {
      return (
        <>
          <Text style={styles.forgotPasswordDescription}>
            Entrez votre adresse email. Nous vous enverrons un code de vérification.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email *</Text>
            <View style={styles.inputContainer}>
              <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
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
              </LinearGradient>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSendCode}
            disabled={loading}
          >
            <LinearGradient
              colors={loading ? ['#64748B', '#475569'] : ['#3B82F6', '#2563EB']}
              style={styles.submitButtonGradient}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.submitButtonText}>ENVOYER LE CODE</Text>
                  <ArrowRight size={20} color="#FFFFFF" />
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </>
      );
    }

    if (otpStep === 'code') {
      return (
        <>
          <Text style={styles.forgotPasswordDescription}>
            Un code à 6 chiffres a été envoyé à {forgotEmail}. Entrez-le ci-dessous.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Code de vérification *</Text>
            <View style={styles.inputContainer}>
              <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
                <Shield size={20} color="#94A3B8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { letterSpacing: 8, fontSize: 24, textAlign: 'center' }]}
                  placeholder="000000"
                  placeholderTextColor="#64748B"
                  value={otpCode}
                  onChangeText={(text) => setOtpCode(text.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!loading}
                />
              </LinearGradient>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleVerifyCode}
            disabled={loading}
          >
            <LinearGradient
              colors={loading ? ['#64748B', '#475569'] : ['#3B82F6', '#2563EB']}
              style={styles.submitButtonGradient}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.submitButtonText}>VÉRIFIER LE CODE</Text>
                  <ArrowRight size={20} color="#FFFFFF" />
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ alignItems: 'center', marginTop: 16 }}
            onPress={handleSendCode}
            disabled={loading}
          >
            <Text style={{ color: '#3B82F6', fontSize: 14, fontFamily: 'Inter-Medium' }}>
              Renvoyer le code
            </Text>
          </TouchableOpacity>
        </>
      );
    }

    // newPassword step
    return (
      <>
        <Text style={styles.forgotPasswordDescription}>
          Entrez votre nouveau mot de passe. Il doit contenir au moins une majuscule, une minuscule et un chiffre (6-16 caractères).
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nouveau mot de passe *</Text>
          <View style={styles.inputContainer}>
            <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
              <Lock size={20} color="#94A3B8" style={styles.inputIcon} />
              <TextInput
                style={[styles.input, styles.passwordInput]}
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
                {showNewPassword ? <Eye size={20} color="#94A3B8" /> : <EyeOff size={20} color="#94A3B8" />}
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Confirmer le mot de passe *</Text>
          <View style={styles.inputContainer}>
            <LinearGradient colors={['#1E293B', '#374151']} style={styles.inputGradient}>
              <Lock size={20} color="#94A3B8" style={styles.inputIcon} />
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Confirmer le mot de passe"
                placeholderTextColor="#64748B"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                editable={!loading}
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.eyeIcon}
              >
                {showConfirmPassword ? <Eye size={20} color="#94A3B8" /> : <EyeOff size={20} color="#94A3B8" />}
              </TouchableOpacity>
            </LinearGradient>
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
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.submitButtonText}>RÉINITIALISER</Text>
                <ArrowRight size={20} color="#FFFFFF" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </>
    );
  };

  const renderOrganizationLogo = () => {
    const logoUrl = organization?.logoUrl;
    const shouldUseRemoteLogo = !!logoUrl && !logoLoadFailed;
    const isSvgLogo = shouldUseRemoteLogo && logoUrl.split('?')[0].toLowerCase().endsWith('.svg');

    if (isSvgLogo) {
      return (
        <SvgUri
          uri={logoUrl}
          width="100%"
          height="100%"
          onError={() => setLogoLoadFailed(true)}
        />
      );
    }

    return (
      <Image
        key={shouldUseRemoteLogo ? logoUrl : 'default-logo'}
        source={
          shouldUseRemoteLogo
            ? { uri: logoUrl }
            : require('../../assets/images/logo_admin.png')
        }
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        onError={() => {
          if (shouldUseRemoteLogo) {
            setLogoLoadFailed(true);
          }
        }}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient
        colors={['#0F172A', '#1E293B']}
        style={styles.backgroundGradient}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardContainer}
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                {renderOrganizationLogo()}
              </View>
              <View style={styles.organizationRow}>
                <Text style={styles.organizationName}>
                  {organizationLoading ? 'Chargement...' : organization?.name || organizationSlug}
                </Text>
                <TouchableOpacity
                  style={styles.infoButton}
                  onPress={() => setShowOrganizationInfo(true)}
                  disabled={organizationLoading}
                >
                  <Info size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>

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
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Text style={styles.loginButtonText}>SE CONNECTER</Text>
                      <ArrowRight size={20} color="#FFFFFF" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.forgotPasswordButton}
                onPress={() => setShowForgotPasswordModal(true)}
              >
                <Text style={styles.forgotPasswordText}>Mot de passe oublié ?</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.securityInfo}>
              <LinearGradient
                colors={['#10B981', '#059669']}
                style={styles.securityBadge}
              >
                <Shield size={12} color="#FFFFFF" />
                <Text style={styles.securityText}>Connexion sécurisée - Données chiffrées</Text>
              </LinearGradient>
              <Text style={styles.versionText}>Version 1.0.0 - Coordonnateur</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>

      <Modal
        visible={showOrganizationInfo}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowOrganizationInfo(false)}
      >
        <View style={styles.infoModalOverlay}>
          <View style={styles.infoModalContent}>
            {organization?.backgroundImageUrl ? (
              <ImageBackground
                source={{ uri: organization.backgroundImageUrl }}
                style={styles.infoBackground}
                imageStyle={styles.infoBackgroundImage}
              >
                <View style={styles.infoBackgroundScrim} />
              </ImageBackground>
            ) : (
              <LinearGradient
                colors={['#1E293B', '#334155']}
                style={styles.infoBackground}
              />
            )}

            <TouchableOpacity
              style={styles.infoCloseButton}
              onPress={() => setShowOrganizationInfo(false)}
            >
              <X size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.infoTextPanel}>
              <Text style={styles.infoTitle}>
                {organization?.loginTitle || organization?.name || 'Report BTP'}
              </Text>
              <Text style={styles.infoDescription}>
                {organization?.loginContent || 'Application mobile pour coordonnateurs SPS'}
              </Text>
              <Text style={styles.infoOrganizationSlug}>
                {organization?.slug || organizationSlug}
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Forgot Password Modal with OTP flow */}
      <Modal
        visible={showForgotPasswordModal}
        animationType="slide"
        transparent={true}
        onRequestClose={closeForgotPasswordModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalOverlay}>
            <LinearGradient
              colors={['#0F172A', '#1E293B']}
              style={styles.modalContent}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {otpStep === 'email' && 'Mot de passe oublié'}
                  {otpStep === 'code' && 'Vérification'}
                  {otpStep === 'newPassword' && 'Nouveau mot de passe'}
                </Text>
                <TouchableOpacity onPress={closeForgotPasswordModal}>
                  <X size={24} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              {/* Step indicator */}
              <View style={styles.stepIndicator}>
                {['email', 'code', 'newPassword'].map((step, index) => (
                  <View key={step} style={styles.stepRow}>
                    <View style={[
                      styles.stepDot,
                      otpStep === step && styles.stepDotActive,
                      (['email', 'code', 'newPassword'].indexOf(otpStep) > index) && styles.stepDotDone,
                    ]} />
                    {index < 2 && (
                      <View style={[
                        styles.stepLine,
                        (['email', 'code', 'newPassword'].indexOf(otpStep) > index) && styles.stepLineDone,
                      ]} />
                    )}
                  </View>
                ))}
              </View>

              <ScrollView style={styles.modalForm} showsVerticalScrollIndicator={false}>
                {renderForgotPasswordContent()}
              </ScrollView>
            </LinearGradient>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backgroundGradient: { flex: 1 },
  keyboardContainer: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 48 },
  logoContainer: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden', marginBottom: 16 },
  organizationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  organizationName: { maxWidth: width - 96, fontSize: 16, fontFamily: 'Inter-Bold', color: '#FFFFFF', textAlign: 'center' },
  infoButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B82F6' },
  form: { marginBottom: 32 },
  inputContainer: { marginBottom: 16, borderRadius: 16, overflow: 'hidden' },
  inputGradient: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 56 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, fontFamily: 'Inter-Regular', color: '#FFFFFF' },
  passwordInput: { paddingRight: 48 },
  eyeIcon: { position: 'absolute', right: 16, padding: 4 },
  loginButton: { marginTop: 8, borderRadius: 16, overflow: 'hidden' },
  loginButtonGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, gap: 8 },
  loginButtonText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter-Bold', letterSpacing: 1 },
  forgotPasswordButton: { alignItems: 'center', marginTop: 16 },
  forgotPasswordText: { color: '#3B82F6', fontSize: 14, fontFamily: 'Inter-Medium' },
  forgotPasswordDescription: { color: '#94A3B8', fontSize: 14, fontFamily: 'Inter-Regular', lineHeight: 20, marginBottom: 24 },
  securityInfo: { alignItems: 'center', gap: 12 },
  securityBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, gap: 6 },
  securityText: { fontSize: 11, fontFamily: 'Inter-SemiBold', color: '#FFFFFF', letterSpacing: 0.5 },
  versionText: { fontSize: 12, fontFamily: 'Inter-Regular', color: '#64748B' },
  infoModalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.76)', justifyContent: 'center', paddingHorizontal: 20 },
  infoModalContent: { minHeight: 360, borderRadius: 20, overflow: 'hidden', backgroundColor: '#0F172A' },
  infoBackground: { height: 180, width: '100%' },
  infoBackgroundImage: { resizeMode: 'cover' },
  infoBackgroundScrim: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  infoCloseButton: { position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.75)' },
  infoTextPanel: { padding: 20 },
  infoTitle: { fontSize: 22, fontFamily: 'Inter-Bold', color: '#FFFFFF', marginBottom: 10 },
  infoDescription: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#CBD5E1', lineHeight: 21 },
  infoOrganizationSlug: { marginTop: 16, fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#60A5FA' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.8)', justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  modalContainer: { width: '95%', maxWidth: 600, height: '90%' },
  modalContent: { flex: 1, borderRadius: 24, paddingTop: 24, paddingBottom: 40, paddingHorizontal: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 24, fontFamily: 'Inter-Bold', color: '#FFFFFF' },
  modalForm: { flex: 1 },
  inputGroup: { marginBottom: 16 },
  label: { color: '#94A3B8', fontSize: 14, fontFamily: 'Inter-Medium', marginBottom: 8 },
  submitButton: { marginTop: 24, borderRadius: 16, overflow: 'hidden' },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, paddingHorizontal: 32 },
  submitButtonText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter-Bold', letterSpacing: 1 },
  stepIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#374151', borderWidth: 2, borderColor: '#475569' },
  stepDotActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  stepDotDone: { backgroundColor: '#10B981', borderColor: '#10B981' },
  stepLine: { width: 40, height: 2, backgroundColor: '#374151' },
  stepLineDone: { backgroundColor: '#10B981' },
});
