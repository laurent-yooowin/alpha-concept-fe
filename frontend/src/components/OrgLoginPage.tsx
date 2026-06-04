import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, publicOrgAPI } from '../lib/api';
import { Lock, Mail, AlertCircle, Eye, EyeOff, Loader2, ArrowLeft, CheckCircle } from 'lucide-react';

interface OrgBranding {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  backgroundImageUrl?: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  loginTitle?: string | null;
  loginContent?: string | null;
}

const ORG_BRANDING_CACHE_TTL_MS = 5 * 60 * 1000;
const orgBrandingCache = new Map<string, { data: OrgBranding; fetchedAt: number }>();

export default function OrgLoginPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { signIn, signOut, user, organization, loading: authLoading } = useAuth();

  const [org, setOrg] = useState<OrgBranding | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [otpStep, setOtpStep] = useState<'email' | 'code' | 'newPassword' | 'success'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    const normalizedSlug = slug.trim();
    const cachedEntry = orgBrandingCache.get(normalizedSlug);
    const cachedOrg =
      cachedEntry && Date.now() - cachedEntry.fetchedAt < ORG_BRANDING_CACHE_TTL_MS
        ? cachedEntry.data
        : null;
    const controller = new AbortController();

    setOrgError('');
    setOrg(cachedOrg || null);
    setOrgLoading(!cachedOrg);

    if (!normalizedSlug) {
      setOrgError('Organisation introuvable');
      setOrgLoading(false);
      return () => controller.abort();
    }

    if (cachedOrg) {
      return () => controller.abort();
    }

    publicOrgAPI
      .getBySlug(normalizedSlug, { signal: controller.signal })
      .then((data) => {
        orgBrandingCache.set(normalizedSlug, { data, fetchedAt: Date.now() });
        setOrg(data);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setOrgError('Organisation introuvable');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrgLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  useEffect(() => {
    if (authLoading || !user) return;

    if (user.role === 'ROLE_HYPER_ADMIN') {
      navigate('/hyper-admin', { replace: true });
      return;
    }

    if (!organization) return;

    if (organization.slug === slug) {
      navigate(`/${slug}/dashboard`, { replace: true });
      return;
    }

    signOut();
  }, [authLoading, user, organization, navigate, signOut, slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn(email, password, slug);
    if (error) {
      setError(error.message || 'Identifiants incorrects.');
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!forgotEmail) {
      setForgotError('Veuillez entrer votre adresse email');
      return;
    }
    setForgotError('');
    setForgotLoading(true);
    try {
      await authAPI.forgotPassword(forgotEmail);
      setOtpCode('');
      setOtpStep('code');
    } catch {
      setForgotError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setForgotError('Veuillez entrer le code à 6 chiffres');
      return;
    }
    setForgotError('');
    setForgotLoading(true);
    try {
      const response = await authAPI.verifyCode(forgotEmail, otpCode);
      if (response.resetToken) {
        setResetToken(response.resetToken);
        setOtpStep('newPassword');
      }
    } catch (err: any) {
      setForgotError(err?.message || 'Code invalide ou expiré');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword) {
      setForgotError('Veuillez entrer un nouveau mot de passe');
      return;
    }
    if (newPassword !== confirmPassword) {
      setForgotError('Les mots de passe ne correspondent pas');
      return;
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!_.\-]{6,16}$/;
    if (!passwordRegex.test(newPassword)) {
      setForgotError('Le mot de passe doit contenir entre 6 et 16 caractères, une majuscule, une minuscule et un chiffre');
      return;
    }
    setForgotError('');
    setForgotLoading(true);
    try {
      await authAPI.resetPassword(resetToken, newPassword);
      setOtpStep('success');
    } catch {
      setForgotError('Token invalide ou expiré. Veuillez recommencer.');
    } finally {
      setForgotLoading(false);
    }
  };

  const openForgotPassword = () => {
    setForgotEmail(email);
    setForgotError('');
    setShowForgotPassword(true);
  };

  const closeForgotPassword = () => {
    setShowForgotPassword(false);
    setOtpStep('email');
    setForgotEmail('');
    setOtpCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setForgotError('');
  };

  if (orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    );
  }

  if (orgError || !org) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <h1 className="text-xl font-bold text-slate-900">Organisation introuvable</h1>
        <p className="text-slate-600">L'URL <code>/{slug}/login</code> ne correspond à aucune organisation active.</p>
        <button onClick={() => navigate('/login')} className="mt-2 text-blue-600 hover:underline">
          Aller au portail principal
        </button>
      </div>
    );
  }

  const primary = org.primaryColor || '#1e40af';
  const secondary = org.secondaryColor || '#0f172a';
  const bgGradient = `linear-gradient(135deg, ${secondary} 0%, ${primary} 100%)`;
  const hasBg = !!org.backgroundImageUrl;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left side – branding */}
      <div className="lg:w-1/2 flex flex-col text-white relative" style={{ background: bgGradient }}>
        {hasBg ? (
          <>
            {/* Top half: background image */}
            <div
              className="flex-1 min-h-[40vh] lg:min-h-0 bg-center bg-contain bg-no-repeat m-4"
              style={{ backgroundImage: `url(${org.backgroundImageUrl})` }}
            />
            {/* Bottom half: title + content */}
            <div className="flex-1 flex items-center justify-center p-10">
              <div className="text-center lg:text-left" style={{ maxWidth: '60%' }}>
                <h1 className="text-4xl font-bold mb-3">
                  {org.loginTitle || 'Portail de connexion'}
                </h1>
                {org.loginContent && (
                  <p className="text-white/90 text-base whitespace-pre-line">{org.loginContent}</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-10">
              <div className="text-center lg:text-left" style={{ maxWidth: '60%' }}>
              <h1 className="text-4xl font-bold mb-3">
                {org.loginTitle || 'Portail de connexion'}
              </h1>
              {org.loginContent && (
                <p className="text-white/90 text-base whitespace-pre-line">{org.loginContent}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right side – login form */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            {showForgotPassword ? (
              <>
                <button
                  type="button"
                  onClick={closeForgotPassword}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-sm">Retour à la connexion</span>
                </button>

                <div className="text-center mb-6">
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    {otpStep === 'email' && 'Mot de passe oublié'}
                    {otpStep === 'code' && 'Vérification du code'}
                    {otpStep === 'newPassword' && 'Nouveau mot de passe'}
                    {otpStep === 'success' && 'Mot de passe réinitialisé'}
                  </h2>
                  {otpStep !== 'success' && (
                    <p className="text-sm text-slate-600">
                      Le code de vérification expire dans 15 minutes.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-center gap-1 mb-8">
                  {['email', 'code', 'newPassword'].map((step, index) => {
                    const steps = ['email', 'code', 'newPassword'];
                    const currentIndex = steps.indexOf(otpStep === 'success' ? 'newPassword' : otpStep);
                    return (
                      <div key={step} className="flex items-center">
                        <div
                          className={`w-3 h-3 rounded-full transition-colors ${
                            currentIndex > index ? 'bg-green-500' : currentIndex === index ? 'bg-blue-600' : 'bg-slate-300'
                          }`}
                        />
                        {index < 2 && (
                          <div className={`w-10 h-0.5 transition-colors ${currentIndex > index ? 'bg-green-500' : 'bg-slate-300'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>

                {forgotError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{forgotError}</p>
                  </div>
                )}

                {otpStep === 'email' && (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-600">
                      Entrez votre adresse email. Nous vous enverrons un code de vérification.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                          type="email"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg outline-none focus:ring-2"
                          style={{ ['--tw-ring-color' as any]: primary }}
                          placeholder="votre@email.com"
                          disabled={forgotLoading}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={forgotLoading}
                      className="w-full text-white py-3 rounded-lg font-medium transition-opacity disabled:opacity-50 hover:opacity-90"
                      style={{ backgroundColor: primary }}
                    >
                      {forgotLoading ? 'Envoi...' : 'Envoyer le code'}
                    </button>
                  </div>
                )}

                {otpStep === 'code' && (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-600">
                      Un code à 6 chiffres a été envoyé à <strong>{forgotEmail}</strong>.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Code de vérification</label>
                      <input
                        type="text"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                        className="w-full text-center text-2xl tracking-[0.5em] px-4 py-3 border border-slate-300 rounded-lg outline-none focus:ring-2 font-mono"
                        style={{ ['--tw-ring-color' as any]: primary }}
                        placeholder="000000"
                        maxLength={6}
                        disabled={forgotLoading}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyCode}
                      disabled={forgotLoading}
                      className="w-full text-white py-3 rounded-lg font-medium transition-opacity disabled:opacity-50 hover:opacity-90"
                      style={{ backgroundColor: primary }}
                    >
                      {forgotLoading ? 'Vérification...' : 'Vérifier le code'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={forgotLoading}
                      className="w-full text-sm hover:underline"
                      style={{ color: primary }}
                    >
                      Renvoyer le code
                    </button>
                  </div>
                )}

                {otpStep === 'newPassword' && (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-600">
                      Entrez votre nouveau mot de passe (6-16 caractères, majuscule, minuscule, chiffre).
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Nouveau mot de passe</label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full px-4 py-3 pr-10 border border-slate-300 rounded-lg outline-none focus:ring-2"
                          style={{ ['--tw-ring-color' as any]: primary }}
                          placeholder="••••••••"
                          disabled={forgotLoading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                        >
                          {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Confirmer le mot de passe</label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full px-4 py-3 pr-10 border border-slate-300 rounded-lg outline-none focus:ring-2"
                          style={{ ['--tw-ring-color' as any]: primary }}
                          placeholder="••••••••"
                          disabled={forgotLoading}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                        >
                          {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetPassword}
                      disabled={forgotLoading}
                      className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {forgotLoading ? 'Réinitialisation...' : 'Réinitialiser le mot de passe'}
                    </button>
                  </div>
                )}

                {otpStep === 'success' && (
                  <div className="text-center space-y-4">
                    <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                    <p className="text-slate-700">Votre mot de passe a été réinitialisé avec succès.</p>
                    <button
                      type="button"
                      onClick={closeForgotPassword}
                      className="w-full text-white py-3 rounded-lg font-medium transition-opacity hover:opacity-90"
                      style={{ backgroundColor: primary }}
                    >
                      Se connecter
                    </button>
                  </div>
                )}
              </>
            ) : (
            <>
            {/* <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">{org.name}</h2> */}
            <div className="flex lg:justify-center justify-center mb-8">
              {org.logoUrl ? (
                <img src={org.logoUrl} alt={org.name} className="h-24 object-contain" />
              ) : (
                <div
                  className="w-24 h-24 rounded-full flex items-center justify-center bg-white/20 text-white text-3xl font-bold"
                >
                  {org.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg outline-none focus:ring-2"
                    style={{ ['--tw-ring-color' as any]: primary }}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Mot de passe</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-10 py-3 border border-slate-300 rounded-lg outline-none focus:ring-2"
                    required
                    minLength={6}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full text-white py-3 rounded-lg font-medium transition-opacity disabled:opacity-50 hover:opacity-90"
                style={{ backgroundColor: primary }}
              >
                {loading ? 'Connexion...' : 'Se connecter'}
              </button>
            </form>
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={openForgotPassword}
                className="text-sm hover:underline"
                style={{ color: primary }}
              >
                Mot de passe oublié ?
              </button>
            </div>
            </>
            )}
          </div>
          <p className="text-center text-sm text-slate-500 mt-6">Système sécurisé conforme RGPD</p>
        </div>
      </div>
    </div>
  );
}
