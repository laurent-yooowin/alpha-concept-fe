import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertCircle, ArrowRight, BarChart3, BookOpen, CheckCircle2, Loader2, RefreshCw, ShieldAlert, Sparkles, WalletCards, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { missionsAPI, preventionAPI, PreventionPreset, PreventionQuery } from '../../lib/api';
import BudgetPage from './BudgetPage';
import ClientMultiSelect from './ClientMultiSelect';
import './PreventionPage.css';

type PeriodData = { period?: { from: string | null; to: string | null; granularity: string }; source?: string };
type Dashboard = PeriodData & {
  totals?: Record<string, number>;
  riskBreakdown?: Array<{ riskLevel: string; count: number }>;
  categoryBreakdown?: Array<{ categoryId?: string | null; categoryKey: string; categoryLabel?: string | null; findingCount: number }>;
  topPriorities?: Array<{ id: string; content?: string; categoryLabel?: string | null; score?: number; occurrenceCount?: number; reportCount?: number; riskLevel?: string; reportId?: string; reportTitle?: string | null }>;
  categoryRiskMatrix?: Array<{ categoryId?: string | null; categoryKey: string; categoryLabel?: string | null; faible: number; moyen: number; eleve: number }>;
  scoreSummary?: { prioritizedPatterns: number; averageScore: number; maxScore: number };
  missionTypeBreakdown?: Array<{ missionType: string; reportCount: number; observationCount: number }>;
  phaseBreakdown?: Array<{ phase: string; label?: string; reportCount: number; observationCount?: number }>;
  conformitySummary?: { measuredReports: number; averageConformity: number };
  missionRiskMatrix?: Array<{ missionId: string; missionTitle?: string | null; faible: number; moyen: number; eleve: number }>;
  missionCategoryMatrix?: Array<{ missionId: string; missionTitle?: string | null; categoryId?: string | null; categoryCode?: string | null; categoryLabel?: string | null; observationCount: number }>;
  clientCategoryMatrix?: Array<{ client?: string | null; categoryId?: string | null; categoryCode?: string | null; categoryLabel?: string | null; observationCount: number }>;
  topRisks?: Array<{ id: string; content?: string; danger?: string | null; risk?: string | null; riskLevel?: string; severity?: string; score?: number; occurrenceCount?: number; reportCount?: number; reportId?: string; reportTitle?: string | null }>;
};
type Trend = PeriodData & { items?: Array<{ bucket: string; findingCount: number; observationCount?: number; reportCount: number; visitCount: number }> };
type Finding = { id: string; content: string; danger?: string; risk?: string; riskLevel: string; severity?: string; confidence?: number; businessDate: string; missionType?: string; missionTitle?: string; categoryLabel?: string; score?: number; occurrenceCount?: number; reportCount?: number; visitCount?: number; reportId?: string; reportTitle?: string; regulatoryReferences?: string[]; };
type ListResponse = PeriodData & { items?: Finding[]; total?: number; page?: number; limit?: number };
type Reference = { reportId: string; title?: string; chantierTitle?: string; status?: string; businessDate: string; findingCount: number; reportFileUrl?: string | null; };
type RegulatoryItem = { reference: string; citationCount: number; reportCount: number; domains?: string[]; riskLevels?: string[]; reports?: Array<{ id: string; title?: string }> };
type Job = { id: string; status: string; scheduledFor?: string | null; availableAt?: string | null; reportCount?: number; findingCount?: number; immediateLimit?: number; executionMode?: string; progress?: { processedReports: number; scanComplete: boolean; failedJobs: number }; error?: string | null };
type RebuildPreview = { reportCount?: number; findingCount?: number; immediateLimit?: number; executionMode?: string; scheduledFor?: string | null; previewToken?: string; selection?: { missionId?: string; clientKeys: string[] } };
type CategoryOption = { id: string; label: string; code?: string; color?: string | null };
const REBUILD_POLL_INTERVAL_MS = 3_000;
const REBUILD_POLL_MAX_ATTEMPTS = 300;

const presets: Array<{ value: PreventionPreset; label: string }> = [
  { value: 'ALL', label: 'Toute la période' },
  { value: 'LAST_7_DAYS', label: '7 derniers jours' },
  { value: 'LAST_30_DAYS', label: '30 derniers jours' },
  { value: 'CURRENT_QUARTER', label: 'Trimestre en cours' },
  { value: 'LAST_6_MONTHS', label: '6 derniers mois' },
  { value: 'CURRENT_YEAR', label: 'Année en cours' },
  { value: 'LAST_12_MONTHS', label: '12 derniers mois' },
  { value: 'CUSTOM', label: 'Période personnalisée' },
];

const navItems = [
  { path: 'dashboard', label: 'Tableau de bord', icon: BarChart3 },
  { path: 'observations', label: 'Observations', icon: ShieldAlert },
  { path: 'recommendations', label: 'Recommandations', icon: Sparkles },
  { path: 'budget', label: 'Budget estimatif', icon: WalletCards },
  { path: 'references', label: 'Références réglementaires', icon: BookOpen },
];

function formatDate(value?: string) {
  if (!value) return '—';
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR');
}
function formatScheduled(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(date);
}

const MATRIX_CATEGORY_ORDER = ['Hauteur', 'Circulation', 'EPI', 'Éclairage', 'Levage', 'Organisation', 'Incendie', 'Admin.', 'Électrique'];
const matrixCategoryKey = (value?: string | null) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

