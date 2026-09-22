import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertCircle, ArrowRight, BarChart3, BookOpen, CheckCircle2, ClipboardList, Loader2, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { missionsAPI, preventionAPI, PreventionPreset, PreventionQuery } from '../../lib/api';

type PeriodData = { period?: { from: string; to: string; granularity: string }; source?: string };
type Dashboard = PeriodData & { totals?: Record<string, number>; riskBreakdown?: Array<{ riskLevel: string; count: number }> };
type Trend = PeriodData & { items?: Array<{ bucket: string; findingCount: number; reportCount: number; visitCount: number }> };
type Finding = { id: string; content: string; danger?: string; risk?: string; riskLevel: string; confidence?: number; businessDate: string; missionType?: string; categoryLabel?: string; score?: number; occurrenceCount?: number; reportCount?: number; visitCount?: number; reportId?: string; };
type ListResponse = PeriodData & { items?: Finding[]; total?: number; page?: number; limit?: number };
type Reference = { reportId: string; title?: string; chantierTitle?: string; status?: string; businessDate: string; findingCount: number; reportFileUrl?: string | null; };
type Job = { id: string; status: string; progress?: { processedReports: number; scanComplete: boolean; failedJobs: number }; error?: string | null };

const presets: Array<{ value: PreventionPreset; label: string }> = [
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
  { path: 'suivi', label: 'Suivi / tendances', icon: ClipboardList },
  { path: 'references', label: 'Références rapports', icon: BookOpen },
];

function formatDate(value?: string) {
  if (!value) return '—';
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR');
}

type MissionOption = { id: string; title?: string; name?: string; type?: string };

function Filters({ value, onChange, defaultPreset = 'LAST_30_DAYS', missions }: { value: PreventionQuery; onChange: (next: PreventionQuery) => void; defaultPreset?: PreventionPreset; missions: MissionOption[] }) {
  const query = value.preset ? value : { ...value, preset: defaultPreset };
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="text-sm text-slate-600">Période
        <select className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" value={query.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as PreventionPreset, from: undefined, to: undefined })}>
          {presets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
        </select>
      </label>
      {query.preset === 'CUSTOM' && <>
        <label className="text-sm text-slate-600">Du<input className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" type="date" value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
        <label className="text-sm text-slate-600">Au<input className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" type="date" value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
      </>}
      <label className="text-sm text-slate-600">Type de chantier
        <select className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" value={value.missionType || ''} onChange={(e) => onChange({ ...value, missionType: (e.target.value || undefined) as PreventionQuery['missionType'] })}>
          <option value="">Tous</option><option value="CSPS">CSPS</option><option value="AEU">AEU</option><option value="DIVERS">DIVERS</option>
        </select>
      </label>
      <label className="text-sm text-slate-600">Risque
        <select className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" value={value.riskLevel || ''} onChange={(e) => onChange({ ...value, riskLevel: (e.target.value || undefined) as PreventionQuery['riskLevel'] })}>
          <option value="">Tous</option><option value="eleve">Élevé</option><option value="moyen">Moyen</option><option value="faible">Faible</option>
        </select>
      </label>
      <label className="text-sm text-slate-600">Statut rapport
        <select className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" value={value.status || ''} onChange={(e) => onChange({ ...value, status: (e.target.value || undefined) as PreventionQuery['status'] })}>
          <option value="">Tous</option><option value="brouillon">Brouillon</option><option value="envoye">Envoyé</option><option value="valide">Validé</option><option value="refuse">Refusé</option><option value="archive">Archivé</option><option value="envoye_au_client">Envoyé au client</option><option value="annule">Annulé</option>
        </select>
      </label>
      <label className="text-sm text-slate-600">Chantier
        <select className="mt-1 block max-w-[18rem] rounded-lg border border-slate-300 px-3 py-2" value={value.missionId || ''} onChange={(e) => onChange({ ...value, missionId: e.target.value || undefined })}>
          <option value="">Tous les chantiers</option>
          {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title || mission.name || 'Chantier'}{mission.type ? ` · ${mission.type}` : ''}</option>)}
        </select>
      </label>
    </div>
  );
}

