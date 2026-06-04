import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../lib/api';
import { Mail, AlertCircle, Eye, EyeOff, ArrowLeft, CheckCircle } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signOut, user } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password states
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
    if (!user) {
      try {
        const savedSlug = localStorage.getItem('lastOrgSlug')?.trim();
        if (savedSlug) {
          navigate(`/${savedSlug}/login`, { replace: true });
          return;
        }
      } catch {}
    }

    if (user) {
      if (user.role === 'ROLE_HYPER_ADMIN') {
        navigate('/hyper-admin');
      } else {
        signOut();
      }
    }
  }, [user, navigate, signOut]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await signIn(email, password, undefined, { hyperAdminOnly: true });

    if (error) {
      if (error.message === 'User account is inactive') {
        setError("Votre compte est inactif. Veuillez contacter l'administrateur.");
      } else if (error.message) {
        setError(error.message);
      } else {
        setError('Identifiants incorrects. Veuillez réessayer.');
      }
      setLoading(false);
    } else {
      // navigation handled by useEffect on user change
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
      setOtpStep('code');
    } catch (err) {
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
    if (newPassword.length < 6) {
      setForgotError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }
    if (newPassword !== confirmPassword) {
      setForgotError('Les mots de passe ne correspondent pas');
      return;
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!_.\-]{6,16}$/;
    if (!passwordRegex.test(newPassword)) {
      setForgotError('Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre (6-16 caractères)');
      return;
    }

    setForgotError('');
    setForgotLoading(true);
    try {
      await authAPI.resetPassword(resetToken, newPassword);
      setOtpStep('success');
    } catch (err) {
      setForgotError('Token invalide ou expiré. Veuillez recommencer.');
    } finally {
      setForgotLoading(false);
    }
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

  if (showForgotPassword) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/alpha_background2.jpg')" }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/80 via-prosps-blue-dark/70 to-prosps-blue/60"></div>
        </div>
        <div className="w-full max-w-md relative z-10">
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
            <button
              onClick={closeForgotPassword}
              className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Retour à la connexion</span>
            </button>

            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-slate-900 mb-2">
                {otpStep === 'email' && 'Mot de passe oublié'}
                {otpStep === 'code' && 'Vérification du code'}
                {otpStep === 'newPassword' && 'Nouveau mot de passe'}
                {otpStep === 'success' && 'Mot de passe réinitialisé'}
              </h1>
              {otpStep !== 'success' && (
                <p className="text-sm text-slate-600">
                  Le code de vérification expire dans 15 minutes.
                </p>
              )}
            </div>

            {/* Step indicator */}
            <div className="flex items-center justify-center gap-1 mb-8">
              {['email', 'code', 'newPassword'].map((step, index) => {
                const steps = ['email', 'code', 'newPassword'];
                const currentIndex = steps.indexOf(otpStep === 'success' ? 'newPassword' : otpStep);
                return (
                  <div key={step} className="flex items-center">
                    <div className={`w-3 h-3 rounded-full transition-colors ${
                      currentIndex > index ? 'bg-green-500' :
                      currentIndex === index ? 'bg-blue-600' :
                      'bg-slate-300'
                    }`} />
                    {index < 2 && (
                      <div className={`w-10 h-0.5 transition-colors ${
                        currentIndex > index ? 'bg-green-500' : 'bg-slate-300'
                      }`} />
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
                  Entrez votre adresse email. Nous vous enverrons un code de vérification valable 15 minutes.
                </p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent transition-all outline-none"
                      placeholder="votre@email.com"
                      disabled={forgotLoading}
                    />
                  </div>
                </div>
                <button
                  onClick={handleSendCode}
                  disabled={forgotLoading}
                  className="w-full bg-prosps-blue text-white py-3 rounded-lg font-medium hover:bg-prosps-blue-dark transition-colors disabled:opacity-50"
                >
                  {forgotLoading ? 'Envoi en cours...' : 'Envoyer le code'}
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
                    className="w-full text-center text-2xl tracking-[0.5em] px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent transition-all outline-none font-mono"
                    placeholder="000000"
                    maxLength={6}
                    disabled={forgotLoading}
                  />
                </div>
                <button
                  onClick={handleVerifyCode}
                  disabled={forgotLoading}
                  className="w-full bg-prosps-blue text-white py-3 rounded-lg font-medium hover:bg-prosps-blue-dark transition-colors disabled:opacity-50"
                >
                  {forgotLoading ? 'Vérification...' : 'Vérifier le code'}
                </button>
                <button
                  onClick={handleSendCode}
                  disabled={forgotLoading}
                  className="w-full text-prosps-blue text-sm hover:underline"
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
                      className="w-full px-4 py-3 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
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
                      className="w-full px-4 py-3 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
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
                  onClick={closeForgotPassword}
                  className="w-full bg-prosps-blue text-white py-3 rounded-lg font-medium hover:bg-prosps-blue-dark transition-colors"
                >
                  Se connecter
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/alpha_background2.jpg')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/80 via-prosps-blue-dark/70 to-prosps-blue/60"></div>
      </div>
      <div className="w-full max-w-md relative z-10">
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              <img src="/logo_new.png" alt="Report BTP" className="h-40" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Hyper Administration</h1>
            <p className="text-slate-600">Portail ReportBTP</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent transition-all outline-none"
                  placeholder="votre@email.com"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="relative">
              <label className="block text-sm font-medium text-slate-700 mb-2">Mot de passe</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 pr-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                style={{ top: '3rem' }}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-prosps-blue text-white py-3 rounded-lg font-medium hover:bg-prosps-blue-dark active:bg-prosps-blue-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => setShowForgotPassword(true)}
              className="text-prosps-blue text-sm hover:underline"
            >
              Mot de passe oublié ?
            </button>
          </div>
        </div>

        <p className="text-center text-sm text-white drop-shadow-lg mt-6">
          Système sécurisé conforme RGPD
        </p>
      </div>
    </div>
  );
}