const riskClass = (risk?: string) => risk === 'critique' ? 'critical' : risk === 'eleve' ? 'red' : risk === 'moyen' ? 'orange' : 'green';
const riskLabel = (risk?: string) => risk === 'critique' ? 'Critique' : risk === 'eleve' ? 'Élevé' : risk === 'moyen' ? 'Moyen' : 'Faible';
const priorityClass = (score = 0) => score >= 80 ? 'urgent' : score >= 60 ? 'high' : '';
const priorityLabel = (score = 0) => score >= 80 ? 'Priorité urgente' : score >= 60 ? 'Priorité élevée' : 'Priorité moyenne';

type MissionOption = { id: string; title?: string; name?: string; type?: string; client?: string | null };
type ClientOption = { key: string; label: string };

const normalizedClient = (value?: string | null) => (value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr-FR');

function Filters({ value, onChange, categories, clients, missions }: { value: PreventionQuery; onChange: (next: PreventionQuery) => void; categories: CategoryOption[]; clients: ClientOption[]; missions: MissionOption[] }) {
  const query = value.preset ? value : { ...value, preset: 'ALL' as PreventionPreset };
  const missionMatchesClients = (mission: MissionOption, keys: string[]) => !keys.length || keys.some((key) =>
    key === 'unassigned' ? !normalizedClient(mission.client)
      : normalizedClient(clients.find((client) => client.key === key)?.label) === normalizedClient(mission.client));
  const availableMissions = value.clientKeys?.length
    ? missions.filter((mission) => missionMatchesClients(mission, value.clientKeys || []))
    : missions;
  return (
    <div className="rte-filterbar">
      <span className="rte-filter-title">Filtres</span>
      <label className="rte-filter-field">Période
        <select value={query.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as PreventionPreset, from: undefined, to: undefined })}>
          {presets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
        </select>
      </label>
      {query.preset === 'CUSTOM' && <>
        <label className="rte-filter-field">Du<input type="date" value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
        <label className="rte-filter-field">Au<input type="date" value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
      </>}
      <label className="rte-filter-field">Catégorie
        <select value={value.categoryId || ''} onChange={(e) => onChange({ ...value, categoryId: e.target.value || undefined })}>
          <option value="">Toutes les catégories</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
      </label>
      <label className="rte-filter-field">Gravité
        <select value={value.severity || ''} onChange={(e) => onChange({ ...value, severity: (e.target.value || undefined) as PreventionQuery['severity'], riskLevel: undefined })}>
          <option value="">Toutes les gravités</option><option value="critique">Critique</option><option value="eleve">Élevé</option><option value="moyen">Moyen</option><option value="faible">Faible</option>
        </select>
      </label>
      <div className="rte-filter-field rte-filter-client-field">
        <span>Client</span>
        <ClientMultiSelect clients={clients} selectedKeys={value.clientKeys || []} onChange={(keys) => onChange({
          ...value, clientKeys: keys,
          missionId: missions.some((mission) => mission.id === value.missionId && missionMatchesClients(mission, keys)) ? value.missionId : undefined,
        })} />
      </div>
      <label className="rte-filter-field">Chantier
        <select value={value.missionId || ''} onChange={(e) => onChange({ ...value, missionId: e.target.value || undefined })}>
          <option value="">Tous les chantiers</option>
          {availableMissions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title || mission.name || mission.id}</option>)}
        </select>
      </label>
    </div>
  );
}

function StateMessage({ loading, error, empty, onClose }: { loading: boolean; error?: string | null; empty?: boolean; onClose?: () => void }) {
  if (loading) return <div className="rte-state"><Loader2 className="mx-auto mb-2 animate-spin" />Chargement…</div>;
  if (error) return <div role="alert" className="rte-alert"><AlertCircle className="shrink-0" /><span className="flex-1">{error}</span>{onClose && <button type="button" className="rte-alert-close" onClick={onClose} aria-label="Fermer l’alerte"><X size={16} /></button>}</div>;
  if (empty) return <div className="rte-state">Aucune donnée pour cette période.</div>;
  return null;
}