function StateMessage({ loading, error, empty }: { loading: boolean; error?: string | null; empty?: boolean }) {
  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-slate-500"><Loader2 className="animate-spin" /> Chargement…</div>;
  if (error) return <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"><AlertCircle className="shrink-0" />{error}</div>;
  if (empty) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">Aucune donnée pour cette période.</div>;
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
  const [filters, setFilters] = useState<PreventionQuery>({ preset: section === 'suivi' ? 'LAST_12_MONTHS' : 'LAST_30_DAYS' });
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [trends, setTrends] = useState<Trend | null>(null);
  const [list, setList] = useState<ListResponse | null>(null);
  const [references, setReferences] = useState<{ items?: Reference[]; total?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [missions, setMissions] = useState<MissionOption[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const requestId = useRef(0);
  const pollingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const rebuildGeneration = useRef(0);
  const previousSection = useRef(section);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'ROLE_ADMIN' || !profile.organizationId || !organization)) navigate(`${base}/dashboard`, { replace: true });
  }, [authLoading, base, navigate, organization, profile]);

  useEffect(() => {
    if (rawSection !== section) navigate(`${base}/prevention/dashboard`, { replace: true });
  }, [base, navigate, rawSection, section]);

  useEffect(() => {
    const preset = section === 'suivi' ? 'LAST_12_MONTHS' : 'LAST_30_DAYS';
    previousSection.current = '__pending__';
    setFilters((current) => ({ preset, missionType: current.missionType, missionId: current.missionId, riskLevel: current.riskLevel, status: current.status, page: 1 }));
  }, [section]);

  useEffect(() => {
    mounted.current = true;
    if (profile?.role === 'ROLE_ADMIN' && profile.organizationId) {
      void missionsAPI.getAll().then((response) => {
        if (!mounted.current) return;
        const values = Array.isArray(response) ? response : (response as { items?: MissionOption[]; data?: MissionOption[] })?.items || (response as { data?: MissionOption[] })?.data || [];
        setMissions(values.filter((mission) => mission?.id));
      }).catch(() => { if (mounted.current) setMissions([]); });
    }
    return () => { mounted.current = false; };
  }, [profile]);

  const load = useCallback(async () => {
    if (profile?.role !== 'ROLE_ADMIN' || !profile.organizationId) return;
    const expectedPreset = section === 'suivi' ? 'LAST_12_MONTHS' : 'LAST_30_DAYS';
    const sectionChanged = previousSection.current !== section;
    const requestFilters: PreventionQuery = { ...filters, preset: sectionChanged ? expectedPreset : (filters.preset || expectedPreset), page: sectionChanged ? 1 : filters.page };
    previousSection.current = section;
    const current = ++requestId.current;
    if (requestFilters.preset === 'CUSTOM' && (!requestFilters.from || !requestFilters.to)) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true); setError(null);
    try {
      if (section === 'observations' || section === 'recommendations') {
        const response = await (section === 'observations' ? preventionAPI.findings(requestFilters) : preventionAPI.recommendations(requestFilters)) as ListResponse;
        if (current === requestId.current) setList(response);
      } else if (section === 'references') {
        const response = await preventionAPI.references(requestFilters) as { items?: Reference[]; total?: number };
        if (current === requestId.current) setReferences(response);
      } else {
        const [dashboardResponse, trendsResponse] = await Promise.all([preventionAPI.dashboard(requestFilters), preventionAPI.trends(requestFilters)]);
        if (current === requestId.current) { setDashboard(dashboardResponse as Dashboard); setTrends(trendsResponse as Trend); }
      }
    } catch (reason) {
      if (current === requestId.current) setError(reason instanceof Error ? reason.message : 'Impossible de charger les données de prévention.');
    } finally { if (current === requestId.current) setLoading(false); }
  }, [filters, profile, refreshNonce, section]);

  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load]);
  useEffect(() => () => { mounted.current = false; rebuildGeneration.current += 1; if (pollingTimer.current) clearTimeout(pollingTimer.current); }, []);

  const startRebuild = async () => {
    if (pollingTimer.current) clearTimeout(pollingTimer.current);
    const generation = ++rebuildGeneration.current;
    setRebuildLoading(true); setError(null);
    try {
      const created = await preventionAPI.rebuild() as Job;
      if (!mounted.current || generation !== rebuildGeneration.current) return;
      setJob(created);
      const poll = async (attempt: number) => {
        if (!mounted.current || generation !== rebuildGeneration.current) return;
        if (attempt >= 20) { setRebuildLoading(false); setError('Le suivi de la reconstruction a expiré.'); return; }
        try {
          const next = await preventionAPI.job(created.id) as Job;
          if (!mounted.current || generation !== rebuildGeneration.current) return;
          setJob(next);
          if (next.status === 'COMPLETED' || next.status === 'FAILED' || next.status === 'QUARANTINED') { setRebuildLoading(false); if (next.status === 'COMPLETED') setRefreshNonce((current) => current + 1); return; }
          pollingTimer.current = setTimeout(() => void poll(attempt + 1), 3000);
        } catch (reason) { if (!mounted.current || generation !== rebuildGeneration.current) return; setRebuildLoading(false); setError(reason instanceof Error ? reason.message : 'Impossible de suivre la reconstruction.'); }
      };
      void poll(0);
    } catch (reason) {
      if (!mounted.current || generation !== rebuildGeneration.current) return;
      setRebuildLoading(false);
      const typed = reason as Error & { status?: number };
      setError(typed.status === 429 ? 'Une reconstruction est déjà en cours ou vient de se terminer. Réessayez plus tard.' : typed.message || 'La reconstruction a échoué.');
    }
  };

  const chartData = useMemo(() => (trends?.items || []).map((item) => ({ ...item, label: formatDate(item.bucket) })), [trends]);
  const updateFilters = useCallback((next: PreventionQuery) => setFilters({ ...next, page: 1 }), []);
  const customPeriodIncomplete = filters.preset === 'CUSTOM' && (!filters.from || !filters.to);
  if (authLoading || !profile || profile.role !== 'ROLE_ADMIN' || !profile.organizationId) return <StateMessage loading />;

  const title = navItems.find((item) => item.path === section)?.label || 'Prévention';
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div><p className="text-sm font-semibold uppercase tracking-wide text-prosps-blue">Prévention · {organization?.name}</p><h1 className="mt-1 text-3xl font-bold text-slate-900">{title}</h1><p className="mt-1 text-slate-500">Analyse des rapports produits par votre organisation.</p></div>
      <button type="button" onClick={() => void startRebuild()} disabled={rebuildLoading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-prosps-blue px-4 py-2.5 font-medium text-white disabled:opacity-60"><RefreshCw className={rebuildLoading ? 'animate-spin' : ''} size={18} />{rebuildLoading ? 'Reconstruction…' : 'Reconstruire les données'}</button>
    </div>
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">{navItems.map((item) => { const Icon = item.icon; return <Link key={item.path} to={`${base}/prevention/${item.path}`} className={`inline-flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-medium ${section === item.path ? 'bg-prosps-blue text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon size={16} />{item.label}</Link>; })}</div>
    <Filters value={filters} onChange={updateFilters} defaultPreset={section === 'suivi' ? 'LAST_12_MONTHS' : 'LAST_30_DAYS'} missions={missions} />
    {customPeriodIncomplete && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Sélectionnez une date de début et une date de fin pour lancer la recherche.</div>}
    {job && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><CheckCircle2 size={18} /> Reconstruction {job.status.toLowerCase()} — {job.progress?.processedReports ?? 0} rapport(s) traité(s){job.error ? ` — ${job.error}` : ''}</div>}
    <StateMessage loading={customPeriodIncomplete ? false : loading} error={error} />
    {!customPeriodIncomplete && !loading && !error && (section === 'dashboard' || section === 'suivi') && <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[['findings', 'Constats'], ['reports', 'Rapports'], ['visits', 'Visites'], ['missions', 'Chantiers']].map(([key, label]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{dashboard?.totals?.[key] ?? 0}</p></div>)}</div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 font-semibold text-slate-900">Évolution des constats</h2>{chartData.length ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="findingCount" name="Constats" stroke="#0f4c81" fill="#bfdbfe" /></AreaChart></ResponsiveContainer></div> : <StateMessage loading={false} error={null} empty />}</div><div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 font-semibold text-slate-900">Répartition des risques</h2>{dashboard?.riskBreakdown?.length ? <div className="space-y-3">{dashboard.riskBreakdown.map((risk) => <div key={risk.riskLevel} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="capitalize">{risk.riskLevel}</span><strong>{risk.count}</strong></div>)}</div> : <StateMessage loading={false} error={null} empty />}</div></div>
    </div>}
    {!customPeriodIncomplete && !loading && !error && (section === 'observations' || section === 'recommendations') && <FindingList response={list} base={base} onPage={(page) => setFilters((current) => ({ ...current, page }))} />}
    {!customPeriodIncomplete && !loading && !error && section === 'references' && <ReferenceList response={references} base={base} page={filters.page || 1} onPage={(page) => setFilters((current) => ({ ...current, page }))} />}
  </div>;
}

