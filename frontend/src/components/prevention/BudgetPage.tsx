import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CircleDollarSign, Loader2, RefreshCw, WalletCards, X } from 'lucide-react';
import { preventionAPI, type PreventionPreset, type PreventionQuery } from '../../lib/api';
import { budgetReportCoverage } from './budgetReportCoverage';
import { budgetCalculationOutcome } from './budgetCalculationOutcome';
import { scheduleBudgetPublishedRefresh } from './budgetPublishedRefresh';
import { budgetCommandPayload, budgetExecutionMatchesDisplay, budgetExecutionPeriod, budgetExecutionSnapshot, budgetGlobalSelectionQuery, budgetGoverningReportEstimates, budgetItemEstimateDisplay, budgetItemRecalculationPayload, budgetMaterializedTarget, budgetModeAfterPeriodChange, budgetPublicExplanation, budgetRefreshScenarioId, budgetReportLabel, budgetScopeSelectionQuery, budgetSelectionKey, canRecalculateBudgetItem, formatBudgetMoney, materializedBudgetSelection, sumDisplayedBudgetAmounts } from './budgetUiContracts';
import ClientMultiSelect from './ClientMultiSelect';

type BudgetItem = {
  id: string;
  materializedOnly?: boolean;
  amountFromSelectedReports?: boolean;
  originScenarioId?: string;
  originItemId?: string;
  originVersion?: number;
  originMissionId?: string | null;
  conflictingHumanAmounts?: boolean;
  title?: string;
  categoryKey?: string;
  categoryLabel?: string | null;
  categoryId?: string | null;
  priority?: string;
  quantity?: number | string;
  unit?: string;
  unitCostHt?: number | string | null;
  totalHt?: number | string;
  status?: string;
  priceSource?: string | null;
  justification?: string | null;
  lockedManual?: boolean;
  clientKey?: string | null;
  clientLabel?: string | null;
  sourceReportEstimates?: Array<{ reportId?: string; reportTitle?: string; totalHt?: string; rationale?: string }>;
  governingReportId?: string | null;
  aiEstimateDetails?: {
    kind?: string; model?: string; generatedAt?: string; confidence?: number;
    totalHt?: string; rangeLowHt?: string; rangeHighHt?: string; rationale?: string;
    assumptions?: string[];
    inputsToConfirm?: string[];
    components?: Array<{ label?: string; amountHt?: string; explanation?: string }>;
    sourceReportEstimates?: Array<{ reportId?: string; reportTitle?: string; totalHt?: string; rationale?: string }>;
    governingReportId?: string | null;
    catalogBenchmark?: { label?: string; unit?: string; unitCostHt?: string; priceSource?: string } | null;
  } | null;
  sources?: Array<{ id?: string; sourceKind?: string; reportId?: string; findingId?: string }>;
  justificationDetails?: {
    context?: string | null;
    observations?: Array<{ id?: string; content?: string; danger?: string | null; risk?: string | null }>;
    recommendations?: string[];
    baseReglementaire?: string[];
    regulatoryReferences?: string[];
    costBreakdown?: { quantity?: string; unit?: string; unitCostHt?: string | null; totalHt?: string; priceSource?: string | null };
    aiEstimate?: BudgetItem['aiEstimateDetails'];
    reports?: Array<{ id: string; title?: string | null; url?: string | null }>;
  };
};
type Budget = {
  id: string;
  version?: number;
  scenarioKey?: string;
  sourceVersion?: string;
  periodStart?: string;
  periodEnd?: string;
  severity?: string | null;
  status?: string;
  contingencyRatePercent?: number | string;
  retainedBudgetHt?: number | string;
  estimatedBudgetHt?: number | string;
  validatedBudgetHt?: number | string;
  contingencyAmountHt?: number | string;
  totalBudgetHt?: number | string;
  items?: BudgetItem[];
};
type BudgetGlobalTotal = { amount: number | string | null; provisional: boolean };
type BudgetJob = { id: string; status?: string; scenarioId?: string; finalScenarioId?: string | null; targetScenarioId?: string; progress?: { processedItems?: number; totalItems?: number }; failedReason?: string | null; lastError?: string | null };
type BudgetScopePreview = {
  period?: { start?: string | null; end?: string | null };
  totals?: { reportCount?: number; recommendationCount?: number; estimationWorkloadCount?: number };
  threshold?: { decision?: 'IMMEDIATE' | 'NIGHT_ONLY' | 'REJECTED' | string; reason?: string; ceilings?: Record<string, number> };
  years?: Array<{ year?: number; reportCount?: number; recommendationCount?: number; estimationWorkloadCount?: number }>;
  totalReports?: number;
  estimatedAiCalls?: number;
  immediateCeiling?: number;
  confirmationToken?: string;
  scheduledFor?: string | null;
  admission?: { status?: string; scheduledFor?: string | null } | string;
};
type BudgetExecutionSelection = Pick<PreventionQuery, 'preset' | 'from' | 'to' | 'categoryId' | 'severity' | 'missionId'> & { clientKeys: string[] };
type BudgetConfirmation = { preview: BudgetScopePreview | null; mode: 'FILTERED' | 'CURRENT_YEAR' | 'GLOBAL_YEARLY'; globalArmed: boolean; selection: BudgetExecutionSelection };
type MissionOption = { id: string; title?: string; name?: string; type?: string };
type CategoryOption = { id: string; label: string };
type ClientOption = { key: string; label: string };

const asList = <T,>(value: unknown, keys: string[] = ['items']): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as T[];
  return [];
};
const money = formatBudgetMoney;
const itemAmount = (item: BudgetItem): number | string | null => {
  if (item.status === 'A_CHIFFRER') return item.aiEstimateDetails?.totalHt ?? null;
  return item.totalHt ?? item.aiEstimateDetails?.totalHt ?? (item.unitCostHt == null ? null : Number(item.quantity || 1) * Number(item.unitCostHt));
};
const budgetStatusLabel = (status?: string) => ({ A_CHIFFRER: 'À chiffrer', ESTIME: 'Estimé', VALIDE: 'Validé', ENGAGE: 'Engagé', REALISE: 'Réalisé' }[status || ''] || status || 'Estimé');
const periodDate = (value?: string) => value && /^\d{4}-\d{2}-\d{2}/.test(value)
  ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '—';
const parisDateTime = (value?: string | null) => {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(value));
};
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : 'Impossible de charger les données budgétaires.';
const errorStatus = (reason: unknown) => reason && typeof reason === 'object' && 'status' in reason ? Number((reason as { status?: unknown }).status) : 0;
const errorPayload = (reason: unknown) => reason && typeof reason === 'object' && 'payload' in reason ? (reason as { payload?: unknown }).payload : null;
const justificationPart = (value: string | null | undefined, label: string) => {
  const match = value?.match(new RegExp(`(?:^|\\n)${label}\\s*:\\s*([^\\n]*)`, 'i'));
  return match?.[1] || '';
};
const responseJob = (value: unknown): BudgetJob | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const candidate = (record.job && typeof record.job === 'object' ? record.job : record) as Partial<BudgetJob> & { runId?: string };
  const id = typeof candidate.id === 'string' ? candidate.id : candidate.runId;
  return typeof id === 'string' ? { ...candidate, id } as BudgetJob : null;
};