export default function PreventionPage() {
  const { profile, organization, loading: authLoading } = useAuth();
  const { slug = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const base = `/${slug}`;
  const rawSection = location.pathname.split('/').filter(Boolean).pop() || 'dashboard';
  const section = navItems.some((item) => item.path === rawSection) ? rawSection : 'dashboard';
  const filterStorageKey = `prevention.filters.${slug}`;
  const [filters, setFilters] = useState<PreventionQuery>(() => {
    try {
      const stored = sessionStorage.getItem(filterStorageKey);
      const saved = stored ? JSON.parse(stored) as PreventionQuery : {};
      return {
        preset: saved.preset || 'ALL', from: saved.from, to: saved.to,
        categoryId: saved.categoryId, severity: saved.severity, missionId: saved.missionId,
        clientKeys: Array.isArray(saved.clientKeys) ? saved.clientKeys : [], page: 1,
      };
    } catch { return { preset: 'ALL', page: 1 }; }
  });
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [trends, setTrends] = useState<Trend | null>(null);
  const [list, setList] = useState<ListResponse | null>(null);
  const [references, setReferences] = useState<{ regulatoryItems?: RegulatoryItem[]; items?: Reference[]; total?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataLoadFailed, setDataLoadFailed] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [dismissedPeriodWarning, setDismissedPeriodWarning] = useState<string | null>(null);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildPreview, setRebuildPreview] = useState<RebuildPreview | null>(null);
  const [missions, setMissions] = useState<MissionOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestId = useRef(0);
  const pollingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const rebuildGeneration = useRef(0);
  const rebuildStorageKey = `prevention.rebuild.job.${profile?.organizationId || slug}`;

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'ROLE_ADMIN' || !profile.organizationId || !organization || (organization.preventionEnabled ?? profile.preventionEnabled) !== true)) navigate(`${base}/dashboard`, { replace: true });
  }, [authLoading, base, navigate, organization, profile]);

  useEffect(() => {
    if (rawSection !== section) navigate(`${base}/prevention/dashboard`, { replace: true });
  }, [base, navigate, rawSection, section]);

  useEffect(() => { setFilters((current) => current.page === 1 ? current : { ...current, page: 1 }); }, [section]);
  useEffect(() => {
    try {
      sessionStorage.setItem(filterStorageKey, JSON.stringify({
        preset: filters.preset, from: filters.from, to: filters.to,
        categoryId: filters.categoryId, severity: filters.severity,
        missionId: filters.missionId, clientKeys: filters.clientKeys,
      }));
    } catch { /* session storage can be unavailable */ }
  }, [filterStorageKey, filters]);

  useEffect(() => {
    mounted.current = true;
    if (profile?.role === 'ROLE_ADMIN' && profile.organizationId) {
      void missionsAPI.getAll().then((response) => {
        if (!mounted.current) return;
        const values = Array.isArray(response) ? response : (response as { items?: MissionOption[]; data?: MissionOption[] })?.items || (response as { data?: MissionOption[] })?.data || [];
        setMissions(values.filter((mission) => mission?.id));
      }).catch(() => { if (mounted.current) setMissions([]); });
      void preventionAPI.categories().then((response) => {
        if (!mounted.current) return;
        const values = response && typeof response === 'object' && Array.isArray((response as { items?: CategoryOption[] }).items)
          ? (response as { items: CategoryOption[] }).items : [];
        setCategories(values.filter((category) => category?.id && category?.label));
      }).catch(() => { if (mounted.current) setCategories([]); });
      void preventionAPI.budgetClients().then((response) => {
        if (!mounted.current) return;
        const values = Array.isArray(response) ? response : (response as { items?: ClientOption[]; data?: ClientOption[] })?.items || (response as { data?: ClientOption[] })?.data || [];
        setClients(values.filter((client) => client?.key && client?.label));
      }).catch(() => { if (mounted.current) setClients([]); });
    }
    return () => { mounted.current = false; };
  }, [profile, refreshNonce]);

  const load = useCallback(async () => {
    if (profile?.role !== 'ROLE_ADMIN' || !profile.organizationId) return;
    const requestFilters: PreventionQuery = { ...filters, preset: filters.preset || 'ALL' };
    const current = ++requestId.current;
    if (requestFilters.preset === 'CUSTOM' && (!requestFilters.from || !requestFilters.to)) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true); setError(null); setDataLoadFailed(false);
    try {
      if (section === 'budget') {
        if (current === requestId.current) { setLoading(false); setError(null); }
      } else if (section === 'observations' || section === 'recommendations') {
        const listFilters: PreventionQuery = section === 'recommendations'
          ? { ...requestFilters, sortBy: 'score', sortOrder: 'desc' }
          : requestFilters;
        const response = await (section === 'observations' ? preventionAPI.findings(listFilters) : preventionAPI.recommendations(listFilters)) as ListResponse;
        if (current === requestId.current) setList(response);
      } else if (section === 'references') {
        const response = await preventionAPI.references(requestFilters) as { regulatoryItems?: RegulatoryItem[]; items?: Reference[]; total?: number };
        if (current === requestId.current) setReferences(response);
      } else {
        const [dashboardResponse, trendsResponse] = await Promise.all([preventionAPI.dashboard(requestFilters), preventionAPI.trends(requestFilters)]);
        if (current === requestId.current) { setDashboard(dashboardResponse as Dashboard); setTrends(trendsResponse as Trend); }
      }
    } catch (reason) {
      if (current === requestId.current) { setDataLoadFailed(true); setError(reason instanceof Error ? reason.message : 'Impossible de charger les données de prévention.'); }
    } finally { if (current === requestId.current) setLoading(false); }
  }, [filters, profile, refreshNonce, section]);

  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load]);
  useEffect(() => {
    if (!profile?.organizationId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const storedId = sessionStorage.getItem(rebuildStorageKey);
    if (!storedId) return;
    const resume = async () => {
      try {
        const next = await preventionAPI.job(storedId) as Job;
        if (!active) return;
        setJob(next);
        if (['COMPLETED', 'FAILED', 'QUARANTINED'].includes(String(next.status).toUpperCase())) { sessionStorage.removeItem(rebuildStorageKey); if (next.status === 'COMPLETED') setRefreshNonce((value) => value + 1); return; }
        timer = setTimeout(() => void resume(), next.executionMode === 'SCHEDULED' ? 5000 : REBUILD_POLL_INTERVAL_MS);
      } catch { if (active) sessionStorage.removeItem(rebuildStorageKey); }
    };
    void resume();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [profile?.organizationId, rebuildStorageKey]);
  useEffect(() => () => { mounted.current = false; rebuildGeneration.current += 1; if (pollingTimer.current) clearTimeout(pollingTimer.current); }, []);

  const startRebuild = async (confirmed = false, confirmedToken?: string, confirmedSelection?: RebuildPreview['selection']) => {
    if (!confirmed) {
      setRebuildLoading(true); setError(null);
      try {
        const selection = { missionId: filters.missionId, clientKeys: [...(filters.clientKeys || [])] };
        setRebuildPreview({ ...(await preventionAPI.rebuildPreview(selection) as RebuildPreview), selection });
      }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible de mesurer le périmètre de reconstruction.'); }
      finally { setRebuildLoading(false); }
      return;
    }
    if (pollingTimer.current) clearTimeout(pollingTimer.current);
    const generation = ++rebuildGeneration.current;
    const selection = confirmedSelection || rebuildPreview?.selection;
    setRebuildLoading(true); setError(null);
    try {
      const created = await preventionAPI.rebuild(confirmedToken || rebuildPreview?.previewToken, selection) as Job;
      if (!mounted.current || generation !== rebuildGeneration.current) return;
      setJob(created);
      sessionStorage.setItem(rebuildStorageKey, created.id);
      const poll = async (attempt: number) => {
        if (!mounted.current || generation !== rebuildGeneration.current) return;
        if (attempt >= REBUILD_POLL_MAX_ATTEMPTS) { setRebuildLoading(false); pollingTimer.current = setTimeout(() => void poll(attempt + 1), 30_000); return; }
        try {
          const next = await preventionAPI.job(created.id) as Job;
          if (!mounted.current || generation !== rebuildGeneration.current) return;
          setJob(next);
          if (next.status === 'COMPLETED' || next.status === 'FAILED' || next.status === 'QUARANTINED') { setRebuildLoading(false); sessionStorage.removeItem(rebuildStorageKey); if (next.status === 'COMPLETED') setRefreshNonce((current) => current + 1); return; }
          pollingTimer.current = setTimeout(() => void poll(attempt + 1), REBUILD_POLL_INTERVAL_MS);
        } catch (reason) { if (!mounted.current || generation !== rebuildGeneration.current) return; setRebuildLoading(false); setError(reason instanceof Error ? reason.message : 'Impossible de suivre la reconstruction.'); }
      };
      void poll(0);
    } catch (reason) {
      if (!mounted.current || generation !== rebuildGeneration.current) return;
      setRebuildLoading(false);
      const typed = reason as Error & { status?: number };
      const refreshed = (typed as Error & { payload?: { preview?: RebuildPreview } }).payload?.preview;
      if (typed.status === 409 && refreshed) { setRebuildPreview({ ...refreshed, selection }); setError('Le volume ou le créneau a changé. Vérifiez la prévisualisation avant de confirmer.'); return; }
      setError(typed.status === 429 ? 'Une reconstruction est déjà en cours ou vient de se terminer. Réessayez plus tard.' : typed.message || 'La reconstruction a échoué.');
    }
  };

  const chartData = useMemo(() => (trends?.items || []).map((item) => ({ ...item, observationCount: item.observationCount ?? item.findingCount, label: formatDate(item.bucket) })), [trends]);
  const updateFilters = useCallback((next: PreventionQuery) => setFilters({ ...next, page: 1 }), []);
  const customPeriodIncomplete = filters.preset === 'CUSTOM' && (!filters.from || !filters.to);
  const periodWarningKey = `${section}:${filters.from || ''}:${filters.to || ''}`;
  if (authLoading || !profile || profile.role !== 'ROLE_ADMIN' || !profile.organizationId || !organization) return <StateMessage loading />;
  if ((organization.preventionEnabled ?? profile.preventionEnabled) !== true) return null;

  const title = navItems.find((item) => item.path === section)?.label || 'Prévention';
  const presetLabel = presets.find((preset) => preset.value === filters.preset)?.label || 'Période sélectionnée';
  const ActiveIcon = navItems.find((item) => item.path === section)?.icon || BarChart3;
  const analysisBadge = section === 'dashboard'
    ? `${dashboard?.totals?.reports ?? 0} rapports analysés`
    : section === 'observations'
      ? `${list?.total ?? 0} observations`
      : section === 'recommendations'
        ? `${list?.total ?? 0} recommandations consolidées`
        : section === 'references'
          ? `${references?.regulatoryItems?.length ?? 0} références identifiées`
          : 'Budget estimatif';
  const rebuildIsScheduled = String(rebuildPreview?.executionMode || '').toUpperCase() === 'SCHEDULED';
  return <div className="rte-workspace">
    <div className="rte-main">
      <header className="rte-topbar">
        <div><h1 className="rte-topbar-title">Prévention des Risques SPS</h1><p className="rte-topbar-sub">{organization.name} · Analyse consolidée des rapports et recommandations de prévention</p></div>
        <div className="rte-topbar-actions">
          <span className="rte-badge orange">{analysisBadge}</span>
          <span className="rte-badge navy">{presetLabel}</span>
          {section !== 'budget' && <button type="button" onClick={() => void startRebuild()} disabled={rebuildLoading} className="rte-action"><RefreshCw className={rebuildLoading ? 'animate-spin' : ''} size={14} />{rebuildLoading ? 'Reconstruction…' : 'Reconstruire'}</button>}
        </div>
      </header>
      <nav className="rte-tabs" aria-label="Sections Prévention">{navItems.map((item) => { const Icon = item.icon; return <Link key={item.path} to={`${base}/prevention/${item.path}`} className={`rte-tab ${section === item.path ? 'active' : ''}`}><Icon size={15} />{item.label}</Link>; })}</nav>
      <Filters value={filters} onChange={updateFilters} categories={categories} clients={clients} missions={missions} />
      <main className="rte-content">
        {section !== 'budget' && <div className="rte-section-title"><ActiveIcon size={18} /><span>{title}</span></div>}
        {section === 'budget' ? <div className="rte-budget">{customPeriodIncomplete ? dismissedPeriodWarning !== periodWarningKey && <div role="alert" className="rte-alert"><span className="flex-1">Sélectionnez une date de début et une date de fin pour afficher le budget.</span><button type="button" className="rte-alert-close" onClick={() => setDismissedPeriodWarning(periodWarningKey)} aria-label="Fermer l’alerte"><X size={16} /></button></div> : <BudgetPage missions={missions} base={base} filters={filters} clientKeys={filters.clientKeys || []} clients={clients} />}</div> : <>
          {customPeriodIncomplete && dismissedPeriodWarning !== periodWarningKey && <div role="alert" className="rte-alert"><span className="flex-1">Sélectionnez une date de début et une date de fin pour lancer la recherche.</span><button type="button" className="rte-alert-close" onClick={() => setDismissedPeriodWarning(periodWarningKey)} aria-label="Fermer l’alerte"><X size={16} /></button></div>}
          {job && dismissedJobId !== job.id && <div role="status" className="rte-job flex items-start gap-2"><CheckCircle2 className="shrink-0" size={15} /><span className="flex-1">Reconstruction {job.status.toLowerCase()} — {job.progress?.processedReports ?? 0} rapport(s) traité(s){job.executionMode === 'SCHEDULED' && (job.scheduledFor || job.availableAt) ? ` · prochaine fenêtre ${formatScheduled(job.scheduledFor || job.availableAt)}` : ''}{job.error ? ` — ${job.error}` : ''}</span><button type="button" className="rte-alert-close" onClick={() => setDismissedJobId(job.id)} aria-label="Fermer l’alerte"><X size={16} /></button></div>}
          <StateMessage loading={customPeriodIncomplete ? false : loading} error={error} onClose={() => setError(null)} />
          {!customPeriodIncomplete && !loading && !dataLoadFailed && section === 'dashboard' && <DashboardView dashboard={dashboard} chartData={chartData} base={base} />}
          {!customPeriodIncomplete && !loading && !dataLoadFailed && (section === 'observations' || section === 'recommendations') && <FindingList response={list} base={base} mode={section} onPage={(page) => setFilters((current) => ({ ...current, page }))} />}
          {!customPeriodIncomplete && !loading && !dataLoadFailed && section === 'references' && <ReferenceList response={references} base={base} page={filters.page || 1} onPage={(page) => setFilters((current) => ({ ...current, page }))} />}
        </>}
      </main>
    </div>
    {rebuildPreview && <div role="dialog" aria-modal="true" aria-labelledby="rebuild-preview-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
        <h2 id="rebuild-preview-title" className="text-base font-extrabold text-[#1e3a5f]">Prévisualiser la reconstruction</h2>
        <p className="mt-2 text-sm text-slate-600">Cette opération reconstruit les rapports de <strong>{organization.name}</strong>{rebuildPreview.selection?.missionId ? ` pour le chantier ${missions.find((mission) => mission.id === rebuildPreview.selection?.missionId)?.title || 'sélectionné'}` : ''}{rebuildPreview.selection?.clientKeys.length ? ` et les ${rebuildPreview.selection.clientKeys.length} client(s) sélectionné(s)` : ''}. La période, la catégorie et la gravité affichées ({presetLabel}) ne limitent pas la reconstruction et resteront inchangées.</p>
        <p className="mt-2 text-xs text-slate-500">Aucun job n'est lancé avant confirmation.</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Rapports</dt><dd className="mt-1 text-lg font-bold text-[#1e3a5f]">{rebuildPreview.reportCount ?? '—'}</dd></div><div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Constats</dt><dd className="mt-1 text-lg font-bold text-[#1e3a5f]">{rebuildPreview.findingCount ?? '—'}</dd></div></dl>
        <p className="mt-3 text-xs text-slate-600">Plafond immédiat : <strong>{rebuildPreview.immediateLimit ?? '—'}</strong> · <strong>{rebuildIsScheduled ? 'Programmation nocturne' : 'Lancement immédiat'}</strong>{rebuildPreview.scheduledFor ? ` · ${formatScheduled(rebuildPreview.scheduledFor)}` : ''}</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700" onClick={() => setRebuildPreview(null)}>Annuler</button><button type="button" className="rounded-md bg-[#e87722] px-3 py-2 text-xs font-bold text-white" onClick={() => { const token = rebuildPreview.previewToken; const selection = rebuildPreview.selection; setRebuildPreview(null); void startRebuild(true, token, selection); }}>{rebuildIsScheduled ? 'Confirmer la programmation' : 'Confirmer et reconstruire'}</button></div>
      </div>
    </div>}
  </div>;
}

function DashboardView({ dashboard, chartData, base }: { dashboard: Dashboard | null; chartData: Array<{ bucket: string; findingCount: number; observationCount: number; reportCount: number; visitCount: number; label: string }>; base: string }) {
  const [criticalDismissed, setCriticalDismissed] = useState(false);
  const critical = (dashboard?.riskBreakdown || []).filter((risk) => risk.riskLevel === 'critique').reduce((total, risk) => total + risk.count, 0);
  const priorities = dashboard?.topPriorities || [];
  const classifiedCategories = (dashboard?.categoryBreakdown || []).filter((item) => item.categoryLabel);
  const pieData = classifiedCategories.length
    ? classifiedCategories.map((item) => ({ name: item.categoryLabel || item.categoryKey, value: item.findingCount, level: item.categoryKey }))
    : (dashboard?.riskBreakdown || []).map((item) => ({ name: riskLabel(item.riskLevel), value: item.count, level: item.riskLevel }));
  const pieTitle = classifiedCategories.length ? 'Répartition par catégorie de risque' : 'Répartition par gravité (catégories non classées)';
  const topRisks = dashboard?.topRisks || [];
  const riskMax = Math.max(1, ...topRisks.map((item) => item.occurrenceCount ?? 0));
  const conformity = dashboard?.conformitySummary?.averageConformity ?? 0;
  const colors = ['#3182ce', '#805ad5', '#e53e3e', '#dd6b20', '#38a169', '#d69e2e', '#319795', '#718096'];
  const observationMax = Math.max(1, ...chartData.map((item) => item.observationCount));
  const barColor = (value: number) => value >= observationMax * .8 ? '#e53e3e' : value >= observationMax * .4 ? '#dd6b20' : value >= observationMax * .2 ? '#d69e2e' : '#38a169';
  const matrixRows = [...(dashboard?.clientCategoryMatrix || dashboard?.missionCategoryMatrix || []).reduce((rows, item: any) => {
    const key = item.client || item.missionId || 'Client non renseigné';
    const row = rows.get(key) || { key, label: item.client || item.missionTitle || 'Client non renseigné', counts: new Map<string, number>() };
    const categoryKey = matrixCategoryKey(item.categoryCode || item.categoryLabel || item.categoryId);
    if (categoryKey) row.counts.set(categoryKey, item.observationCount);
    rows.set(key, row);
    return rows;
  }, new Map<string, { key: string; label: string; counts: Map<string, number> }>()).values()];
  const matrixCategories = MATRIX_CATEGORY_ORDER.map((label) => ({ id: label, code: label, label }));
  const matrixMax = Math.max(1, ...matrixRows.flatMap((row) => matrixCategories.map((category: any) => row.counts.get(matrixCategoryKey(category.code)) || 0)));
  const heatClass = (value: number) => value === 0 ? 'zero' : value >= matrixMax * .75 ? 'critical' : value >= matrixMax * .35 ? 'medium' : 'low';
  return <>
    {critical > 0 && !criticalDismissed && <div role="alert" className="rte-alert"><AlertCircle size={17} className="shrink-0" /><span className="flex-1"><strong>{critical} risque(s) critique(s) identifié(s)</strong> — {priorities.length ? `${priorities.length} action(s) prioritaire(s) à examiner.` : 'une action prioritaire est requise.'} <Link className="rte-alert-link" to={`${base}/prevention/recommendations`}>Consulter les recommandations</Link></span><button type="button" className="rte-alert-close" onClick={() => setCriticalDismissed(true)} aria-label="Fermer l’alerte"><X size={16} /></button></div>}
    <div className="rte-kpis">
      <div className="rte-card rte-kpi"><p className="rte-kpi-label">Rapports analysés</p><p className="rte-kpi-value">{dashboard?.totals?.reports ?? 0}</p><p className="rte-kpi-sub">{dashboard?.totals?.missions ?? 0} chantier(s) · {dashboard?.totals?.visits ?? 0} visite(s)</p></div>
      <div className="rte-card rte-kpi red"><p className="rte-kpi-label">Observations totales</p><p className="rte-kpi-value">{dashboard?.totals?.observations ?? 0}</p><p className="rte-kpi-sub">dont {critical} critique(s)</p></div>
      <div className="rte-card rte-kpi yellow"><p className="rte-kpi-label">Taux de conformité</p><p className="rte-kpi-value">{Math.round(conformity)}%</p><p className="rte-kpi-sub">mesuré sur {dashboard?.conformitySummary?.measuredReports ?? 0} rapport(s)</p></div>
      <div className="rte-card rte-kpi orange"><p className="rte-kpi-label">Chantiers suivis</p><p className="rte-kpi-value">{dashboard?.totals?.missions ?? 0}</p><p className="rte-kpi-sub">{dashboard?.totals?.visits ?? 0} visite(s) analysée(s)</p></div>
    </div>
    <div className="rte-charts">
      <section className="rte-card rte-chart"><h2 className="rte-chart-title">📈 Évolution mensuelle des observations ({dashboard?.totals?.reports ?? 0} rapports analysés)</h2>{chartData.length ? <div className="rte-chart-canvas"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid vertical={false} stroke="#e5e9f0" /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="observationCount" name="Observations" radius={[5, 5, 0, 0]}>{chartData.map((entry) => <Cell key={entry.bucket} fill={barColor(entry.observationCount)} />)}</Bar></BarChart></ResponsiveContainer></div> : <StateMessage loading={false} error={null} empty />}</section>
      <section className="rte-card rte-chart"><h2 className="rte-chart-title">🔴 {pieTitle}</h2>{pieData.length ? <div className="rte-chart-canvas"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={75} paddingAngle={2}>{pieData.map((entry, index) => <Cell key={entry.level} fill={colors[index % colors.length]} />)}</Pie><Tooltip /><Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} /></PieChart></ResponsiveContainer></div> : <StateMessage loading={false} error={null} empty />}</section>
    </div>
    {matrixRows.length ? <section className="rte-card rte-table-card rte-heatmap-card" style={{ marginBottom: 14 }}><h2 className="rte-chart-title">🗓️ Matrice Entreprises × Catégories de risques (nombre d’observations)</h2><table className="rte-table rte-heatmap"><thead><tr><th>Entreprise</th>{matrixCategories.map((category: any) => <th key={category.id}>{category.label}</th>)}</tr></thead><tbody>{matrixRows.map((row) => <tr key={row.key}><td><strong>{row.label}</strong></td>{matrixCategories.map((category: any) => { const value = row.counts.get(matrixCategoryKey(category.code)) || 0; return <td key={category.id} className={heatClass(value)}>{value || '—'}</td>; })}</tr>)}</tbody></table></section> : null}
    <div className="rte-lower-grid">
      <section className="rte-card rte-compact-card"><h2 className="rte-chart-title">⚡ Score sécurité global</h2><div className="rte-gauge-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ value: conformity }, { value: Math.max(0, 100 - conformity) }]} dataKey="value" startAngle={180} endAngle={0} cx="50%" cy="88%" innerRadius={58} outerRadius={78} stroke="none"><Cell fill={conformity >= 75 ? '#38a169' : conformity >= 60 ? '#d69e2e' : '#e53e3e'} /><Cell fill="#edf0f4" /></Pie></PieChart></ResponsiveContainer><strong>{Math.round(conformity)}%</strong></div><p className="rte-data-note text-center">Conformité moyenne estimée sur {dashboard?.conformitySummary?.measuredReports ?? 0} rapport(s).</p></section>
      <section className="rte-card rte-compact-card"><h2 className="rte-chart-title">📊 Risques les plus récurrents</h2>{topRisks.length ? topRisks.slice(0, 4).map((item, index) => <div key={item.id} className="mb-3"><div className="flex justify-between gap-3 text-[11px] font-semibold text-[#1e3a5f]"><span className="line-clamp-2">{item.danger || item.risk || item.content || 'Risque'}</span><span className="whitespace-nowrap">{item.occurrenceCount ?? 0} obs.</span></div><div className="rte-progress"><span style={{ width: `${((item.occurrenceCount ?? 0) / riskMax) * 100}%`, background: colors[index % colors.length] }} /></div></div>) : <StateMessage loading={false} error={null} empty />}</section>
      <section className="rte-card rte-compact-card"><h2 className="rte-chart-title">📅 Rapports par phase de chantier</h2>{dashboard?.phaseBreakdown?.length ? <>{dashboard.phaseBreakdown.map((item) => <div key={item.phase} className="rte-stat-row"><span>{item.label || item.phase}</span><strong>{item.reportCount} rapport(s){item.observationCount != null ? ` · ${item.observationCount} obs.` : ''}</strong></div>)}<p className="rte-data-note">Un rapport peut couvrir plusieurs phases de chantier.</p></> : <StateMessage loading={false} error={null} empty />}</section>
    </div>
  </>;
}

function FindingList({ response, base, mode, onPage }: { response: ListResponse | null; base: string; mode: 'observations' | 'recommendations'; onPage: (page: number) => void }) {
  if (!response?.items?.length) return <StateMessage loading={false} error={null} empty />;
  const page = response.page || 1; const limit = response.limit || 25; const pages = Math.max(1, Math.ceil((response.total || 0) / limit));
  if (mode === 'observations') return <div><p className="mb-3 text-sm text-[#718096]">Toutes les observations issues des rapports — <strong className="text-[#1e3a5f]">{response.total ?? 0} résultat(s)</strong></p><div className="rte-card rte-table-card"><table className="rte-table min-w-[980px]"><thead><tr><th>Date</th><th>Catégorie / danger</th><th>Chantier</th><th>Observation</th><th>Gravité</th><th>Référence</th><th>Rapport</th></tr></thead><tbody>{response.items.map((item) => { const severity = item.severity || item.riskLevel; return <tr key={item.id}><td className="whitespace-nowrap">{formatDate(item.businessDate)}</td><td>{item.categoryLabel ? <span className="rte-pill blue">{item.categoryLabel}</span> : <span>{item.danger || item.risk || 'Non catégorisé'}</span>}</td><td>{item.missionTitle || item.missionType || '—'}</td><td><strong className="text-[#1e3a5f]">{item.content || 'Observation sans libellé'}</strong>{item.danger && <p className="rte-observation-detail">Danger : {item.danger}</p>}{item.risk && <p className="rte-observation-detail">Risque : {item.risk}</p>}</td><td><span className={`rte-pill ${riskClass(severity)}`}>{riskLabel(severity)}</span></td><td className="max-w-[210px]"><span className="rte-regulatory-copy not-italic">{item.regulatoryReferences?.length ? item.regulatoryReferences.join(', ') : '—'}</span></td><td>{item.reportId ? <Link className="rte-link inline-flex items-center gap-1" target="_blank" rel="noopener noreferrer" to={`${base}/reports?reportId=${encodeURIComponent(item.reportId)}`}>{item.reportTitle || 'Ouvrir'} <ArrowRight size={12} /></Link> : '—'}</td></tr>; })}</tbody></table><Pagination page={page} pages={pages} onPage={onPage} /></div></div>;
  return <div><p className="mb-3 text-sm text-[#718096]">Recommandations consolidées par motif, classées par score décroissant — <strong className="text-[#1e3a5f]">{response.total ?? 0} priorité(s)</strong></p><div className="rte-reco-grid">{response.items.map((item) => { const severity = item.severity || item.riskLevel; return <article key={item.id} className={`rte-card rte-reco ${priorityClass(item.score)}`}><div className="flex items-start justify-between gap-3"><div><p className="rte-reco-priority">{priorityLabel(item.score)} · score {item.score ?? 0}</p><h2 className="rte-reco-title">{item.content || 'Recommandation sans libellé'}</h2></div><span className={`rte-pill ${riskClass(severity)}`}>{riskLabel(severity)}</span></div>{item.risk && <p className="rte-reco-desc"><strong>Risque traité :</strong> {item.risk}</p>}<div className="rte-reco-meta"><span>{item.categoryLabel || `Risque ${riskLabel(severity)}`}</span><span>{item.missionTitle || item.missionType || 'Chantier non précisé'}</span><span>{item.occurrenceCount ?? 0} occurrence(s)</span><span>{item.reportCount ?? 0} rapport(s)</span></div>{item.regulatoryReferences?.length ? <p className="rte-regulatory-copy">Réf. {item.regulatoryReferences.join(', ')}</p> : null}{item.reportId && <Link className="rte-link mt-3 inline-flex items-center gap-1" target="_blank" rel="noopener noreferrer" to={`${base}/reports?reportId=${encodeURIComponent(item.reportId)}`}>{item.reportTitle || 'Voir le rapport source'} <ArrowRight size={12} /></Link>}</article>; })}<div className="lg:col-span-2"><Pagination page={page} pages={pages} onPage={onPage} /></div></div></div>;
}

function ReferenceList({ response, base, page, onPage }: { response: { regulatoryItems?: RegulatoryItem[]; items?: Reference[]; total?: number } | null; base: string; page: number; onPage: (page: number) => void }) {
  if (!response?.regulatoryItems?.length && !response?.items?.length) return <StateMessage loading={false} error={null} empty />;
  const pages = Math.max(1, Math.ceil((response.total || 0) / 25));
  return <div><p className="mb-3 text-sm text-[#718096]">Références réglementaires normalisées et reliées aux rapports qui les citent</p><div className="rte-card rte-table-card"><table className="rte-table min-w-[760px]"><thead><tr><th>Référence</th><th>Domaines / gravités</th><th>Nb. citations</th><th>Rapports concernés</th><th>Traçabilité</th></tr></thead><tbody>{(response.regulatoryItems || []).map((item) => { const visibleReports = item.reports?.slice(0, 4) || []; const remainingReports = Math.max(0, item.reportCount - visibleReports.length); return <tr key={item.reference}><td className="max-w-[300px]"><strong className="rte-reference-code">{item.reference}</strong></td><td><div className="rte-pill-list">{item.domains?.map((domain) => <span key={domain} className="rte-pill blue">{domain}</span>)}{!item.domains?.length && item.riskLevels?.map((risk) => <span key={risk} className={`rte-pill ${riskClass(risk)}`}>Gravité {riskLabel(risk)}</span>)}{!item.domains?.length && !item.riskLevels?.length ? <span className="text-slate-500">Non classé</span> : null}</div></td><td><span className="rte-count">{item.citationCount}</span></td><td>{item.reportCount}</td><td><div className="rte-traceability">{visibleReports.map((report) => <Link key={report.id} className="rte-link" target="_blank" rel="noopener noreferrer" to={`${base}/reports?reportId=${encodeURIComponent(report.id)}`}>{report.title || 'Rapport'}</Link>)}{remainingReports > 0 && <span className="rte-trace-more">+ {remainingReports} rapport(s)</span>}{!visibleReports.length && '—'}</div></td></tr>; })}</tbody></table><Pagination page={page} pages={pages} onPage={onPage} /></div>{response.items?.length ? <details className="rte-card mt-4 p-4"><summary className="cursor-pointer text-sm font-bold text-[#1e3a5f]">Voir les rapports sources de la page ({response.items.length})</summary><div className="mt-3 grid gap-2 md:grid-cols-2">{response.items.map((reference) => <div key={reference.reportId} className="rounded-md bg-slate-50 p-3 text-xs"><strong>{reference.title || reference.chantierTitle || 'Rapport'}</strong><p className="mt-1 text-slate-500">{formatDate(reference.businessDate)} · {reference.findingCount} constat(s)</p><Link className="rte-link mt-2 inline-flex items-center gap-1" target="_blank" rel="noopener noreferrer" to={`${base}/reports?reportId=${encodeURIComponent(reference.reportId)}`}>Ouvrir <ArrowRight size={12} /></Link></div>)}</div></details> : null}</div>;
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="rte-pagination"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button><span>Page {page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</button></div>;
}
