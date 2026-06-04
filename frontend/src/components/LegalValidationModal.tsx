import { useEffect, useState } from 'react';
import { FileText, Loader2, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { currentOrgAPI } from '../lib/api';
import LegalDocumentEditor from './LegalDocumentEditor';

export default function LegalValidationModal() {
  const { profile, organization, refreshProfile } = useAuth();
  const [cguContent, setCguContent] = useState(organization?.cguContent || '');
  const [privacyContent, setPrivacyContent] = useState(organization?.privacyContent || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const mustValidate =
    profile?.role === 'ROLE_ADMIN' &&
    organization?.legalValidationStatus === 'en_cours';

  useEffect(() => {
    if (!mustValidate) return;
    setCguContent(organization?.cguContent || '');
    setPrivacyContent(organization?.privacyContent || '');
    setError('');
  }, [mustValidate, organization?.cguContent, organization?.privacyContent]);

  if (!mustValidate) return null;

  const canSubmit = Boolean(cguContent.trim() && privacyContent.trim() && !saving);

  const submit = async () => {
    if (!canSubmit) {
      setError('Les CGU et la politique de confidentialité sont obligatoires.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await currentOrgAPI.validateLegalDocuments({
        cguContent,
        privacyContent,
      });
      await refreshProfile();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la validation des documents');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-900">
              <FileText className="w-5 h-5 text-prosps-blue" />
              <h2 className="text-lg font-bold truncate">Validation CGU et politique de confidentialité</h2>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {organization?.name} doit valider ces documents avant de continuer.
            </p>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Valider
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-slate-800">CGU</h3>
            <LegalDocumentEditor value={cguContent} onChange={setCguContent} rows={12} />
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-slate-800">Politique de confidentialité</h3>
            <LegalDocumentEditor value={privacyContent} onChange={setPrivacyContent} rows={12} />
          </section>
        </div>
      </div>
    </div>
  );
}
