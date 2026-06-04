import { useEffect, useState } from 'react';
import { Edit2, Loader2, Save, X } from 'lucide-react';
import { type Organization, useAuth } from '../contexts/AuthContext';
import { currentOrgAPI, organizationsAPI } from '../lib/api';
import LegalDocumentEditor, { LegalDocumentView } from './LegalDocumentEditor';
import Swal from 'sweetalert2';

const DEFAULT_CGU = `**Éditeur :** Yooowin
**Adresse :** 5 rue du Banquier, 75013 Paris
**Email :** toufik@yooowin.com
**Version :** 1.0

## 1. Objet
Les présentes CGU définissent les conditions d'utilisation de l'application ReportBTP, destinée aux coordonnateurs SPS (CSPS) et professionnels du BTP pour la prise de photos, la collecte d'informations terrain et la génération de rapports réglementaires.

## 2. Éditeur de l'Application
ReportBTP est éditée par Yooowin, 5 rue du Banquier, 75013 Paris.

## 3. Description de l'Application
L'application permet :
- La gestion de projets
- La prise de photos
- L'annotation
- La génération de rapports et leur exportation

## 4. Conditions d'accès
L'application fonctionne sur terminaux Android et iOS. Certaines fonctionnalités nécessitent un compte ou un abonnement.

## 5. Création de compte
L'utilisateur est responsable de l'exactitude des informations et de la confidentialité de ses identifiants.

## 6. Utilisation de l'Application
L'utilisateur s'engage à respecter la législation, le droit à l'image et la confidentialité des chantiers.

## 7. Propriété intellectuelle
Les contenus de l'application appartiennent à Yooowin. Les contenus produits par l'utilisateur restent sa propriété.

## 8. Données personnelles
Les données sont traitées conformément au RGPD. Voir Politique de Confidentialité.

## 9. Permissions requises
- Caméra
- Stockage
- Internet
- Notifications
- Géolocalisation optionnelle

## 10. Disponibilité du service
L'éditeur peut suspendre temporairement l'accès en cas de maintenance.

## 11. Responsabilités
L'utilisateur reste responsable de l'usage de l'application et des données qu'il saisit.

## 12. Modifications des CGU
Les CGU peuvent être mises à jour. L'utilisateur en sera informé.

## 13. Résiliation
Le compte peut être supprimé par l'utilisateur ou en cas de non-respect des CGU.

## 14. Loi applicable
Les CGU sont régies par le droit français.

## 15. Contact
toufik@yooowin.com - 5 rue du Banquier, 75013 Paris`;

const REPORTBTP_OPTION = '__reportbtp__';

export default function Cgu() {
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
    ? (reportBtpContent?.trim() ? reportBtpContent : DEFAULT_CGU)
    : (targetOrg?.cguContent?.trim() ? targetOrg.cguContent : DEFAULT_CGU);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isHyperAdminWithoutOrg) return;
    Promise.all([
      organizationsAPI.getAll(),
      organizationsAPI.getReportBtpLegalDocs(),
    ])
      .then(([data, legalDocs]: [Organization[], { cguContent?: string | null }]) => {
        const orgs = Array.isArray(data) ? data : [];
        setHyperOrgs(orgs);
        setReportBtpContent(legalDocs?.cguContent || null);
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
        const updated = await organizationsAPI.updateReportBtpLegalDocs({ cguContent: draft });
        setReportBtpContent(updated?.cguContent || null);
      } else if (organization?.id) {
        await currentOrgAPI.update({ cguContent: draft });
        await refreshProfile();
      } else if (targetOrg?.id) {
        const updated = await organizationsAPI.update(targetOrg.id, { cguContent: draft });
        setHyperOrgs((prev) => prev.map((org) => (org.id === targetOrg.id ? { ...org, ...updated } : org)));
      }
      setIsEditing(false);
    } catch (error: any) {
      await Swal.fire({ icon: 'error', title: 'Erreur', text: error?.message || "Erreur lors de l'enregistrement des CGU" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 text-base leading-relaxed">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="text-3xl font-bold">
          Conditions Générales d'Utilisation - {isReportBtpSelection ? 'ReportBTP' : targetOrg?.name || 'ReportBTP'}
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
          Ces CGU ont été validées par l'organisation. Seul l'administrateur de cette organisation peut les modifier.
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