function FindingList({ response, base, onPage }: { response: ListResponse | null; base: string; onPage: (page: number) => void }) {
  if (!response?.items?.length) return <StateMessage loading={false} error={null} empty />;
  const page = response.page || 1; const limit = response.limit || 25; const pages = Math.max(1, Math.ceil((response.total || 0) / limit));
  return <div className="space-y-3">{response.items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-slate-500">{formatDate(item.businessDate)} · {item.missionType || 'Type non précisé'}{item.categoryLabel ? ` · ${item.categoryLabel}` : ''}</p><h2 className="mt-1 font-semibold text-slate-900">{item.content || 'Constat sans libellé'}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.riskLevel === 'eleve' ? 'bg-red-100 text-red-700' : item.riskLevel === 'moyen' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{item.riskLevel}</span></div>{item.danger && <p className="mt-3 text-sm text-slate-600"><strong>Danger :</strong> {item.danger}</p>}{item.risk && <p className="mt-1 text-sm text-slate-600"><strong>Risque :</strong> {item.risk}</p>}<div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500"><span>Confiance : {item.confidence ?? '—'}%</span><span>Occurrences : {item.occurrenceCount ?? 0}</span>{item.reportId && <Link className="inline-flex items-center gap-1 font-medium text-prosps-blue hover:underline" to={`${base}/reports?reportId=${encodeURIComponent(item.reportId)}`}>Voir le rapport <ArrowRight size={14} /></Link>}</div></article>)}<Pagination page={page} pages={pages} onPage={onPage} /></div>;
}

function ReferenceList({ response, base, page, onPage }: { response: { items?: Reference[]; total?: number } | null; base: string; page: number; onPage: (page: number) => void }) {
  if (!response?.items?.length) return <StateMessage loading={false} error={null} empty />;
  const pages = Math.max(1, Math.ceil((response.total || 0) / 25));
  return <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2">{response.items.map((reference) => <article key={reference.reportId} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs text-slate-500">{formatDate(reference.businessDate)} · {reference.status || '—'}</p><h2 className="mt-1 font-semibold text-slate-900">{reference.title || reference.chantierTitle || 'Rapport'}</h2><p className="mt-2 text-sm text-slate-600">{reference.findingCount} constat(s) associé(s)</p><Link className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-prosps-blue hover:underline" to={`${base}/reports?reportId=${encodeURIComponent(reference.reportId)}`}>Ouvrir dans les rapports <ArrowRight size={14} /></Link></article>)}</div><Pagination page={page} pages={pages} onPage={onPage} /></div>;
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="flex items-center justify-center gap-3 pt-3"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">Précédent</button><span className="text-sm text-slate-600">Page {page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">Suivant</button></div>;
}
