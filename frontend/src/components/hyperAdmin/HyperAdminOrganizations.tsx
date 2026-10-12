import { useEffect, useMemo, useRef, useState } from 'react';
import { organizationsAPI } from '../../lib/api';
import { Plus, Pencil, Trash2, Upload, X, Loader2, Building2, ExternalLink, FileText, Image as ImageIcon, Check, Search, Eye, EyeOff, Activity, Info, RefreshCw, Play, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import LegalDocumentEditor, { LegalDocumentView } from '../LegalDocumentEditor';
import Swal from 'sweetalert2';
import { activatedOrganization } from './recoveryTransition';

interface Organization {
  id: string;
  name: string;
  slug: string;
  logoS3Key: string | null;
  logoUrl?: string | null;
  backgroundImageS3Key?: string | null;
  backgroundImageUrl?: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  cguContent: string | null;
  privacyContent?: string | null;
  loginTitle?: string | null;
  loginContent?: string | null;
  contactEmail: string | null;
  legalValidationStatus?: 'en_cours' | 'termine';
  isActive: boolean;
  paused?: boolean;
  createdAt: string;
}

type RecoveryStatus = {
  organizationId: string;
  effectiveStatus?: string;
  latestRun: {
    id: string;
    status: string;
    stage: string;
    executionMode: string;
    scheduledFor: string | null;
    reportCount: number;
    findingCount: number;
    steps: Array<{ kind: string; status: string; total?: number; processed?: number; totalHt?: string | number | null; error?: string | null }>;
    error?: string | null;
  } | null;
  activationScan?: { runStatus?: string; checkpointStatus?: string; pendingJobs?: number; failedJobs?: number; scanComplete?: boolean; lastError?: string | null } | null;
  groups: { total: number; pending: number; ready: number; failed: number };
  worker: { status?: string; heartbeatAgeSeconds?: number | null };
};

type RecoveryPreview = RecoveryStatus & {
  reportCount: number;
  findingCount: number;
  groupCount: number;
  pendingGroupCount: number;
  immediateAllowed: boolean;
  immediateReason: string;
  hardRejected?: boolean;
  scheduledFor: string | null;
  confirmationToken: string;
};

const emptyForm = {
  name: '',
  slug: '',
  primaryColor: '#1e40af',
  secondaryColor: '#0f172a',
  contactEmail: '',
  cguContent: '',
  privacyContent: '',
  loginTitle: '',
  loginContent: '',
  isActive: true,
  adminEmail: '',
  adminPassword: '',
  adminFirstName: '',
  adminLastName: '',
};

const logoAccept = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml,.jpg,.jpeg,.png,.webp,.avif,.svg';

const adminDisplayName = (form: typeof emptyForm) =>
  [form.adminFirstName, form.adminLastName].filter(Boolean).join(' ') || 'Administrateur';

const defaultCguContent = (form: typeof emptyForm) => `**Organisation :** ${form.name || 'Nom de l’organisation'}
**Administrateur :** ${adminDisplayName(form)}
**Email administrateur :** ${form.adminEmail || form.contactEmail || ''}

## 1. Objet
Les présentes CGU définissent les conditions d'utilisation du portail ${form.name || 'de l’organisation'}.

## 2. Accès au service
L'accès au portail est réservé aux utilisateurs autorisés par ${form.name || 'l’organisation'}.

## 3. Utilisation
L'utilisateur s'engage à utiliser le service conformément à la réglementation applicable et aux règles internes de ${form.name || 'l’organisation'}.

## 4. Contact
${form.contactEmail || form.adminEmail || ''}`;

const defaultPrivacyContent = (form: typeof emptyForm) => `**Organisation :** ${form.name || 'Nom de l’organisation'}
**Administrateur :** ${adminDisplayName(form)}
**Email administrateur :** ${form.adminEmail || form.contactEmail || ''}

## 1. Objet
Cette politique décrit la gestion des données personnelles dans le portail ${form.name || 'de l’organisation'}.

## 2. Données collectées
- Données de compte
- Données de chantier
- Photos, notes et rapports

## 3. Finalités
- Gestion des accès
- Suivi des chantiers
- Génération et diffusion des rapports

## 4. Droits
Les utilisateurs peuvent contacter ${form.contactEmail || form.adminEmail || ''} pour exercer leurs droits.

## 5. Contact
${form.contactEmail || form.adminEmail || ''}`;

export default function HyperAdminOrganizations() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [legalTouched, setLegalTouched] = useState({ cguContent: false, privacyContent: false });
  const [saving, setSaving] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [uploadingLogoFor, setUploadingLogoFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const modalLogoRef = useRef<HTMLInputElement>(null);
  const cguFileRef = useRef<HTMLInputElement>(null);
  const privacyFileRef = useRef<HTMLInputElement>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const modalBgRef = useRef<HTMLInputElement>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [recoveryStatuses, setRecoveryStatuses] = useState<Record<string, RecoveryStatus>>({});
  const [recoveryOrg, setRecoveryOrg] = useState<Organization | null>(null);
  const [recoveryPreview, setRecoveryPreview] = useState<RecoveryPreview | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryImmediate, setRecoveryImmediate] = useState(false);
  const [recoveryPollingError, setRecoveryPollingError] = useState('');
  const mountedRef = useRef(true);
  const legalDocsLocked = Boolean(editing?.legalValidationStatus === 'termine');

  const load = async () => {
    setLoading(true);
    try {
      const data = await organizationsAPI.getAll();
      setOrgs(data);
      try {
        const recovery = await organizationsAPI.preventionRecoveryStatuses();
        const items = Array.isArray(recovery) ? recovery : recovery?.items;
        setRecoveryStatuses(Object.fromEntries((items || []).map((item: RecoveryStatus) => [item.organizationId, item])));
      } catch {
        // Recovery telemetry is supplementary; organization management remains usable if it is unavailable.
        setRecoveryStatuses({});
      }
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const refreshOrganizationsPage = async () => {
    setError('');
    await load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => { mountedRef.current = false; };
  }, []);

  const refreshRecoveryStatuses = async () => {
    if (!mountedRef.current) return;
    try {
      const recovery = await organizationsAPI.preventionRecoveryStatuses();
      if (!mountedRef.current) return;
      const items = Array.isArray(recovery) ? recovery : recovery?.items;
      setRecoveryStatuses(Object.fromEntries((items || []).map((item: RecoveryStatus) => [item.organizationId, item])));
      setRecoveryPollingError('');
    } catch (e: any) {
      if (mountedRef.current) setRecoveryPollingError(e.message || 'État des traitements temporairement indisponible.');
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => { void refreshRecoveryStatuses(); }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const openRecovery = async (org: Organization) => {
    setRecoveryOrg(org);
    setRecoveryPreview(null);
    setRecoveryStatus(null);
    setRecoveryImmediate(false);
    setRecoveryPollingError('');
    setRecoveryLoading(true);
    try {
      let status: RecoveryStatus | null = null;
      try {
        status = await organizationsAPI.preventionRecoveryStatus(org.id);
        if (mountedRef.current) setRecoveryStatus(status);
      } catch (e: any) {
        if (mountedRef.current) setRecoveryPollingError(e.message || 'État du rattrapage temporairement indisponible.');
      }
      if (org.isActive) {
        try {
          const preview = await organizationsAPI.preventionRecoveryPreview(org.id);
          if (mountedRef.current) setRecoveryPreview(preview);
        } catch (e: any) {
          // Existing run details remain useful when preview is unavailable (for example during deactivation).
          if (mountedRef.current) setRecoveryPollingError(e.message || 'Prévisualisation temporairement indisponible.');
        }
      }
    } finally {
      if (mountedRef.current) setRecoveryLoading(false);
    }
  };

  const closeRecovery = () => {
    if (recoverySubmitting) return;
    setRecoveryOrg(null);
    setRecoveryPreview(null);
    setRecoveryStatus(null);
  };

  const refreshRecovery = async () => {
    if (!recoveryOrg) return;
    setRecoveryLoading(true);
    try {
      const status = await organizationsAPI.preventionRecoveryStatus(recoveryOrg.id);
      setRecoveryStatus(status);
    } catch (e: any) {
      if (mountedRef.current) setRecoveryPollingError(e.message || 'État du rattrapage temporairement indisponible.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  useEffect(() => {
    if (!recoveryOrg || !recoveryStatus?.latestRun || ['COMPLETED', 'FAILED'].includes(recoveryStatus.latestRun.status)) return;
    const timer = window.setInterval(() => { void refreshRecovery(); }, 10000);
    return () => window.clearInterval(timer);
  }, [recoveryOrg?.id, recoveryStatus?.latestRun?.id, recoveryStatus?.latestRun?.status]);

  const confirmRecovery = async () => {
    if (!recoveryOrg || !recoveryPreview) return;
    setRecoverySubmitting(true);
    try {
      const status = await organizationsAPI.preventionRecoveryConfirm(recoveryOrg.id, recoveryPreview.confirmationToken, recoveryImmediate);
      setRecoveryStatus(status);
      setRecoveryPreview(null);
      setRecoveryStatuses((current) => ({ ...current, [recoveryOrg.id]: status }));
      await Swal.fire({ icon: 'success', title: recoveryImmediate ? 'Rattrapage lancé' : 'Rattrapage planifié', text: recoveryImmediate ? 'Le backend exécute les étapes dans l’ordre.' : 'Le traitement sera exécuté dans la prochaine fenêtre disponible.', timer: 2200, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Rattrapage non lancé', text: e.message || 'La demande a été refusée.' });
    } finally {
      setRecoverySubmitting(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setLegalTouched({ cguContent: false, privacyContent: false });
    setLogoFile(null);
    setLogoPreview(null);
    setBgFile(null);
    setBgPreview(null);
    setShowAdminPassword(false);
    setShowModal(true);
  };

  const openEdit = (org: Organization) => {
    setEditing(org);
    setLegalTouched({ cguContent: true, privacyContent: true });
    setForm({
      ...emptyForm,
      name: org.name,
      slug: org.slug,
      primaryColor: org.primaryColor || '#1e40af',
      secondaryColor: org.secondaryColor || '#0f172a',
      contactEmail: org.contactEmail || '',
      cguContent: org.cguContent || '',
      privacyContent: org.privacyContent || '',
      loginTitle: org.loginTitle || '',
      loginContent: org.loginContent || '',
      isActive: org.isActive,
    });
    setLogoFile(null);
    setLogoPreview(org.logoUrl || null);
    setBgFile(null);
    setBgPreview(org.backgroundImageUrl || null);
    setShowAdminPassword(false);
    setShowModal(true);
  };

  const close = () => {
    setShowModal(false);
    setEditing(null);
    setLegalTouched({ cguContent: false, privacyContent: false });
    setLogoFile(null);
    setLogoPreview(null);
    setBgFile(null);
    setBgPreview(null);
    setShowAdminPassword(false);
  };

  useEffect(() => {
    if (!showModal || editing) return;
    setForm((current) => ({
      ...current,
      cguContent: legalTouched.cguContent ? current.cguContent : defaultCguContent(current),
      privacyContent: legalTouched.privacyContent ? current.privacyContent : defaultPrivacyContent(current),
    }));
  }, [
    showModal,
    editing,
    legalTouched.cguContent,
    legalTouched.privacyContent,
    form.name,
    form.contactEmail,
    form.adminEmail,
    form.adminFirstName,
    form.adminLastName,
  ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let targetId: string;
      // An already-active organization must also expose the recovery choice
      // after Save; the backend alone decides whether activation work is due.
      const openRecoveryAfterSave = Boolean(editing && form.isActive);
      if (editing) {
        const { adminEmail, adminPassword, adminFirstName, adminLastName, ...payload } = form;
        if (legalDocsLocked) {
          delete (payload as any).cguContent;
          delete (payload as any).privacyContent;
        }
        await organizationsAPI.update(editing.id, payload);
        targetId = editing.id;
      } else {
        const created = await organizationsAPI.create(form);
        targetId = created.id;
      }
      if (logoFile && targetId) {
        try { await organizationsAPI.uploadLogo(targetId, logoFile); } catch (err: any) {
          await Swal.fire({ icon: 'warning', title: 'Logo non uploadé', text: 'Organisation enregistrée, mais échec upload logo : ' + (err.message || '') });
        }
      }
      if (bgFile && targetId) {
        try { await organizationsAPI.uploadBackground(targetId, bgFile); } catch (err: any) {
          await Swal.fire({ icon: 'warning', title: 'Image de fond non uploadée', text: 'Organisation enregistrée, mais échec upload image de fond : ' + (err.message || '') });
        }
      }
      close();
      await refreshOrganizationsPage();
      if (openRecoveryAfterSave) {
        const activatedOrg = activatedOrganization(orgs.find((org) => org.id === targetId) || editing!, targetId);
        await openRecovery(activatedOrg);
      }
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Erreur', text: e.message || 'Erreur' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (org: Organization) => {
    const result = await Swal.fire({
      icon: 'warning',
      title: 'Supprimer cette organisation ?',
      text: `L'organisation "${org.name}" sera supprimée définitivement.`,
      showCancelButton: true,
      confirmButtonText: 'Supprimer',
      cancelButtonText: 'Annuler',
      confirmButtonColor: '#dc2626',
    });
    if (!result.isConfirmed) return;
    try {
      await organizationsAPI.remove(org.id);
      await refreshOrganizationsPage();
      await Swal.fire({ icon: 'success', title: 'Organisation supprimée', timer: 1500, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Erreur', text: e.message || 'Erreur' });
    }
  };

  const onPickLogo = (org: Organization) => {
    setUploadingLogoFor(org.id);
    fileInputRef.current?.click();
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadingLogoFor) return;
    try {
      await organizationsAPI.uploadLogo(uploadingLogoFor, file);
      await load();
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Échec upload', text: err.message || 'Échec upload' });
    } finally {
      setUploadingLogoFor(null);
    }
  };

  const onModalLogoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const onModalBgSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBgFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setBgPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const onTextFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'cguContent' | 'privacyContent',
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (!['txt', 'md', 'html', 'htm'].includes(ext)) {
      await Swal.fire({ icon: 'error', title: 'Format non supporté', text: 'Utilisez .txt, .md ou .html' });
      return;
    }
    const text = await file.text();
    if (legalDocsLocked) return;
    setLegalTouched((current) => ({ ...current, [field]: true }));
    setForm((f) => ({ ...f, [field]: text }));
  };

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgs.filter((o) => {
      if (statusFilter === 'active' && !o.isActive) return false;
      if (statusFilter === 'inactive' && o.isActive) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        (o.contactEmail || '').toLowerCase().includes(q)
      );
    });
  }, [orgs, search, statusFilter]);

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" accept={logoAccept} className="hidden" onChange={onFileSelected} />
      <input ref={modalLogoRef} type="file" accept={logoAccept} className="hidden" onChange={onModalLogoSelected} />
      <input ref={modalBgRef} type="file" accept="image/*" className="hidden" onChange={onModalBgSelected} />
      <input ref={cguFileRef} type="file" accept=".txt,.md,.html,.htm,text/plain,text/markdown,text/html" className="hidden" onChange={(e) => onTextFileSelected(e, 'cguContent')} />
      <input ref={privacyFileRef} type="file" accept=".txt,.md,.html,.htm,text/plain,text/markdown,text/html" className="hidden" onChange={(e) => onTextFileSelected(e, 'privacyContent')} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Organisations</h1>
          <p className="text-slate-500 mt-1">Créer, modifier et gérer chaque tenant.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-lg font-medium"
        >
          <Plus className="w-4 h-4" /> Nouvelle organisation
        </button>
      </div>

              {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">{error}</div>}
      {recoveryPollingError && <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg">{recoveryPollingError}</div>}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, slug, email…"
            className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 bg-white"
        >
          <option value="all">Tous les statuts</option>
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
        </select>
        <div className="text-sm text-slate-500 self-center">
          {filteredOrgs.length} / {orgs.length}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Chargement...</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrgs.map((org) => (
            <div key={org.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-lg flex items-center justify-center text-white text-lg font-bold flex-shrink-0 overflow-hidden"
                  style={{ backgroundColor: org.primaryColor || '#1e40af' }}
                >
                  {org.logoUrl ? (
                    <img src={org.logoUrl} alt={org.name} className="w-full h-full object-contain" />
                  ) : (
                    <Building2 className="w-7 h-7" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 truncate">{org.name}</h3>
                  <a
                    href={`/${org.slug}/login`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    /{org.slug}/login <ExternalLink className="w-3 h-3" />
                  </a>
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => void openRecovery(org)}
                      title="Ouvrir le suivi Prévention de cette organisation"
                      className={`text-xs px-2 py-0.5 rounded-full hover:ring-2 hover:ring-emerald-200 ${org.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}
                    >
                      {org.isActive ? 'Actif' : 'Inactif'}
                    </button>
                    <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${org.legalValidationStatus === 'en_cours' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                      {org.legalValidationStatus === 'en_cours' ? 'Validation en cours' : 'Validation terminée'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openRecovery(org)}
                      title="État des traitements Prévention"
                      className="ml-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100"
                    >
                      <Activity className="w-3 h-3" />
                      {preventionBadge(recoveryStatuses[org.id])}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openRecovery(org)}
                      title="Cliquer pour ouvrir les détails du worker partagé"
                      aria-label={`Ouvrir les détails du worker partagé : ${workerBadge(recoveryStatuses[org.id])}`}
                      className="ml-1 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 cursor-pointer hover:bg-slate-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                    >
                      <Info className="w-3.5 h-3.5 shrink-0 text-violet-600" aria-hidden="true" />
                      Worker partagé : {workerBadge(recoveryStatuses[org.id])}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: org.primaryColor || '#1e40af' }} />
                  {org.primaryColor || '—'}
                </span>
                <span className="inline-flex items-center gap-1 ml-2">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: org.secondaryColor || '#0f172a' }} />
                  {org.secondaryColor || '—'}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-auto">
                <button
                  onClick={() => onPickLogo(org)}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  <Upload className="w-3.5 h-3.5" /> Logo
                </button>
                <button
                  onClick={() => openEdit(org)}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg"
                >
                  <Pencil className="w-3.5 h-3.5" /> Modifier
                </button>
                <button
                  onClick={() => remove(org)}
                  className="inline-flex items-center justify-center px-3 py-2 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {filteredOrgs.length === 0 && (
            <div className="col-span-full text-center text-slate-400 py-12">Aucune organisation. Créez la première.</div>
          )}
        </div>
      )}

      {recoveryOrg && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Rattrapage Prévention — {recoveryOrg.name}</h2>
                <p className="text-xs text-slate-500 mt-1">Les actions sont exécutées par le backend et le worker partagé.</p>
              </div>
              <button onClick={closeRecovery} className="p-1 hover:bg-slate-100 rounded" aria-label="Fermer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              {recoveryPollingError && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">{recoveryPollingError}</div>}
              {recoveryLoading && !recoveryPreview && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Chargement de la prévisualisation…</div>}
              {recoveryPreview && (!recoveryStatus?.latestRun || isTerminalRecoveryRun(recoveryStatus.latestRun.status)) && (
                <>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <RecoveryMetric label="Rapports" value={recoveryPreview.reportCount} />
                    <RecoveryMetric label="Constats" value={recoveryPreview.findingCount} />
                    <RecoveryMetric label="Groupes à réanalyser" value={recoveryPreview.groupCount} />
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4 space-y-2">
                    <p className="font-medium text-slate-800">Le rattrapage complet enchaînera :</p>
                    <p className="text-sm text-slate-600">1. Extraction des rapports · 2. Réanalyse de tous les groupes (phase proposée, risques, types d’actions) · 3. Calcul du budget global toutes périodes.</p>
                    <p className="text-xs text-slate-600">Les phases, corrections et montants budgétaires validés par un humain restent inchangés. La réanalyse peut entraîner des coûts IA supplémentaires.</p>
                    {recoveryPreview.pendingGroupCount > 0 && <p className="text-xs text-amber-700">{recoveryPreview.pendingGroupCount} groupe(s) sont déjà en attente.</p>}
                  </div>
                  {recoveryPreview.hardRejected && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Ce rattrapage ne peut pas être lancé : le volume dépasse le plafond de sécurité. Réduisez le périmètre ou utilisez la fenêtre de traitement planifiée.</div>}
                  {!recoveryPreview.hardRejected && !recoveryPreview.immediateAllowed && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{formatRecoveryReason(recoveryPreview.immediateReason)}</div>}
                  <label className={`flex items-start gap-3 rounded-lg border p-3 ${recoveryPreview.immediateAllowed ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-50'}`}>
                    <input type="checkbox" checked={recoveryImmediate} disabled={!recoveryPreview.immediateAllowed} onChange={(e) => setRecoveryImmediate(e.target.checked)} className="mt-1" />
                    <span className="text-sm"><span className="font-medium text-slate-800">Exécuter immédiatement</span><br /><span className="text-slate-500">{recoveryPreview.immediateAllowed ? 'Le volume respecte le plafond de sécurité.' : 'Le volume dépasse le plafond immédiat ; le backend planifiera le traitement.'}</span></span>
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={closeRecovery} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-100">Conserver le rattrapage automatique</button>
                    <button type="button" onClick={() => void confirmRecovery()} disabled={recoverySubmitting || recoveryPreview.hardRejected} className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium disabled:opacity-50">
                      {recoverySubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      {recoveryImmediate ? 'Lancer maintenant' : 'Planifier le rattrapage'}
                    </button>
                  </div>
                </>
              )}
              {recoveryStatus?.latestRun && (!recoveryPreview || !isTerminalRecoveryRun(recoveryStatus.latestRun.status)) && (
                <RecoveryDetails status={recoveryStatus} onRefresh={() => void refreshRecovery()} loading={recoveryLoading} />
              )}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editing ? `Modifier ${editing.name}` : 'Nouvelle organisation'}
              </h2>
              <button onClick={close} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Logo</label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {logoPreview ? (
                      <img src={logoPreview} alt="logo" className="w-full h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-slate-300" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => modalLogoRef.current?.click()}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      <Upload className="w-4 h-4" /> {logoFile ? 'Changer le logo' : 'Choisir un logo'}
                    </button>
                    {logoFile && (
                      <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-600" /> {logoFile.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Nom *" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                <Field
                  label="Slug (URL) *"
                  required
                  value={form.slug}
                  onChange={(v) => setForm({ ...form, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  hint="Minuscules, chiffres et tirets uniquement (ex: edf)"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ColorField label="Couleur primaire" value={form.primaryColor} onChange={(v) => setForm({ ...form, primaryColor: v })} />
                <ColorField label="Couleur secondaire" value={form.secondaryColor} onChange={(v) => setForm({ ...form, secondaryColor: v })} />
              </div>
              <Field label="Email contact *" required type="email" value={form.contactEmail} onChange={(v) => setForm({ ...form, contactEmail: v })} />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Image de fond (page de connexion)
                  <span className="text-slate-400 font-normal"> – optionnel</span>
                </label>
                <div className="flex items-center gap-4">
                  <div
                    className="w-32 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0"
                    style={
                      !bgPreview
                        ? {
                            background: `linear-gradient(135deg, ${form.secondaryColor} 0%, ${form.primaryColor} 100%)`,
                          }
                        : undefined
                    }
                  >
                    {bgPreview ? (
                      <img src={bgPreview} alt="bg" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-white/80">Couleur par défaut</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => modalBgRef.current?.click()}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      <Upload className="w-4 h-4" /> {bgFile ? "Changer l'image" : 'Choisir une image'}
                    </button>
                    {bgFile && (
                      <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-600" /> {bgFile.name}
                      </span>
                    )}
                    {bgPreview && (
                      <button
                        type="button"
                        onClick={() => { setBgFile(null); setBgPreview(null); }}
                        className="text-xs text-red-600 hover:underline text-left"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    CGU <span className="text-slate-400 font-normal">– optionnel</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => cguFileRef.current?.click()}
                    disabled={legalDocsLocked}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                  >
                    <FileText className="w-3.5 h-3.5" /> Importer CGU (.txt/.md/.html)
                  </button>
                </div>
                {legalDocsLocked ? (
                  <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <p className="text-xs text-amber-700 mb-3">
                      CGU validées. Modification réservée à l'administrateur de l'organisation.
                    </p>
                    <LegalDocumentView content={form.cguContent} />
                  </div>
                ) : (
                  <LegalDocumentEditor
                    value={form.cguContent}
                    onChange={(cguContent) => {
                      setLegalTouched((current) => ({ ...current, cguContent: true }));
                      setForm({ ...form, cguContent });
                    }}
                    rows={12}
                  />
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    Politique de confidentialité <span className="text-slate-400 font-normal">– optionnel</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => privacyFileRef.current?.click()}
                    disabled={legalDocsLocked}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                  >
                    <FileText className="w-3.5 h-3.5" /> Importer (.txt/.md/.html)
                  </button>
                </div>
                {legalDocsLocked ? (
                  <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <p className="text-xs text-amber-700 mb-3">
                      Politique de confidentialité validée. Modification réservée à l'administrateur de l'organisation.
                    </p>
                    <LegalDocumentView content={form.privacyContent} />
                  </div>
                ) : (
                  <LegalDocumentEditor
                    value={form.privacyContent}
                    onChange={(privacyContent) => {
                      setLegalTouched((current) => ({ ...current, privacyContent: true }));
                      setForm({ ...form, privacyContent });
                    }}
                    rows={12}
                  />
                )}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <p className="text-sm font-semibold text-slate-700">Personnalisation de la page de connexion</p>
                <Field
                  label="Titre du portail"
                  value={form.loginTitle}
                  onChange={(v) => setForm({ ...form, loginTitle: v })}
                  hint="Optionnel — affiché sous le logo (ex: Portail de connexion EDF)"
                />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Texte d'accueil <span className="text-slate-400 font-normal">– optionnel</span>
                  </label>
                  <textarea
                    rows={3}
                    value={form.loginContent}
                    onChange={(e) => setForm({ ...form, loginContent: e.target.value })}
                    placeholder="Message affiché sur la page de connexion personnalisée"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <span className="text-sm">Organisation active</span>
              </label>
              {editing && form.isActive && (
                <p className="text-xs text-violet-700">Après Enregistrer, les choix de rattrapage Prévention s’ouvriront. Aucun calcul ne démarre sans confirmation.</p>
              )}

              {!editing && (
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-700">Administrateur initial</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Email admin *" required type="email" value={form.adminEmail} onChange={(v) => setForm({ ...form, adminEmail: v })} />
                    <PasswordField
                      label="Mot de passe *"
                      required
                      value={form.adminPassword}
                      visible={showAdminPassword}
                      onToggle={() => setShowAdminPassword((visible) => !visible)}
                      onChange={(v) => setForm({ ...form, adminPassword: v })}
                    />
                    <Field label="Prénom *" required value={form.adminFirstName} onChange={(v) => setForm({ ...form, adminFirstName: v })} />
                    <Field label="Nom *" required value={form.adminLastName} onChange={(v) => setForm({ ...form, adminLastName: v })} />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button type="button" onClick={close} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-100">Annuler</button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Enregistrement...' : editing ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function preventionBadge(status?: RecoveryStatus): string {
  if (!status) return 'Prévention — état inconnu';
  if (status.effectiveStatus === 'PAUSED_DISABLED') return 'Prévention — organisation inactive / traitements suspendus';
  const run = status.latestRun;
  if (run?.status === 'FAILED' || (status.groups?.failed ?? 0) > 0) return 'Prévention — échec';
  if (run && !['COMPLETED', 'FAILED'].includes(run.status)) return 'Prévention — en cours';
  const activation = status.activationScan;
  if (activation && !activation.scanComplete &&
      [activation.runStatus, activation.checkpointStatus].some((value) => ['PENDING', 'PROCESSING', 'SCHEDULED'].includes(String(value)))) {
    return 'Prévention — rattrapage en cours';
  }
  return 'Prévention — prête';
}

function workerBadge(status?: RecoveryStatus): string {
  const workerStatus = status?.worker?.status;
  if (workerStatus === 'down' || workerStatus === 'degraded') return 'à vérifier';
  if (workerStatus === 'unknown' || !workerStatus) return 'état inconnu';
  return 'opérationnel';
}

function formatRecoveryReason(reason: string): string {
  if (reason === 'VOLUME_REQUIRES_BULK_WINDOW') return 'Le volume dépasse le plafond immédiat ; le backend planifiera le traitement dans la prochaine fenêtre disponible.';
  return reason || 'Le backend impose une exécution planifiée pour ce volume.';
}

function isTerminalRecoveryRun(status?: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

const RecoveryMetric = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
    <p className="text-xl font-semibold text-slate-900">{value.toLocaleString('fr-FR')}</p>
    <p className="text-xs text-slate-500">{label}</p>
  </div>
);

const RecoveryDetails = ({ status, onRefresh, loading }: { status: RecoveryStatus; onRefresh: () => void; loading: boolean }) => {
  const run = status.latestRun;
  return (
    <div className="space-y-4">
      {status.effectiveStatus === 'PAUSED_DISABLED' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Prévention — organisation inactive / traitements suspendus</div>}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-800">État du rattrapage : {run ? statusLabel(run.status) : 'aucun rattrapage'}</p>
          {run?.executionMode && <p className="text-xs text-slate-500">Mode : {run.executionMode === 'IMMEDIATE' ? 'immédiat' : 'fenêtre planifiée'}</p>}
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser</button>
      </div>
      <div className="space-y-2">
        {(run?.steps || []).map((step) => (
          <div key={step.kind} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="flex items-center gap-2"><StepIcon status={step.status} /> {stepLabel(step.kind)}</span>
            <span className="text-slate-500">{step.status === 'COMPLETED' && step.kind !== 'BUDGET' ? 'Terminé' : step.kind === 'BUDGET' && step.totalHt != null ? `${Number(step.totalHt).toLocaleString('fr-FR')} € HT` : statusLabel(step.status)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Worker partagé</span><br /><span className="font-medium">{workerStatusLabel(status.worker?.status)}{status.worker?.heartbeatAgeSeconds != null ? ` · dernier signal il y a ${status.worker.heartbeatAgeSeconds} s` : ''}</span></div>
        <div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Groupes</span><br /><span className="font-medium">{status.groups.ready} prêts · {status.groups.pending} en attente</span></div>
      </div>
      {run?.error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{recoveryErrorLabel(run.error)}</div>}
    </div>
  );
};

function statusLabel(value: string): string {
  return ({ PENDING: 'En attente', PROCESSING: 'En cours', SCHEDULED: 'Planifié', SUSPENDED: 'Suspendu', PUBLISHED: 'Terminé', READY: 'Prêt', COMPLETED: 'Terminé', FAILED: 'Échec', SKIPPED: 'Ignoré', EXTRACTION: 'En attente', GROUPS: 'En cours', BUDGET: 'En cours' } as Record<string, string>)[value] || 'État inconnu';
}

function workerStatusLabel(value?: string): string {
  return ({ ok: 'Opérationnel', healthy: 'Opérationnel', degraded: 'Dégradé', down: 'Indisponible', unknown: 'État inconnu' } as Record<string, string>)[value ?? ''] || 'État inconnu';
}

function recoveryErrorLabel(value: string): string {
  const known: Record<string, string> = {
    ORG_DISABLED_PAUSED: 'Organisation inactive : les traitements sont suspendus.',
    EXTRACTION_FAILED: 'Échec de l’extraction des rapports.',
    PREVENTION_GROUP_PROCESSING_FAILED: 'Échec de la construction des groupes et actions.',
    BUDGET_FAILED: 'Échec du calcul du budget global.',
    PREVENTION_SOURCE_CHANGED_RECONFIRM: 'Les données ont changé pendant le rattrapage. Actualisez et confirmez une nouvelle demande.',
    RECOVERY_QUEUE_ENQUEUE_FAILED: 'Le traitement n’a pas pu être ajouté à la file d’attente.',
  };
  if (value.includes('Prevention budget bulk window closed')) return 'Calcul suspendu à la fermeture de la fenêtre de traitement ; reprise à la prochaine fenêtre.';
  return known[value] || 'Le traitement a rencontré une erreur. Consultez les journaux du backend pour le détail.';
}

function stepLabel(value: string): string {
  return ({ EXTRACTION: 'Rapports / extraction', GROUPS: 'Groupes et actions', BUDGET: 'Budget global' } as Record<string, string>)[value] || value;
}

const StepIcon = ({ status }: { status: string }) => {
  if (status === 'COMPLETED') return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  if (status === 'FAILED') return <AlertTriangle className="w-4 h-4 text-red-600" />;
  return <Clock className="w-4 h-4 text-amber-600" />;
};

type TextFieldProps = { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; hint?: string };
const Field = ({ label, value, onChange, type = 'text', required, hint }: TextFieldProps) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
    />
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

const PasswordField = ({ label, value, onChange, required, visible, onToggle, hint }: TextFieldProps & { visible: boolean; onToggle: () => void }) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

const ColorField = ({ label, value, onChange }: Pick<TextFieldProps, 'label' | 'value' | 'onChange'>) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-12 h-10 border border-slate-300 rounded cursor-pointer" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 font-mono text-sm"
      />
    </div>
  </div>
);
