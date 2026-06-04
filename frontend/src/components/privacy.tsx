import { useEffect, useState } from 'react';
import { Edit2, Loader2, Save, X } from 'lucide-react';
import { type Organization, useAuth } from '../contexts/AuthContext';
import { currentOrgAPI, organizationsAPI } from '../lib/api';
import LegalDocumentEditor, { LegalDocumentView } from './LegalDocumentEditor';
import Swal from 'sweetalert2';

const DEFAULT_PRIVACY = `**Éditeur :** Yooowin
**Adresse :** 5 rue du Banquier, 75013 Paris
**Email :** toufik@yooowin.com

## 1. Objet
Cette Politique décrit les pratiques de Yooowin concernant la collecte, l'utilisation et la protection des données personnelles des utilisateurs.

## 2. Données collectées
- Données fournies : email, photos, notes
- Données techniques : logs, modèle appareil
- Géolocalisation si activée

## 3. Finalités
- Fonctionnement de l'application
- Génération de rapports
- Sécurité
- Assistance
- Amélioration du service

## 4. Base légale
- Exécution du contrat
- Consentement
- Intérêt légitime

## 5. Partage des données
Sous-traitants techniques, destinataires choisis par l'utilisateur, obligations légales. Aucune vente de données.

## 6. Stockage et durée
Conservation tant que le compte est actif. Suppression possible à tout moment.

## 7. Sécurité
Chiffrement, serveurs sécurisés, mots de passe hachés, contrôles d'accès.

## 8. Droits RGPD
Accès, rectification, effacement, opposition, portabilité. Contact : toufik@yooowin.com

## 9. Permissions
- Caméra
- Fichiers
- Internet
- Notifications
- Géolocalisation optionnelle

## 10. Mineurs
Application non destinée aux mineurs.

## 11. Transferts hors UE
Encadrés par les clauses contractuelles types ou solutions conformes RGPD.

## 12. Modifications
La Politique peut être mise à jour. Les utilisateurs seront informés des changements majeurs.

## 13. Contact
toufik@yooowin.com - Yooowin, 5 rue du Banquier, 75013 Paris`;

const REPORTBTP_OPTION = '__reportbtp__';

export default function Privacy() {
  const { profile, organization, refreshProfile } = useAuth();
  const [hyperOrgs, setHyperOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState(REPORTBTP_OPTION);
  const [reportBtpContent, setReportBtpContent] = useState<string | null>(null);
  const isHyperAdminWithoutOrg = profile?.role === 'ROLE_HYPER_ADMIN' && !organization?.id;
  const isReportBtpSelection = isHyperAdminWithoutOrg && selectedOrgId === REPORTBTP_OPTION;
  const selectedHyperOrg = isReportBtpSelection ? null : hyperOrgs.find((org) => org.id === selectedOrgId) || null;
  const targetOrg = organization || selectedHyperOrg;
  const legalDocsLockedForHyperAdmin =
    isHyperAdminWithoutOrg && !isReportBtpSelection && targetOrg?.legalValidationStatus === 'termine';
  const canEdit = Boolean(
    (targetOrg?.id || isReportBtpSelection) &&
    (profile?.role === 'ROLE_ADMIN' || profile?.role === 'ROLE_HYPER_ADMIN') &&
    !legalDocsLockedForHyperAdmin,
  );
  const content = isReportBtpSelection
    ? (reportBtpContent?.trim() ? reportBtpContent : DEFAULT_PRIVACY)
    : (targetOrg?.privacyContent?.trim() ? targetOrg.privacyContent : DEFAULT_PRIVACY);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isHyperAdminWithoutOrg) return;
    Promise.all([
      organizationsAPI.getAll(),
      organizationsAPI.getReportBtpLegalDocs(),
    ])
      .then(([data, legalDocs]: [Organization[], { privacyContent?: string | null }]) => {
        const orgs = Array.isArray(data) ? data : [];
        setHyperOrgs(orgs);
        setReportBtpContent(legalDocs?.privacyContent || null);
        setSelectedOrgId((current) => current || REPORTBTP_OPTION);
      })
      .catch((error: any) => Swal.fire({ icon: 'error', title: 'Erreur', text: error?.message || 'Impossible de charger les organisations' }));
  }, [isHyperAdminWithoutOrg]);

  const startEditing = () => {
    setDraft(content);
    setIsEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (isReportBtpSelection) {
        const updated = await organizationsAPI.updateReportBtpLegalDocs({ privacyContent: draft });
        setReportBtpContent(updated?.privacyContent || null);
      } else if (organization?.id) {
        await currentOrgAPI.update({ privacyContent: draft });
        await refreshProfile();
      } else if (targetOrg?.id) {
        const updated = await organizationsAPI.update(targetOrg.id, { privacyContent: draft });
        setHyperOrgs((prev) => prev.map((org) => (org.id === targetOrg.id ? { ...org, ...updated } : org)));
      }
      setIsEditing(false);
    } catch (error: any) {
      await Swal.fire({ icon: 'error', title: 'Erreur', text: error?.message || "Erreur lors de l'enregistrement de la politique de confidentialité" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 text-base leading-relaxed">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="text-3xl font-bold">
          Politique de Confidentialité - {isReportBtpSelection ? 'ReportBTP' : targetOrg?.name || 'ReportBTP'}
        </h1>
        {canEdit && !isEditing && (
          <button
            onClick={startEditing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg hover:opacity-90 text-sm"
          >
            <Edit2 className="w-4 h-4" />
            Modifier
          </button>
        )}
      </div>

      {isHyperAdminWithoutOrg && (
        <div className="mb-4 max-w-md">
          <label className="block text-sm font-medium text-slate-700 mb-1">Documents affichés</label>
          <select
            value={selectedOrgId}
            onChange={(e) => {
              setSelectedOrgId(e.target.value);
              setIsEditing(false);
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-prosps-blue"
          >
            <option value={REPORTBTP_OPTION}>ReportBTP</option>
            {hyperOrgs.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>
      )}

      {legalDocsLockedForHyperAdmin && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Cette politique de confidentialité a été validée par l'organisation. Seul l'administrateur de cette organisation peut la modifier.
        </div>
      )}

      {isEditing ? (
        <div className="space-y-4">
          <LegalDocumentEditor value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsEditing(false)}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg hover:opacity-90 text-sm disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      ) : (
        <LegalDocumentView content={content} />
      )}
    </div>
  );
}