function Message({ children, error = false, onClose }: { children: string; error?: boolean; onClose: () => void }) {
  return <div role={error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-800'}`}><AlertCircle size={17} className="shrink-0" /><span className="min-w-0 flex-1">{children}</span><button type="button" onClick={onClose} aria-label="Fermer l’alerte" className="-mr-1 -mt-1 rounded p-1 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"><X size={16} /></button></div>;
}

export default function BudgetPage({ missions, base, filters, clientKeys, clients }: { missions: MissionOption[]; base: string; filters: PreventionQuery; clientKeys: string[]; clients: ClientOption[] }) {
  const scopeKey = budgetSelectionKey({ preset: filters.preset || 'ALL', from: filters.from, to: filters.to, categoryId: filters.categoryId, severity: filters.severity, missionId: filters.missionId, clientKeys });
  const currentScope = useRef({ key: scopeKey, generation: 0 });
  if (currentScope.current.key !== scopeKey) currentScope.current = { key: scopeKey, generation: currentScope.current.generation + 1 };
  const scopeGeneration = currentScope.current.generation;
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [materializedItems, setMaterializedItems] = useState<BudgetItem[]>([]);
  const [materializedTotalHt, setMaterializedTotalHt] = useState<string | null>(null);
  const [globalTotal, setGlobalTotal] = useState<BudgetGlobalTotal | null>(null);
  const [globalTotalRefresh, setGlobalTotalRefresh] = useState(0);
  const [materializedTooLarge, setMaterializedTooLarge] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [justificationItemId, setJustificationItemId] = useState<string | null>(null);
  const [job, setJob] = useState<BudgetJob | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [totalReports, setTotalReports] = useState(0);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [confirmation, setConfirmation] = useState<BudgetConfirmation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const budgetJobStorageKey = `prevention.budget.job.${scopeKey}`;
  const filteredView = filters.preset !== 'ALL' || Boolean(filters.categoryId || filters.severity || filters.missionId || clientKeys.length);

  useEffect(() => {
    if (!filteredView) { setGlobalTotal(null); return; }
    let active = true;
    const expectedGeneration = scopeGeneration;
    setGlobalTotal(null);
    void (async () => {
      const globalQuery = budgetGlobalSelectionQuery();
      const scope = await preventionAPI.budgetScope(globalQuery) as { scenario?: Budget | null };
      let next: BudgetGlobalTotal;
      if (scope.scenario?.id) {
        const detail = await preventionAPI.budget(scope.scenario.id, { clientKeys: [] }) as { scenario?: Budget };
        next = { amount: detail.scenario?.retainedBudgetHt ?? null, provisional: false };
      } else {
        const materialized = await preventionAPI.budgetMaterialized(globalQuery) as { availableTotalHt?: string | null };
        next = { amount: materialized.availableTotalHt ?? null, provisional: true };
      }
      if (active && currentScope.current.generation === expectedGeneration) setGlobalTotal(next);
    })().catch((reason) => {
      if (active && currentScope.current.generation === expectedGeneration) {
        setGlobalTotal({ amount: null, provisional: false });
        setError(errorMessage(reason));
      }
    });
    return () => { active = false; };
  }, [filteredView, scopeGeneration, globalTotalRefresh]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    refreshTimers.current.forEach(clearTimeout);
    refreshTimers.current = [];
    setSaving(null);
    setJob(null);
    setError(null);
    setNotice(null);
    setJustificationItemId(null);
    setConfirmation(null);
  }, [scopeGeneration]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const categoriesResponse = await preventionAPI.categories();
      setCategories(asList<CategoryOption>(categoriesResponse, ['items', 'data']).filter((category) => category.id && category.label).sort((a, b) => a.label.localeCompare(b.label, 'fr')));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }, []);

  const loadBudgetDetail = useCallback(async (id: string, expectedGeneration = scopeGeneration) => {
    const response = await preventionAPI.budget(id, { clientKeys });
    if (currentScope.current.generation !== expectedGeneration) return null;
    if (!response || typeof response !== 'object') return null;
    const detail = response as { scenario?: Budget; items?: BudgetItem[] };
    if (!detail.scenario) return null;
    const scenario = detail.scenario;
    setSelectedId((current) => current === id ? scenario.id : current);
    setBudgets((current) => {
      const next = current.map((entry) => entry.id === id || entry.scenarioKey === scenario.scenarioKey
        ? { ...entry, ...scenario, items: detail.items || [] }
        : entry);
      if (!next.some((entry) => entry.id === scenario.id)) next.unshift({ ...scenario, items: detail.items || [] });
      return next;
    });
    return detail;
  }, [clientKeys, scopeGeneration]);

  const loadMaterialized = useCallback(async (expectedGeneration = scopeGeneration) => {
    const query = budgetScopeSelectionQuery({ preset: filters.preset || 'ALL', from: filters.from, to: filters.to, categoryId: filters.categoryId, severity: filters.severity, missionId: filters.missionId, clientKeys });
    const response = await preventionAPI.budgetMaterialized(query) as { items?: BudgetItem[]; tooLarge?: boolean; totalReports?: number; availableTotalHt?: string | null };
    if (currentScope.current.generation !== expectedGeneration) return;
    setMaterializedItems(response.items || []);
    setMaterializedTotalHt(response.availableTotalHt ?? null);
    setMaterializedTooLarge(Boolean(response.tooLarge));
    setTotalReports(Number(response.totalReports ?? 0));
  }, [filters.preset, filters.from, filters.to, filters.categoryId, filters.severity, filters.missionId, clientKeys, scopeGeneration]);

  useEffect(() => { void load(); return () => { if (timer.current) clearTimeout(timer.current); refreshTimers.current.forEach(clearTimeout); }; }, [load]);
  useEffect(() => {
    let active = true;
    setSelectedId('');
    setMaterializedItems([]);
    setMaterializedTotalHt(null);
    setMaterializedTooLarge(false);
    setScopeLoading(true);
    const query = budgetScopeSelectionQuery({ preset: filters.preset || 'ALL', from: filters.from, to: filters.to, categoryId: filters.categoryId, severity: filters.severity, missionId: filters.missionId, clientKeys });
    void preventionAPI.budgetScope(query).then(async (response) => {
      if (!active) return;
      const result = response as { scenario?: Budget | null; totalReports?: number };
      setTotalReports(Number(result.totalReports ?? 0));
      setSelectedId(result.scenario?.id || '');
      if (!result.scenario?.id) await loadMaterialized(scopeGeneration);
    }).catch((reason) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setScopeLoading(false); });
    return () => { active = false; };
  }, [filters.preset, filters.from, filters.to, filters.categoryId, filters.severity, filters.missionId, clientKeys, loadMaterialized, scopeGeneration]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void loadBudgetDetail(selectedId).catch((reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [selectedId, loadBudgetDetail]);
  const selected = useMemo<Budget | null>(() => budgets.find((entry) => entry.id === selectedId) ||
    materializedBudgetSelection(materializedItems, materializedTotalHt), [budgets, selectedId, materializedItems, materializedTotalHt]);
  const materializedView = selected?.id === 'materialized-results';
  const displayedTotalHt = filteredView && selected
    ? sumDisplayedBudgetAmounts(selected.items || [], itemAmount)
    : selected?.retainedBudgetHt ?? selected?.totalBudgetHt;
  const justificationItem = selected?.items?.find((item) => item.id === justificationItemId) || null;
  const reportCount = new Set((selected?.items || []).flatMap((item) => [
    ...(item.justificationDetails?.reports || []).map((report) => report.id),
    ...(item.sources || []).map((source) => source.reportId).filter((id): id is string => Boolean(id)),
  ])).size;
  const findingCount = new Set((selected?.items || []).flatMap((item) =>
    (item.sources || []).map((source) => source.findingId).filter((id): id is string => Boolean(id)),
  )).size;
  const estimatedCount = (selected?.items || []).filter((item) => item.aiEstimateDetails?.kind === 'AI_ESTIMATE' || Boolean(item.sourceReportEstimates?.length)).length;
  const unpricedCount = (selected?.items || []).filter((item) => item.status === 'A_CHIFFRER').length;
  const periodStart = selected?.periodStart || (filters.preset === 'CUSTOM' ? filters.from : undefined);
  const periodEnd = selected?.periodEnd || (filters.preset === 'CUSTOM' ? filters.to : undefined);
  const categoryFilterLabel = filters.categoryId
    ? categories.find((category) => category.id === filters.categoryId)?.label || 'Catégorie sélectionnée'
    : 'Toutes catégories';
  const severityFilterLabel = filters.severity
    ? ({ critique: 'Critique', eleve: 'Élevé', moyen: 'Moyen', faible: 'Faible' }[filters.severity])
    : 'Toutes gravités';

  const completeJob = useCallback(async (current: BudgetJob, successMessage: string, targetScenarioId: string | undefined, requestGeneration: number) => {
    const completedScenarioId = current.finalScenarioId || budgetRefreshScenarioId(current, targetScenarioId);
    const detail = completedScenarioId ? await loadBudgetDetail(completedScenarioId, requestGeneration) : null;
    if (currentScope.current.generation !== requestGeneration) return;
    if (detail?.scenario) {
      setSelectedId(detail.scenario.id);
      setNotice(budgetCalculationOutcome(detail.items || [], successMessage));
    } else setError('Le calcul est terminé, mais le budget actualisé est introuvable. Rechargez la page.');
  }, [loadBudgetDetail]);

  const refreshVisibleScope = useCallback(async (requestGeneration: number) => {
    const query = budgetScopeSelectionQuery({ preset: filters.preset || 'ALL', from: filters.from, to: filters.to, categoryId: filters.categoryId, severity: filters.severity, missionId: filters.missionId, clientKeys });
    const response = await preventionAPI.budgetScope(query) as { scenario?: Budget | null; totalReports?: number };
    if (currentScope.current.generation !== requestGeneration) return;
    setTotalReports(Number(response.totalReports ?? 0));
    if (response.scenario?.id) {
      await loadBudgetDetail(response.scenario.id, requestGeneration);
      if (currentScope.current.generation === requestGeneration) setSelectedId(response.scenario.id);
    } else {
      setSelectedId('');
      await loadMaterialized(requestGeneration);
    }
    setGlobalTotalRefresh((value) => value + 1);
  }, [filters.preset, filters.from, filters.to, filters.categoryId, filters.severity, filters.missionId, clientKeys, loadBudgetDetail, loadMaterialized]);

  const refreshAfterJob = useCallback((requestGeneration: number) => {
    // The bounded job can finish before its asynchronous ALL reconciliation.
    // Re-read server-published versions for a bounded interval, without changing filters.
    refreshTimers.current.push(...scheduleBudgetPublishedRefresh(
      () => refreshVisibleScope(requestGeneration),
      () => currentScope.current.generation === requestGeneration,
      (reason) => setError(errorMessage(reason)),
    ));
  }, [refreshVisibleScope]);

  const pollJob = useCallback((id: string, successMessage = 'Le recalcul budgétaire est terminé.', attempt = 0, targetScenarioId = selectedId, requestGeneration = scopeGeneration, updateDisplay = true, refreshMaterialized = false) => {
    if (currentScope.current.generation !== requestGeneration) return;
    const pollDelay = attempt >= 300 ? 30_000 : 2_000;
    void preventionAPI.budgetJob(id).then((next) => {
      if (currentScope.current.generation !== requestGeneration) return;
      const current = next as BudgetJob;
      setJob(current);
      if (['COMPLETED', 'PUBLISHED', 'FAILED', 'QUARANTINED'].includes(String(current.status).toUpperCase())) {
        setSaving(null);
        sessionStorage.removeItem(budgetJobStorageKey);
        if (['COMPLETED', 'PUBLISHED'].includes(String(current.status).toUpperCase())) {
          refreshAfterJob(requestGeneration);
          if (refreshMaterialized) void loadMaterialized(requestGeneration).then(() => setNotice(successMessage)).catch((reason) => { if (currentScope.current.generation === requestGeneration) setError(errorMessage(reason)); });
          else if (updateDisplay) void completeJob(current, successMessage, targetScenarioId, requestGeneration).catch((reason) => { if (currentScope.current.generation === requestGeneration) setError(errorMessage(reason)); });
          else setNotice('Le calcul est terminé. Les filtres de résultats affichés sont inchangés.');
        } else setError(current.failedReason || current.lastError || 'Le recalcul budgétaire a échoué.');
        return;
      }
      timer.current = setTimeout(() => pollJob(id, successMessage, attempt + 1, targetScenarioId, requestGeneration, updateDisplay, refreshMaterialized), pollDelay);
    }).catch((reason) => { if (currentScope.current.generation === requestGeneration) { setSaving(null); setError(errorMessage(reason)); } });
  }, [budgetJobStorageKey, completeJob, loadMaterialized, refreshAfterJob, scopeGeneration, selectedId]);

  useEffect(() => {
    const storedValue = sessionStorage.getItem(budgetJobStorageKey);
    if (!storedValue) return;
    let storedId = storedValue;
    let updateDisplay = true;
    let refreshMaterialized = false;
    try {
      const parsed = JSON.parse(storedValue) as { id?: string; updateDisplay?: boolean; refreshMaterialized?: boolean };
      if (parsed.id) { storedId = parsed.id; updateDisplay = parsed.updateDisplay !== false; refreshMaterialized = parsed.refreshMaterialized === true; }
    } catch { /* Legacy session value contains only the job identifier. */ }
    let active = true;
    const resume = async () => {
      try {
        const next = await preventionAPI.budgetJob(storedId) as BudgetJob;
        if (!active || currentScope.current.generation !== scopeGeneration) return;
        setJob(next);
        const status = String(next.status || '').toUpperCase();
        if (['COMPLETED', 'PUBLISHED', 'FAILED', 'QUARANTINED'].includes(status)) {
          setSaving(null);
          sessionStorage.removeItem(budgetJobStorageKey);
          if (['COMPLETED', 'PUBLISHED'].includes(status)) {
            refreshAfterJob(scopeGeneration);
            if (refreshMaterialized) { await loadMaterialized(scopeGeneration); setNotice('Le poste budgétaire a été recalculé.'); }
            else if (updateDisplay) await completeJob(next, 'Le calcul budgétaire est terminé.', next.finalScenarioId || next.scenarioId || next.targetScenarioId || selectedId, scopeGeneration);
            else setNotice('Le calcul est terminé. Les filtres de résultats affichés sont inchangés.');
          }
          else setError(next.failedReason || next.lastError || 'Le recalcul budgétaire a échoué.');
          return;
        }
        timer.current = setTimeout(() => void resume(), 3000);
      } catch { if (active) sessionStorage.removeItem(budgetJobStorageKey); }
    };
    void resume();
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
  }, [budgetJobStorageKey, completeJob, loadMaterialized, refreshAfterJob, scopeGeneration, selectedId]);

  const requestScopePreview = async (mode: BudgetConfirmation['mode'], selection: BudgetExecutionSelection): Promise<BudgetScopePreview> => {
    const response = await preventionAPI.budgetPreview({ mode, ...budgetExecutionPeriod(mode, selection), categoryId: selection.categoryId, severity: selection.severity, missionId: selection.missionId, clientKeys: selection.clientKeys });
    return (response && typeof response === 'object' ? response : {}) as BudgetScopePreview;
  };

  const recalculate = async (confirmedMode?: 'FILTERED' | 'CURRENT_YEAR' | 'GLOBAL_YEARLY', confirmationToken?: string) => {
    const activeConfirmation = confirmation;
    if (!confirmedMode) {
      setSaving('preview'); setError(null); setNotice(null);
      try {
        const mode = filters.preset === 'ALL' ? 'CURRENT_YEAR' : 'FILTERED';
        const selection: BudgetExecutionSelection = budgetExecutionSnapshot({ ...filters, clientKeys });
        const preview = await requestScopePreview(mode, selection);
        setConfirmation({ preview, mode, globalArmed: false, selection });
      } catch (reason) { setError(errorMessage(reason)); }
      finally { setSaving(null); }
      return;
    }
    const requestGeneration = currentScope.current.generation;
    const updateDisplay = activeConfirmation ? budgetExecutionMatchesDisplay(confirmedMode, activeConfirmation.selection, { ...filters, clientKeys }) : false;
    setSaving('recalculate'); setError(null); setNotice(null);
    try {
      if (!activeConfirmation?.preview || !activeConfirmation.selection) throw new Error('Mesurez le périmètre avant de confirmer le calcul.');
      const response = await preventionAPI.budgetCommand(budgetCommandPayload(confirmedMode, activeConfirmation.selection, confirmationToken || (activeConfirmation.mode === confirmedMode ? activeConfirmation.preview.confirmationToken : '') || ''));
      if (currentScope.current.generation !== requestGeneration) return;
      const command = response as { result?: { scenario?: Budget | null; job?: BudgetJob | null; totalReports?: number }; preview?: BudgetScopePreview; admission?: { status?: string; scheduledFor?: string | null } };
      const scoped = command.result || command as { scenario?: Budget | null; job?: BudgetJob | null; totalReports?: number };
      const scopedScenario = scoped.scenario;
      if (scopedScenario?.id && updateDisplay) {
        setBudgets((current) => current.some((entry) => entry.id === scopedScenario.id) ? current : [scopedScenario, ...current]);
        setSelectedId(scopedScenario.id);
      }
      if (updateDisplay && scoped.totalReports !== undefined) setTotalReports(Number(scoped.totalReports));
      const created = responseJob(scoped);
      setJob(created);
      if (created?.id) sessionStorage.setItem(budgetJobStorageKey, JSON.stringify({ id: created.id, updateDisplay }));
      if (created?.id) pollJob(created.id, 'Le calcul budgétaire est terminé.', 0, scoped.scenario?.id, requestGeneration, updateDisplay);
      else if (String(command.admission?.status || '').toUpperCase() === 'DEFERRED' || String(command.admission?.status || '').toUpperCase() === 'SCHEDULED') { setNotice(`Calcul programmé${parisDateTime(command.admission?.scheduledFor) ? ` pour ${parisDateTime(command.admission?.scheduledFor)} (heure de Paris)` : ''}.`); setSaving(null); }
      else { setSaving(null); setConfirmation(null); }
      if (created?.id || command.admission?.status) setConfirmation(null);
    } catch (reason) {
      if (currentScope.current.generation === requestGeneration) {
        setSaving(null);
        if (errorStatus(reason) === 409) {
          const payload = errorPayload(reason) as { preview?: BudgetScopePreview } | null;
          const freshPreview = payload?.preview || (payload && typeof payload === 'object' ? payload as BudgetScopePreview : null);
          if (freshPreview) setConfirmation((current) => current ? { ...current, preview: freshPreview, globalArmed: false } : activeConfirmation ? { ...activeConfirmation, preview: freshPreview, globalArmed: false } : null);
          const slot = freshPreview?.scheduledFor || (typeof freshPreview?.admission === 'object' ? freshPreview.admission.scheduledFor : null);
          setError(`Le périmètre a changé depuis la prévisualisation${parisDateTime(slot) ? ` · nouveau créneau : ${parisDateTime(slot)} (heure de Paris)` : ''}. Vérifiez les nouvelles mesures puis confirmez à nouveau.`);
        } else setError(errorMessage(reason));
      }
    }
  };

  const recalculateItem = async (item: BudgetItem, adminPrompt: string) => {
    if (!selected) return;
    if (filters.missionId && item.materializedOnly && item.originMissionId !== filters.missionId) {
      setError('Calculez d’abord le budget de ce chantier avant de réestimer ce poste ; son estimation actuelle provient d’un périmètre plus large.');
      return;
    }
    const requestGeneration = currentScope.current.generation;
    setSaving(`recalculate:${item.id}`); setError(null); setNotice(null);
    try {
      const target = item.materializedOnly ? budgetMaterializedTarget(item) : null;
      const response = target
        ? await preventionAPI.recalculateMaterializedBudgetItem(target.scenarioId, target.itemId, budgetItemRecalculationPayload(target.expectedVersion, adminPrompt))
        : await preventionAPI.recalculateBudgetItem(selected.id, item.id, budgetItemRecalculationPayload(selected.version, adminPrompt));
      if (currentScope.current.generation !== requestGeneration) return;
      const created = responseJob(response);
      if (!created?.id) { setSaving(null); setError('Le recalcul de la ligne n’a pas fourni de tâche de suivi.'); return; }
      setJob(created);
      if (item.materializedOnly) sessionStorage.setItem(budgetJobStorageKey, JSON.stringify({ id: created.id, updateDisplay: false, refreshMaterialized: true }));
      pollJob(created.id, 'Le poste budgétaire a été recalculé.', 0, selected.id, requestGeneration, !item.materializedOnly, Boolean(item.materializedOnly));
    } catch (reason) { if (currentScope.current.generation === requestGeneration) { setSaving(null); setError(errorMessage(reason)); } }
  };

  const saveItem = async (item: BudgetItem, form: HTMLFormElement) => {
    if (!selected) return;
    if (filters.missionId && item.materializedOnly && item.originMissionId !== filters.missionId) {
      setError('Calculez d’abord le budget de ce chantier avant de modifier ce poste ; sa version actuelle appartient à un périmètre plus large.');
      return;
    }
    const requestGeneration = currentScope.current.generation;
    const data = new FormData(form);
    const unitCostRaw = String(data.get('unitCostHt') || '').trim();
    const priceSource = String(data.get('priceSource') || '').trim();
    if (unitCostRaw && !priceSource) { setError('Une source de prix est obligatoire pour une ligne chiffrée.'); return; }
    setSaving(item.id); setError(null); setNotice(null);
    let waitingForJob = false;
    try {
      const justification = ['Contexte', 'Observations', 'Base réglementaire', 'Données vérifiées', 'Décomposition du coût']
        .map((label) => `${label} : ${String(data.get(label) || '').trim()}`)
        .filter((entry) => !entry.endsWith(': ')).join('\n');
      const amountRaw = String(data.get('amountHt') || '').trim();
      const target = item.materializedOnly ? budgetMaterializedTarget(item) : null;
      const payload = { expectedVersion: target?.expectedVersion ?? selected.version, quantity: amountRaw ? 1 : Number(data.get('quantity')), unit: amountRaw ? 'FORFAIT' : (data.has('unit') ? String(data.get('unit')).trim() : undefined), unitCostHt: amountRaw || (unitCostRaw ? Number(data.get('unitCostHt')) : null), priceSource: priceSource || null, status: data.get('status'), justification: justification || null, categoryId: String(data.get('categoryId') || '') || undefined, lockedManual: data.get('lockedManual') === 'on', ...(!item.materializedOnly ? { sources: item.sources?.filter((source) => source.reportId).map((source) => ({ sourceKind: source.sourceKind || 'REPORT', findingId: source.findingId, reportId: source.reportId })) } : {}) };
      const response = target
        ? await preventionAPI.updateMaterializedBudgetItem(target.scenarioId, target.itemId, payload)
        : await preventionAPI.updateBudgetItem(selected.id, item.id, payload);
      if (currentScope.current.generation !== requestGeneration) return;
      const created = responseJob(response);
      if (created?.id) { waitingForJob = true; setJob(created); pollJob(created.id, 'La ligne budgétaire a été enregistrée.', 0, selected.id, requestGeneration); }
      else {
        const updatedScenarioId = (response as { scenario?: { id?: string } })?.scenario?.id;
        if (item.materializedOnly) await loadMaterialized(requestGeneration);
        else if (updatedScenarioId) {
          const detail = await loadBudgetDetail(updatedScenarioId, requestGeneration);
          if (currentScope.current.generation !== requestGeneration) return;
          if (detail?.scenario) setSelectedId(detail.scenario.id);
        }
        setGlobalTotalRefresh((value) => value + 1);
        setSaving(null);
        setNotice('Ligne budgétaire enregistrée.');
      }
    } catch (reason) { if (currentScope.current.generation === requestGeneration) setError(errorMessage(reason)); }
    finally { if (!waitingForJob && currentScope.current.generation === requestGeneration) setSaving(null); }
  };

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-slate-500"><Loader2 className="animate-spin" /> Chargement du budget…</div>;
  const preview = confirmation?.preview;
  const scheduledFor = preview?.scheduledFor || (typeof preview?.admission === 'object' ? preview.admission.scheduledFor : null);
  const scheduleLabel = parisDateTime(scheduledFor);
  const admissionValue = typeof preview?.admission === 'string' ? preview.admission : preview?.threshold?.decision;
  const admissionLabel = String(admissionValue || '').toUpperCase() === 'NIGHT_ONLY' || String(admissionValue || '').toUpperCase() === 'SCHEDULED'
    ? `Programmation nocturne${scheduleLabel ? ` · première fenêtre : ${scheduleLabel} (heure de Paris)` : ''}`
    : 'Lancement immédiat';
  const previewReports = preview?.totals?.reportCount ?? preview?.totalReports;
  const previewRecommendations = preview?.totals?.recommendationCount;
  const previewEstimations = preview?.totals?.estimationWorkloadCount ?? preview?.estimatedAiCalls;
  const previewCeiling = preview?.threshold?.ceilings?.immediateReports ?? preview?.immediateCeiling;
  return <div className="space-y-5">
    {error && <Message error onClose={() => setError(null)}>{error}</Message>}{notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 size={17} className="shrink-0" /><span className="min-w-0 flex-1">{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Fermer l’alerte" className="-mr-1 -mt-1 rounded p-1 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"><X size={16} /></button></div>}
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-[17px] font-extrabold text-[#1e3a5f]"><WalletCards className="text-[#e87722]" size={18} />Budget estimatif sécurité</h2><p className="mt-1 text-xs font-semibold text-[#1e3a5f]">Période {materializedView ? 'consultée' : selected ? 'calculée' : 'demandée'} : {filters.preset === 'ALL' ? 'Toute la période' : `${periodDate(periodStart)} → ${periodDate(periodEnd)}`} · {categoryFilterLabel} · {severityFilterLabel} · {filters.missionId ? `Chantier : ${missions.find((mission) => mission.id === filters.missionId)?.title || 'sélectionné'}` : 'Tous les chantiers'} · {clientKeys.length ? `${clientKeys.length} client(s)` : 'Tous les clients'}</p><p className="mt-2 text-xs text-[#8a97b0]">{reportCount} rapport(s) concernés parmi {totalReports} rapport(s) du périmètre · {findingCount} recommandation(s) · {estimatedCount} estimation(s) IA · {unpricedCount} poste(s) à chiffrer. La barre représente la couverture des rapports, pas le montant.</p></div><button type="button" disabled={saving !== null || scopeLoading} onClick={() => void recalculate()} className="inline-flex items-center gap-2 rounded-md bg-[#e87722] px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#d96b1d] disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw size={14} className={saving === 'recalculate' || saving === 'preview' ? 'animate-spin' : ''} />{saving === 'preview' ? 'Mesure du périmètre…' : saving === 'recalculate' ? 'Calcul en cours…' : selected && !materializedView ? 'Recalculer cette sélection' : 'Calculer une sélection'}</button></header>
    {job && dismissedJobId !== job.id && !['COMPLETED', 'PUBLISHED', 'FAILED', 'QUARANTINED'].includes(String(job.status || '').toUpperCase()) && <div role="status" className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"><span className="min-w-0 flex-1">Calcul {String(job.status || 'en cours').toLowerCase()} pour les filtres sélectionnés…{job.progress?.processedItems != null ? ` ${job.progress.processedItems}${job.progress.totalItems != null ? `/${job.progress.totalItems}` : ''} poste(s).` : ''}</span><button type="button" onClick={() => setDismissedJobId(job.id)} aria-label="Fermer l’alerte" className="-mr-1 -mt-1 rounded p-1 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"><X size={16} /></button></div>}
    {scopeLoading ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Chargement du périmètre budgétaire…</div> : !selected ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">{materializedTooLarge ? 'Trop de résultats enregistrés pour une lecture unique. Réduisez les filtres de consultation.' : 'Aucun résultat budgétaire enregistré pour ces filtres. Vous pouvez lancer un calcul distinct.'}</div> : <>
      <BudgetOverviewTable key={selected.id} items={selected.items || []} total={displayedTotalHt} globalTotal={globalTotal} partial={materializedView} filtered={filteredView} totalReports={totalReports} onJustify={(item) => setJustificationItemId(item.id)} />
      {justificationItem && <BudgetJustificationModal item={justificationItem} base={base} saving={saving} onSave={saveItem} onRecalculate={recalculateItem} onClose={() => setJustificationItemId(null)} />}
      <div hidden />
    </>}
    {confirmation && <BudgetCalculationModal
      confirmation={confirmation} categories={categories} clients={clients} missions={missions}
      previewReports={previewReports} previewRecommendations={previewRecommendations}
      previewEstimations={previewEstimations} previewCeiling={previewCeiling} admissionLabel={admissionLabel}
      onChange={(next) => setConfirmation(next)}
      onMeasure={() => {
        const current = confirmation;
        setSaving('preview'); setError(null);
        void requestScopePreview(current.mode, current.selection).then((next) => {
          setConfirmation((latest) => latest && latest.mode === current.mode && budgetSelectionKey(latest.selection) === budgetSelectionKey(current.selection)
            ? { ...latest, preview: next, globalArmed: false } : latest);
        }).catch((reason) => setError(errorMessage(reason))).finally(() => setSaving(null));
      }}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => { if (!confirmation.preview?.confirmationToken) return; if (confirmation.mode === 'GLOBAL_YEARLY' && !confirmation.globalArmed) { setConfirmation({ ...confirmation, globalArmed: true }); return; } void recalculate(confirmation.mode, confirmation.preview.confirmationToken); }}
      measuring={saving === 'preview'}
    />}
  </div>;
}

function categoryBadge(category: string) {
  const value = category.toLocaleLowerCase('fr');
  if (value.includes('hauteur')) return 'bg-purple-50 text-purple-700';
  if (value.includes('epi')) return 'bg-rose-50 text-rose-700';
  if (value.includes('éclairage') || value.includes('eclairage')) return 'bg-amber-50 text-amber-700';
  if (value.includes('circulation')) return 'bg-violet-50 text-violet-700';
  if (value.includes('électrique') || value.includes('electrique')) return 'bg-cyan-50 text-cyan-700';
  if (value.includes('équipement') || value.includes('equipement')) return 'bg-slate-100 text-slate-700';
  if (value.includes('organisation')) return 'bg-blue-50 text-blue-800';
  return 'bg-orange-50 text-orange-700';
}

function BudgetCalculationModal({ confirmation, categories, clients, missions, previewReports, previewRecommendations, previewEstimations, previewCeiling, admissionLabel, onChange, onMeasure, onCancel, onConfirm, measuring }: {
  confirmation: BudgetConfirmation; categories: CategoryOption[]; clients: ClientOption[]; missions: MissionOption[];
  previewReports?: number; previewRecommendations?: number; previewEstimations?: number; previewCeiling?: number; admissionLabel: string;
  onChange: (next: BudgetConfirmation) => void; onMeasure: () => void; onCancel: () => void; onConfirm: () => void; measuring: boolean;
}) {
  const { selection, preview, mode } = confirmation;
  const changeSelection = (patch: Partial<BudgetExecutionSelection>, nextMode = mode) => onChange({
    ...confirmation, selection: { ...selection, ...patch }, mode: nextMode, preview: null, globalArmed: false,
  });
  const periodOptions: Array<{ value: PreventionPreset; label: string }> = [
    { value: 'ALL', label: 'Toute la période' }, { value: 'CURRENT_YEAR', label: 'Année en cours' },
    { value: 'LAST_7_DAYS', label: '7 derniers jours' }, { value: 'LAST_30_DAYS', label: '30 derniers jours' },
    { value: 'CURRENT_QUARTER', label: 'Trimestre en cours' }, { value: 'LAST_6_MONTHS', label: '6 derniers mois' },
    { value: 'LAST_12_MONTHS', label: '12 derniers mois' }, { value: 'CUSTOM', label: 'Période personnalisée' },
  ];
  const canMeasure = mode !== 'FILTERED' || selection.preset !== 'CUSTOM' || Boolean(selection.from && selection.to);
  const filterLabelClass = 'text-[9px] font-bold uppercase text-[#8a97b0]';
  const filterControlClass = 'mt-[2px] block w-full rounded-md border border-[#d0d9e8] bg-white px-[9px] py-[6px] text-[12px] font-medium normal-case text-[#1e3a5f]';
  return <div role="dialog" aria-modal="true" aria-labelledby="budget-scope-confirm-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
    <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
      <h3 id="budget-scope-confirm-title" className="text-base font-extrabold text-[#1e3a5f]">Périmètre du calcul budgétaire</h3>
      <p className="mt-2 text-sm text-slate-600">Ces sélections sont copiées depuis l’écran. Les modifier ici ne change pas les filtres affichés et aucun job ne démarre avant confirmation.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className={filterLabelClass}>Période de départ<select value={selection.preset || 'ALL'} onChange={(event) => {
          const preset = event.target.value as PreventionPreset;
          changeSelection({ preset, from: preset === 'CUSTOM' ? selection.from : undefined, to: preset === 'CUSTOM' ? selection.to : undefined }, budgetModeAfterPeriodChange(preset, mode));
        }} className={filterControlClass}>{periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className={filterLabelClass}>Mode de calcul<select value={mode} onChange={(event) => onChange({ ...confirmation, mode: event.target.value as BudgetConfirmation['mode'], preview: null, globalArmed: false })} className={filterControlClass}>
          {selection.preset !== 'ALL' && <option value="FILTERED">Période sélectionnée</option>}
          <option value="CURRENT_YEAR">Année en cours</option>
          <option value="GLOBAL_YEARLY">Toutes les années</option>
        </select></label>
        {selection.preset === 'CUSTOM' && <><label className={filterLabelClass}>Du<input type="date" value={selection.from || ''} onChange={(event) => changeSelection({ from: event.target.value })} className={filterControlClass} /></label><label className={filterLabelClass}>Au<input type="date" value={selection.to || ''} onChange={(event) => changeSelection({ to: event.target.value })} className={filterControlClass} /></label></>}
        <label className={filterLabelClass}>Catégorie<select value={selection.categoryId || ''} onChange={(event) => changeSelection({ categoryId: event.target.value || undefined })} className={filterControlClass}><option value="">Toutes</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
        <label className={filterLabelClass}>Gravité<select value={selection.severity || ''} onChange={(event) => changeSelection({ severity: event.target.value ? event.target.value as PreventionQuery['severity'] : undefined })} className={filterControlClass}><option value="">Toutes</option><option value="critique">Critique</option><option value="eleve">Élevé</option><option value="moyen">Moyen</option><option value="faible">Faible</option></select></label>
        <div className={`${filterLabelClass} sm:col-span-2`}><span>Client</span><ClientMultiSelect appearance="form" clients={clients} selectedKeys={selection.clientKeys} onChange={(keys) => changeSelection({ clientKeys: keys })} /></div>
        <label className={filterLabelClass}>Chantier<select value={selection.missionId || ''} onChange={(event) => changeSelection({ missionId: event.target.value || undefined })} className={filterControlClass}><option value="">Tous les chantiers</option>{missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title || mission.name || mission.id}</option>)}</select></label>
      </div>
      {preview ? <><dl className="mt-4 grid grid-cols-3 gap-2 text-xs">{[['Rapports', previewReports], ['Recommandations', previewRecommendations], ['Estimations', previewEstimations]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-lg font-bold text-[#1e3a5f]">{value ?? '—'}</dd></div>)}</dl><p className="mt-3 text-xs text-slate-600">Plafond immédiat : <strong>{previewCeiling ?? '—'}</strong> · <strong>{admissionLabel}</strong></p>{preview.years?.length ? <p className="mt-1 text-xs text-slate-500">Années présentes : {preview.years.map((year) => year.year).filter(Boolean).join(', ')}</p> : null}</> : <p className="mt-4 text-xs text-amber-700">Périmètre modifié : mesurez-le à nouveau avant de confirmer.</p>}
      {mode === 'GLOBAL_YEARLY' && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Le calcul global peut durer plusieurs nuits. Une seconde confirmation est requise.</div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700" onClick={onCancel}>Annuler</button><button type="button" disabled={!canMeasure || measuring} className="rounded-md border border-[#1e3a5f] px-3 py-2 text-xs font-bold text-[#1e3a5f] disabled:opacity-50" onClick={onMeasure}>{measuring ? 'Mesure…' : 'Mesurer ce périmètre'}</button><button type="button" disabled={!preview?.confirmationToken || measuring} className="rounded-md bg-[#e87722] px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={onConfirm}>{mode === 'GLOBAL_YEARLY' ? confirmation.globalArmed ? 'Confirmer toutes les années' : 'Deuxième confirmation — toutes les années' : 'Confirmer et calculer'}</button></div>
    </div>
  </div>;
}

function BudgetOverviewTable({ items, total, globalTotal, partial = false, filtered = false, totalReports, onJustify }: { items: BudgetItem[]; total?: number | string | null; globalTotal?: BudgetGlobalTotal | null; partial?: boolean; filtered?: boolean; totalReports: number; onJustify: (item: BudgetItem) => void }) {
  const pageSize = 10;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  if (!items.length) return partial || filtered
    ? <section aria-label="Postes du budget estimatif" className="rounded-xl border border-dashed border-slate-300 bg-white p-6"><p className="text-sm text-slate-500">Aucun poste budgétaire enregistré pour cette sélection.</p><div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-bold text-[#1e3a5f]"><span>{filtered ? 'TOTAL FILTRÉ HT' : 'TOTAL GLOBAL PROVISOIRE HT'}</span><span>{total == null ? '—' : money(total)}</span></div>{filtered && <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-bold text-[#1e3a5f]"><span>{globalTotal?.provisional ? 'TOTAL GLOBAL PROVISOIRE HT' : 'TOTAL GLOBAL HT'}</span><span>{globalTotal ? globalTotal.amount == null ? '—' : money(globalTotal.amount) : 'Chargement…'}</span></div>}<p className="mt-2 text-xs text-slate-500">Somme des montants disponibles pour cette sélection, hors postes à chiffrer.</p></section>
    : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">Aucun poste budgétaire pour ce scénario.</div>;
  const visibleItems = items.slice((page - 1) * pageSize, page * pageSize);
  return <section aria-label="Postes du budget estimatif" className="overflow-hidden rounded-[10px] border border-[#e5e9f0] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"><table className="w-full table-fixed border-collapse text-left text-[12px] leading-[1.4]"><colgroup><col className="w-[6%] md:w-[4%]" /><col className="w-[42%] md:w-[34%]" /><col className="hidden w-[14%] md:table-column" /><col className="hidden w-[14%] md:table-column" /><col className="hidden w-[15%] lg:table-column" /><col className="w-[22%] md:w-[13%]" /><col className="w-[24%] md:w-[8%]" /></colgroup><thead><tr className="bg-[#f8fafc] text-[10px] font-extrabold uppercase tracking-[.15px] text-[#718096]"><th className="border-b-2 border-[#e5e9f0] px-1.5 py-2 md:px-3">#</th><th className="border-b-2 border-[#e5e9f0] px-1.5 py-2 md:px-3">Poste budgétaire</th><th className="hidden border-b-2 border-[#e5e9f0] px-3 py-2 md:table-cell">Catégorie</th><th className="hidden border-b-2 border-[#e5e9f0] px-3 py-2 md:table-cell">Client</th><th className="hidden border-b-2 border-[#e5e9f0] px-3 py-2 lg:table-cell">Rapports concernés</th><th className="border-b-2 border-[#e5e9f0] px-1.5 py-2 text-right md:px-3">Montant HT</th><th className="border-b-2 border-[#e5e9f0] px-1.5 py-2 text-right md:px-3">Justifier</th></tr></thead><tbody>{visibleItems.map((item, rowIndex) => { const index = (page - 1) * pageSize + rowIndex; const reports = item.justificationDetails?.reports || []; const reportCount = new Set([...reports.map((report) => report.id), ...(item.sources || []).map((source) => source.reportId).filter(Boolean)]).size; const amount = itemAmount(item); const progress = budgetReportCoverage(reportCount, totalReports); const aiEstimate = item.aiEstimateDetails; const estimateDisplay = budgetItemEstimateDisplay(item); const category = item.categoryLabel || item.categoryKey || 'Non classé'; return <tr key={item.id} className="border-t border-[#f0f2f5] align-middle hover:bg-[#f8fafc]"><td className="px-1.5 py-2.5 text-[10px] text-[#8a97b0] md:px-3 md:text-xs">{index + 1}</td><td className="min-w-0 px-1.5 py-2.5 md:px-3"><p title={item.title || 'Poste budgétaire'} className="truncate text-[11px] font-extrabold text-[#1e3a5f] md:text-xs">{item.title || 'Poste budgétaire'}</p><p className="mt-0.5 truncate text-[10px] text-[#8a97b0] md:hidden">{item.clientLabel || (item.clientKey === 'unassigned' ? 'Client non renseigné' : item.clientKey) || 'Client non renseigné'}</p><div className="mt-1.5 h-[4px] overflow-hidden rounded bg-[#e5e9f0]"><span className="block h-full rounded bg-[#e87722]" style={{ width: `${progress}%` }} /></div><p className="sr-only">{budgetStatusLabel(item.status)}{estimateDisplay.showEstimateRange && aiEstimate ? ` · estimation IA comprise entre ${money(aiEstimate.rangeLowHt)} et ${money(aiEstimate.rangeHighHt)}` : ''}</p></td><td className="hidden px-3 py-2.5 md:table-cell"><span className={`inline-block max-w-full truncate whitespace-nowrap rounded-full px-2 py-[3px] text-[10px] font-extrabold ${categoryBadge(category)}`}>{category}</span></td><td className="hidden px-3 py-2.5 text-[11px] text-[#8a97b0] md:table-cell"><span className="block truncate" title={item.clientLabel || item.clientKey || 'Client non renseigné'}>{item.clientLabel || (item.clientKey === 'unassigned' ? 'Client non renseigné' : item.clientKey) || 'Client non renseigné'}</span></td><td className="hidden px-3 py-2.5 text-[11px] text-[#8a97b0] lg:table-cell"><span title={reports.map((report) => budgetReportLabel(report.id, reports)).join(' • ')}><span className="block truncate">{reports.slice(0, 2).map((report) => budgetReportLabel(report.id, reports)).join(', ')}{reportCount > 2 ? ` +${reportCount - 2}` : ''}</span><strong className="text-[#1e3a5f]">{reportCount}/{totalReports} rapport(s)</strong></span></td><td className="px-1.5 py-2.5 text-right text-[10px] font-extrabold tabular-nums text-[#1e3a5f] md:px-3 md:text-xs">{amount == null ? <span className="whitespace-normal text-[#8a97b0]">À chiffrer</span> : money(amount)}{estimateDisplay.amountLabel && <span className="mt-0.5 hidden text-[10px] font-medium text-[#8a97b0] md:block">{estimateDisplay.amountLabel}</span>}</td><td className="px-1.5 py-2.5 text-right md:px-3"><button type="button" aria-label={`Justifier : ${item.title || 'poste budgétaire'}`} onClick={() => onJustify(item)} className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border border-[#1e3a5f] px-1.5 py-1 text-[10px] font-bold text-[#1e3a5f] hover:bg-[#f8fafc] md:px-2 md:text-[11px]"><CircleDollarSign size={12} /><span className="hidden sm:inline">Justifier</span></button></td></tr>; })}</tbody><tfoot><tr className="bg-[#f8fafc]"><th colSpan={2} className="px-2 py-3 text-right text-[9px] font-extrabold text-[#718096] md:hidden">{filtered ? 'TOTAL FILTRÉ HT' : partial ? 'TOTAL DISPONIBLE HT' : 'TOTAL BUDGET HT'}</th><th colSpan={5} className="hidden px-3 py-3 text-right text-[11px] font-extrabold text-[#718096] md:table-cell">{filtered ? 'TOTAL FILTRÉ HT' : partial ? 'TOTAL GLOBAL PROVISOIRE HT' : 'TOTAL BUDGET HT'}</th><th className="px-1 py-3 text-right text-[10px] font-extrabold tabular-nums text-[#1e3a5f] md:px-3 md:text-xs">{total == null ? '—' : money(total)}</th><th /></tr>{filtered && <tr className="border-t border-[#e5e9f0] bg-white"><th colSpan={2} className="px-2 py-3 text-right text-[9px] font-extrabold text-[#718096] md:hidden">{globalTotal?.provisional ? 'TOTAL GLOBAL PROVISOIRE HT' : 'TOTAL GLOBAL HT'}</th><th colSpan={5} className="hidden px-3 py-3 text-right text-[11px] font-extrabold text-[#718096] md:table-cell">{globalTotal?.provisional ? 'TOTAL GLOBAL PROVISOIRE HT' : 'TOTAL GLOBAL HT'}</th><th className="px-1 py-3 text-right text-[10px] font-extrabold tabular-nums text-[#1e3a5f] md:px-3 md:text-xs">{globalTotal ? globalTotal.amount == null ? '—' : money(globalTotal.amount) : 'Chargement…'}</th><th /></tr>}</tfoot></table>{(partial || filtered) && <p className="border-t border-[#e5e9f0] px-3 py-2 text-[11px] text-[#718096]">{filtered ? 'Somme des montants disponibles pour les filtres actifs.' : 'Somme des montants disponibles, hors postes à chiffrer. Ce total provisoire ne remplace pas le budget global publié.'}</p>}<div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5e9f0] px-3 py-2.5 text-[11px] text-[#718096]"><span>Postes {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, items.length)} sur {items.length}</span>{pageCount > 1 && <nav aria-label="Pagination des postes budgétaires" className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded border border-[#d0d9e8] px-2.5 py-1 text-[#1e3a5f] disabled:opacity-40">Précédent</button><span>Page {page} / {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="rounded border border-[#d0d9e8] px-2.5 py-1 text-[#1e3a5f] disabled:opacity-40">Suivant</button></nav>}</div></section>;
}

function BudgetJustificationModal({ item, base, saving, onSave, onRecalculate, onClose }: { item: BudgetItem; base: string; saving: string | null; onSave: (item: BudgetItem, form: HTMLFormElement) => Promise<void>; onRecalculate: (item: BudgetItem, prompt: string) => Promise<void>; onClose: () => void }) {
  const [adminPrompt, setAdminPrompt] = useState('');
  const details = item.justificationDetails;
  const references = details?.baseReglementaire || details?.regulatoryReferences || [];
  const reports = details?.reports || [];
  const amount = itemAmount(item);
  const aiEstimate = details?.aiEstimate || item.aiEstimateDetails;
  const sourceReportEstimates = item.sourceReportEstimates || aiEstimate?.sourceReportEstimates || [];
  const governingReportEstimates = item.amountFromSelectedReports
    ? budgetGoverningReportEstimates(amount, sourceReportEstimates) : [];
  return <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="budget-justification-title" className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="max-h-[90vh] overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-prosps-blue">Justification budgétaire</p><h2 id="budget-justification-title" className="mt-1 text-xl font-semibold text-slate-900">{item.title || 'Poste budgétaire'}</h2><p className="mt-2 text-2xl font-bold text-slate-900">{amount == null ? 'À chiffrer' : `${money(amount)} HT`}</p><p className="mt-1 text-xs text-slate-500">Statut : {budgetStatusLabel(item.status)}{item.lockedManual ? ' · valeur humaine protégée des recalculs IA' : ''}</p></div><button type="button" aria-label="Fermer la justification" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-500 hover:bg-slate-50">✕</button></div>
      <div className="mt-5 space-y-4">
        <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-semibold text-slate-800">Contexte, observations et base réglementaire</summary><div className="mt-3"><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{details?.context || justificationPart(item.justification, 'Contexte') || 'Contexte issu des rapports et constats liés à ce poste.'}</p>{details?.observations?.length ? <ul className="mt-3 space-y-2">{details.observations.map((observation, index) => <li key={observation.id || index} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><p>{observation.content || '—'}</p>{observation.danger && <p className="mt-1"><span className="font-medium">Danger : </span>{observation.danger}</p>}{observation.risk && <p className="mt-1"><span className="font-medium">Risque : </span>{observation.risk}</p>}</li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Aucune observation analytique détaillée.</p>}{details?.recommendations?.length ? <div className="mt-4"><h4 className="text-sm font-semibold text-slate-800">Recommandations à l’origine du poste</h4><ul className="mt-1 list-inside list-disc text-sm text-slate-600">{details.recommendations.map((recommendation, index) => <li key={index}>{recommendation}</li>)}</ul></div> : null}<section className="mt-4"><h4 className="text-sm font-semibold text-slate-800">Base réglementaire</h4>{references.length ? <ul className="mt-1 list-inside list-disc text-sm text-slate-600">{references.map((reference, index) => <li key={`${reference}-${index}`}>{reference}</li>)}</ul> : <p className="mt-1 text-sm text-slate-500">Aucune référence réglementaire associée.</p>}</section></div></details>
        {aiEstimate ? <details open className="rounded-xl border border-blue-200 bg-blue-50 p-4"><summary className="cursor-pointer text-slate-900"><span className="font-semibold">{item.lockedManual ? 'Proposition IA initiale (référence)' : 'Estimation IA indicative'}</span><span className="mt-1 block text-sm font-normal text-slate-700">Fourchette : {aiEstimate?.rangeLowHt ? money(aiEstimate.rangeLowHt) : '—'} à {aiEstimate?.rangeHighHt ? money(aiEstimate.rangeHighHt) : '—'} HT · confiance indicative {aiEstimate?.confidence ?? '—'}%</span></summary><p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{budgetPublicExplanation(aiEstimate?.rationale) || 'Le modèle n’a pas fourni de justification détaillée.'}</p>{aiEstimate?.assumptions?.length ? <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Hypothèses non vérifiées</p><ul className="mt-1 list-inside list-disc text-sm text-slate-700">{aiEstimate.assumptions.map((assumption, index) => <li key={index}>{budgetPublicExplanation(assumption)}</li>)}</ul></div> : null}{aiEstimate?.inputsToConfirm?.length ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-amber-900">À confirmer avant engagement</p><ul className="mt-1 list-inside list-disc text-sm text-amber-900">{aiEstimate.inputsToConfirm.map((input, index) => <li key={index}>{input}</li>)}</ul></div> : null}{aiEstimate?.components?.length ? <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Composants de coût</p><ul className="mt-1 space-y-1 text-sm text-slate-700">{aiEstimate.components.map((component, index) => <li key={`${component.label}-${index}`} className="flex justify-between gap-3"><span>{component.label} <span className="text-xs text-slate-500">— {component.explanation}</span></span><strong className="whitespace-nowrap">{money(component.amountHt)}</strong></li>)}</ul></div> : null}{aiEstimate?.catalogBenchmark ? <p className="mt-3 rounded-lg bg-white/70 p-2 text-xs text-slate-600">Repère catalogue fourni au modèle : {aiEstimate.catalogBenchmark.label || 'Référence'} · {money(aiEstimate.catalogBenchmark.unitCostHt)} / {aiEstimate.catalogBenchmark.unit || 'unité'} · {aiEstimate.catalogBenchmark.priceSource || 'source catalogue non renseignée'}. Le montant retenu reste l’estimation du LLM.</p> : null}<p className="mt-3 text-xs text-slate-500">Estimation générée par IA le {aiEstimate?.generatedAt ? new Date(aiEstimate.generatedAt).toLocaleString('fr-FR') : '—'}. Ce montant est indicatif, ce n’est ni un devis ni un tarif fournisseur.</p></details> : null}<details className="rounded-xl border border-slate-200 bg-slate-50 p-4"><summary className="cursor-pointer font-semibold text-slate-800">Estimations par rapport source ({sourceReportEstimates.length})</summary>{sourceReportEstimates.length ? <div className="mt-3 space-y-2">{sourceReportEstimates.map((estimate, index) => <div key={`${estimate.reportId || "report"}-${index}`} className="rounded-lg bg-white p-2 text-sm text-slate-700"><div className="flex flex-wrap justify-between gap-2"><span>{budgetReportLabel(estimate.reportId, reports, estimate.reportTitle)}</span><strong>{estimate.totalHt ? money(estimate.totalHt) : "—"}</strong></div>{estimate.rationale && <p className="mt-1 text-xs text-slate-500">{budgetPublicExplanation(estimate.rationale)}</p>}</div>)}</div> : <p className="mt-3 text-sm text-slate-500">Aucune estimation détaillée par rapport source.</p>}</details>
        {!aiEstimate && item.amountFromSelectedReports ? <section className="rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold text-slate-900">Estimation retenue parmi les rapports visibles</h3><p className="mt-2 text-sm text-slate-700">Le montant retenu correspond à la plus élevée des estimations des rapports visibles. Il ne représente pas leur somme.</p>{governingReportEstimates.length ? governingReportEstimates.map((estimate, index) => <div key={`${estimate.reportId || 'report'}-${index}`} className="mt-3 rounded-lg bg-white/70 p-3 text-sm text-slate-700"><p className="font-semibold">{budgetReportLabel(estimate.reportId, reports, estimate.reportTitle)} · {money(estimate.totalHt)}</p><p className="mt-2 whitespace-pre-wrap">{estimate.rationale?.trim() ? budgetPublicExplanation(estimate.rationale) : 'Justification de ce rapport non disponible.'}</p></div>) : <p className="mt-3 text-sm text-amber-800">Le rapport déterminant ne peut pas être identifié dans les estimations visibles. Vérifiez les rapports source.</p>}</section> : null}
        <section className="rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold text-slate-900">Consigne IA pour ce recalcul</h3><p className="mt-1 text-xs text-slate-600">Renseignez une consigne pour activer le recalcul. Elle sera transmise à l’IA pour ce poste uniquement ; les autres lignes et les montants humains verrouillés restent inchangés.</p><textarea value={adminPrompt} onChange={(event) => setAdminPrompt(event.target.value.slice(0, 2000))} maxLength={2000} rows={3} placeholder="Précisez les hypothèses ou le contexte à prendre en compte…" className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" /><div className="mt-2 flex items-center justify-between"><span className="text-[11px] text-slate-400">{adminPrompt.length}/2000</span><button type="button" disabled={!canRecalculateBudgetItem(adminPrompt, Boolean(item.lockedManual), saving !== null)} onClick={() => void onRecalculate(item, adminPrompt)} className="inline-flex items-center gap-2 rounded-lg bg-prosps-blue px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw size={14} className={saving === `recalculate:${item.id}` ? 'animate-spin' : ''} />{saving === `recalculate:${item.id}` ? 'Recalcul en cours…' : 'Recalculer ce poste'}</button></div>{Boolean(item.lockedManual) && <p className="mt-2 text-xs text-amber-700">Ce poste est verrouillé par une décision humaine et ne peut pas être recalculé par l’IA.</p>}</section>
        <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-semibold text-slate-800">Montant retenu et validation</summary><p className="mt-2 text-xs text-slate-500">Ajustez directement le montant HT proposé par l’IA. Une valeur validée et verrouillée ne sera pas remplacée par un prochain recalcul.</p>
        <form onSubmit={(event) => { event.preventDefault(); void onSave(item, event.currentTarget); }}>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Montant HT retenu<input name="amountHt" required type="number" min="0" step="0.01" defaultValue={amount == null ? '' : String(amount)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base font-bold tabular-nums text-slate-900" /></label><label className="text-xs text-slate-600">Référence de l’estimation / du prix<input name="priceSource" required defaultValue={item.priceSource || 'Estimation IA indicative — à confirmer'} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label><label className="text-xs text-slate-600">Statut<select name="status" defaultValue={item.status || 'A_CHIFFRER'} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="A_CHIFFRER">À chiffrer</option><option value="ESTIME">Estimé</option><option value="VALIDE">Validé</option><option value="ENGAGE">Engagé</option><option value="REALISE">Réalisé</option></select></label><label className="flex items-center gap-2 pt-5 text-xs text-slate-600"><input name="lockedManual" type="checkbox" defaultChecked={Boolean(item.lockedManual)} /> Verrouiller cette décision humaine</label></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-600">Contexte administrateur<textarea name="Contexte" defaultValue={justificationPart(item.justification, 'Contexte') || details?.context || ''} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label><label className="text-xs text-slate-600">Note sur la décision<textarea name="Observations" defaultValue={justificationPart(item.justification, 'Observations')} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label><label className="text-xs text-slate-600">Complément réglementaire<textarea name="Base réglementaire" defaultValue={justificationPart(item.justification, 'Base réglementaire')} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label><label className="text-xs text-slate-600">Quantités, durée et moyens vérifiés<textarea name="Données vérifiées" defaultValue={justificationPart(item.justification, 'Données vérifiées')} rows={2} placeholder="Renseigner les mesures réelles et les prestations déjà comprises ; laisser vide si inconnues." className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label><label className="text-xs text-slate-600">Commentaire sur le coût<textarea name="Décomposition du coût" defaultValue={justificationPart(item.justification, 'Décomposition du coût')} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label></div>
          <div className="mt-3 flex justify-end"><button type="submit" disabled={saving !== null} className="rounded-lg bg-prosps-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving === item.id ? 'Enregistrement…' : 'Enregistrer le montant et le statut'}</button></div>
        </form></details>
        <section><h3 className="font-semibold text-slate-800">Rapports concernés ({reports.length || new Set((item.sources || []).map((source) => source.reportId).filter(Boolean)).size})</h3><div className="mt-2 space-y-1 text-sm">{reports.length ? reports.map((report) => <p key={report.id}>• <Link className="text-prosps-blue hover:underline" to={`${base}/reports?reportId=${encodeURIComponent(report.id)}`} target="_blank" rel="noopener noreferrer">{budgetReportLabel(report.id, reports)}</Link></p>) : item.sources?.filter((source) => source.reportId).map((source, index) => <p key={source.id || `${source.reportId}-${index}`}>• <Link className="text-prosps-blue hover:underline" to={`${base}/reports?reportId=${encodeURIComponent(source.reportId!)}`} target="_blank" rel="noopener noreferrer">Ouvrir le rapport source</Link></p>) || <p className="text-slate-500">Aucun rapport source renseigné.</p>}</div></section>
      </div>
      </div>
    </section>
  </div>;
}
