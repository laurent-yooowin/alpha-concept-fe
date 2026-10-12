import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { isPreventionConstructionPhase, PreventionConstructionPhase } from '../prevention-phase';
import { PreventionPhotoDownloadService } from '../worker/prevention-photo-download.service';
import { preventionFailureDiagnostic } from '../worker/prevention-log-error';
import { normalizePreventionActionMetric, PREVENTION_ACTION_TYPES, PREVENTION_ACTION_TYPE_VERSION, PreventionActionMetric, PreventionActionType, safePreventionActionType, UNCLASSIFIED_ACTION_TYPE } from '../prevention-action-types';

export interface PreventionOnlyInput {
  sourceKind: 'PHOTO' | 'DIRECTIVE' | 'MIXED';
  entries: Array<{ isDirectiveOnly?: boolean; userDirectives?: string; observationTexts?: string[];
    recommendationTexts?: string[]; referenceTexts?: string[] }>;
  directives?: string;
}

export interface PreventionOnlyResult {
  phase: PreventionConstructionPhase;
  confidence: number;
  justification: string;
  observations: Array<{ index: number; riskLevel: 'faible' | 'moyen' | 'eleve'; confidence?: number }>;
  recommendations: Array<{ index: number; riskLevel: 'faible' | 'moyen' | 'eleve'; confidence?: number;
    actionType?: PreventionActionType; actionTypeConfidence?: number; actionTypeVersion?: string; actionMetric?: PreventionActionMetric | null }>;
}

class PreventionRiskVectorError extends BadRequestException {
  constructor(
    name: string,
    readonly vectorReason: 'NOT_ARRAY' | 'COUNT_MISMATCH' | 'INDEX_MISMATCH' | 'RISK_LEVEL_INVALID',
    readonly vectorExpectedCount: number,
    readonly vectorActualCount?: number,
  ) {
    super(`Prevention LLM returned an invalid ${name} risk vector`);
  }
}

export class PreventionGroupLlmTimeoutError extends Error {
  constructor() {
    super('PREVENTION_LLM_TIMEOUT_EXHAUSTED');
    this.name = 'PreventionGroupLlmTimeoutError';
  }
}

/** One HTTP request, with a 120-second initial window and one 240-second extension. */
export async function fetchPreventionGroupJson(url: string, init: RequestInit, initialTimeoutMs = 120_000, organizationId?: string): Promise<any> {
  const controller = new AbortController();
  let extensionTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline!: (error: Error) => void;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const initialTimer = setTimeout(() => {
    extensionTimer = setTimeout(() => {
      rejectDeadline(new PreventionGroupLlmTimeoutError());
      controller.abort();
    }, initialTimeoutMs * 2);
  }, initialTimeoutMs);
  try {
    return await Promise.race([
      (async () => {
        const requestInit = { ...init, signal: controller.signal };
        // Local-only metadata for a scoped test hook. Fetch ignores symbol
        // properties, so the organization identifier is never sent upstream.
        if (organizationId) Object.defineProperty(requestInit, Symbol.for('prevention.group.organizationId'), { value: organizationId });
        const response = await fetch(url, requestInit);
        if (!response.ok) throw new Error(`Prevention LLM request failed (${response.status})`);
        return response.json();
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(initialTimer);
    if (extensionTimer) clearTimeout(extensionTimer);
  }
}

@Injectable()
export class PreventionOnlyAiService {
  private readonly logger = new Logger(PreventionOnlyAiService.name);
  private readonly apiKey: string | undefined;
  private readonly url: string;

  constructor(private readonly config: ConfigService, private readonly downloads: PreventionPhotoDownloadService) {
    this.apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.url = this.config.get<string>('OPENAI_API_URL', 'https://api.openai.com/v1/chat/completions');
  }

  /** Assess only edited recommendations; the group's phase and SPS report remain untouched. */
  async assessEditedRecommendations(texts: string[]): Promise<Array<{ index: number; riskLevel: 'faible' | 'moyen' | 'eleve';
    confidence: number; actionType: PreventionActionType; actionTypeConfidence: number; actionTypeVersion: string }>> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not configured for Prevention recommendation assessment');
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 40 || texts.some((value) =>
      typeof value !== 'string' || !value.trim() || value.length > 4000)) throw new BadRequestException('Invalid edited recommendation input');
    const vocabulary = PREVENTION_ACTION_TYPES.map((item) => `${item.id}: ${item.title}`).join('; ');
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Math.min(120_000, Number(this.config.get('PREVENTION_LLM_TIMEOUT_MS', 60_000)) || 60_000));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: 'gpt-5.1', messages: [
          { role: 'system', content: `Tu analyses uniquement les recommandations SPS modifiées. Ne génère aucun rapport SPS et ne réévalue pas la phase du groupe. Retourne strictement un JSON {"recommendations":[{"index":0,"riskLevel":"moyen","confidence":80,"actionType":"...","actionTypeConfidence":80}]}. Un élément pour chaque texte dans le même ordre. riskLevel vaut faible, moyen ou eleve ; chaque confiance vaut 0 à 100. actionType est l'action corrective réellement demandée, choisie parmi ${vocabulary}; utilise specific-action si aucune famille ne convient et jamais A_CLASSER pour une nouvelle analyse. Pour les déchets: waste-management = tri/propreté seule; waste-disposal = collecte/évacuation seule; waste-complete = tri et évacuation explicitement demandés ensemble. dust-control concerne les poussières, site-water les ouvrages de gestion des eaux. L'évacuation des déchets n'est pas une évacuation incendie.` },
          { role: 'user', content: texts.map((value, index) => `${index}. ${value}`).join('\n') },
        ], max_completion_tokens: Math.min(3500, 400 + texts.length * 90) }), signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`Prevention edited recommendation assessment failed (${response.status})`);
    const data: any = await response.json();
    let parsed: any;
    try { parsed = JSON.parse(data?.choices?.[0]?.message?.content); }
    catch { throw new Error('Prevention edited recommendation assessment returned invalid JSON'); }
    if (!Array.isArray(parsed?.recommendations) || parsed.recommendations.length !== texts.length) {
      throw new BadRequestException('Prevention edited recommendation assessment returned an invalid vector');
    }
    return parsed.recommendations.map((item: any, index: number) => {
      if (item?.index !== index || !['faible', 'moyen', 'eleve'].includes(item.riskLevel) ||
        typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 100) {
        throw new BadRequestException('Prevention edited recommendation assessment returned an invalid risk');
      }
      const actionType = safePreventionActionType(item.actionType, texts[index]);
      const actionTypeConfidence = typeof item.actionTypeConfidence === 'number' && Number.isFinite(item.actionTypeConfidence) &&
        item.actionTypeConfidence >= 0 && item.actionTypeConfidence <= 100 ? item.actionTypeConfidence : 0;
      return { index, riskLevel: item.riskLevel, confidence: item.confidence, actionType: actionType === UNCLASSIFIED_ACTION_TYPE ? 'specific-action' : actionType,
        actionTypeConfidence, actionTypeVersion: PREVENTION_ACTION_TYPE_VERSION };
    });
  }

  /** Classify stored SPS recommendations without re-running phase, risk or SPS analysis. */
  async classifyRecommendationActions(texts: string[]): Promise<Array<{ index: number; actionType: PreventionActionType;
    actionTypeConfidence: number; actionTypeVersion: string }>> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not configured for Prevention action classification');
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 40 || texts.some((value) =>
      typeof value !== 'string' || !value.trim() || value.length > 4000)) throw new BadRequestException('Invalid recommendation classification input');
    const vocabulary = PREVENTION_ACTION_TYPES.map((item) => `${item.id}: ${item.title}`).join('; ');
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Math.min(120_000, Number(this.config.get('PREVENTION_LLM_TIMEOUT_MS', 60_000)) || 60_000));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: 'gpt-5.1', messages: [
          { role: 'system', content: `Classe uniquement l'action corrective explicitement demandée par chaque recommandation SPS. Ne réanalyse ni le risque ni la phase, ne modifie pas le texte. Retourne strictement un JSON {"recommendations":[{"index":0,"actionType":"...","actionTypeConfidence":0}]}. Un type par recommandation, dans le même ordre. Types autorisés: ${vocabulary}; utilise specific-action si aucune famille ne convient et jamais A_CLASSER pour une nouvelle classification. Pour les déchets: waste-management = tri/propreté seule; waste-disposal = collecte/évacuation seule; waste-complete = tri et évacuation explicitement demandés ensemble. dust-control concerne les poussières, site-water les ouvrages de gestion des eaux. L'évacuation des déchets n'est pas une évacuation incendie.` },
          { role: 'user', content: texts.map((value, index) => `${index}. ${value}`).join('\n') },
        ], max_completion_tokens: Math.min(2400, 300 + texts.length * 50) }), signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`Prevention action classification failed (${response.status})`);
    const data: any = await response.json();
    let parsed: any;
    try { parsed = JSON.parse(data?.choices?.[0]?.message?.content); }
    catch { throw new Error('Prevention action classification returned invalid JSON'); }
    if (!Array.isArray(parsed?.recommendations) || parsed.recommendations.length !== texts.length) {
      throw new BadRequestException('Prevention action classification returned an invalid vector');
    }
    return parsed.recommendations.map((item: any, index: number) => {
      if (item?.index !== index) throw new BadRequestException('Prevention action classification returned an invalid index');
      const actionType = safePreventionActionType(item.actionType, texts[index]);
      const actionTypeConfidence = typeof item.actionTypeConfidence === 'number' && Number.isFinite(item.actionTypeConfidence) &&
        item.actionTypeConfidence >= 0 && item.actionTypeConfidence <= 100 ? item.actionTypeConfidence : 0;
      return { index, actionType: actionType === UNCLASSIFIED_ACTION_TYPE ? 'specific-action' : actionType, actionTypeConfidence, actionTypeVersion: PREVENTION_ACTION_TYPE_VERSION };
    });
  }

  async analyze(input: PreventionOnlyInput, organizationId: string, visitId: string, sourceGroupId: string): Promise<PreventionOnlyResult> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not configured for Prevention retry');
    const directives = [input.directives, ...input.entries.map((entry) => entry.userDirectives)]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .join('\n')
      .slice(0, 12000);
    const actionVocabulary = PREVENTION_ACTION_TYPES.map((item) => `${item.id}: ${item.title}`).join('; ');
    const system = `Tu es le moteur Prévention du module CSPS. Tu ne produis jamais de rapport SPS et tu ne modifies aucune observation existante. Analyse uniquement le groupe fourni et retourne un JSON strict avec preventionPhase, preventionPhaseConfidence, preventionPhaseJustification, observations et recommendations. La phase doit être l'une de GROS_OEUVRE, STRUCTURE_CLOS_COUVERT, SECOND_OEUVRE, INSTALLATIONS_FINITIONS, INSTALLATION_ELECTRIQUE, FINITIONS_INTERIEURES, FINITIONS_EXTERIEURES. Même avec une faible confiance, choisis la phase la plus probable; jamais INDETERMINEE. observations contient {index, riskLevel, confidence}; recommendations contient {index, riskLevel, confidence, actionType, actionTypeConfidence, actionMetric?}, indexés dans l'ordre des éléments SPS correspondants. riskLevel vaut faible, moyen ou eleve. Évalue chaque élément sans reprendre le riskLevel SPS du groupe. Pour chaque recommandation, actionType désigne uniquement l'action corrective réellement demandée, jamais la catégorie du risque ni un achat imaginé; actionTypeConfidence vaut 0 à 100. Choisis exactement un identifiant parmi: ${actionVocabulary}; utilise specific-action si aucune famille ne convient (jamais A_CLASSER pour une nouvelle analyse). actionMetric est facultatif et doit être omis si la quantité ne peut pas être estimée raisonnablement; sinon {quantity:string positive <=1000000,unit:UNITE|PERSONNE|M|M2|JOUR,basis:string <=500,confidence:0..100}. La métrique est indicative, jamais une mesure certaine. Pour les déchets: waste-management = tri/propreté seule; waste-disposal = collecte/évacuation seule; waste-complete = tri et évacuation explicitement demandés ensemble. dust-control concerne les poussières, site-water les ouvrages de gestion des eaux. Une évacuation de déchets n'est pas une évacuation incendie.`;
    const observationTexts = input.entries.flatMap((entry) => entry.observationTexts ?? []).slice(0, 100);
    const recommendationTexts = input.entries.flatMap((entry) => entry.recommendationTexts ?? []).slice(0, 100);
    const referenceTexts = input.entries.flatMap((entry) => entry.referenceTexts ?? []).slice(0, 100);
    const hasTextInput = Boolean(directives || observationTexts.length || recommendationTexts.length);
    const userContent = `Évalue les risques Prévention de ce groupe. Retourne exactement ${observationTexts.length} entrée(s) dans observations et ${recommendationTexts.length} entrée(s) dans recommendations, chacune dans l'ordre des textes avec les index entiers de 0 à N-1 (tableau vide si N=0). Ne fusionne et n'omets aucun élément. Directives: ${directives || 'Aucune directive.'}\nObservations SPS existantes, à évaluer sans les modifier :\n${observationTexts.map((text, index) => `${index}. ${text}`).join('\n') || 'Aucune observation.'}\nRecommandations SPS :\n${recommendationTexts.map((text, index) => `${index}. ${text}`).join('\n') || 'Aucune.'}\nRéférences SPS :\n${referenceTexts.join('\n') || 'Aucune.'}`;
    let downloaded: Awaited<ReturnType<PreventionPhotoDownloadService['downloadGroup']>> = [];
    if (input.sourceKind !== 'DIRECTIVE') {
      try {
        downloaded = await this.downloads.downloadGroup(organizationId, visitId, sourceGroupId);
      } catch (error) {
        if (!hasTextInput) {
          this.logger.warn({
            message: 'PREVENTION_GROUP_PHOTO_DOWNLOAD_FAILED',
            event: 'PREVENTION_GROUP_PHOTO_DOWNLOAD_FAILED',
            organizationId,
            visitId,
            sourceGroupFingerprint: createHash('sha256').update(sourceGroupId).digest('hex').slice(0, 16),
            ...preventionFailureDiagnostic(error),
          } as any);
          throw new Error('PREVENTION_PHOTO_DOWNLOAD_FAILED');
        }
        // Photos enrich the Prevention assessment but are not mandatory. The SPS
        // analysis text remains the authoritative fallback when an object is no
        // longer readable or cannot be downloaded temporarily.
        downloaded = [];
      }
    }
    const images: Array<{ type: 'image_url'; image_url: { url: string } }> = downloaded.map((file) => ({
      type: 'image_url', image_url: { url: `data:${file.contentType};base64,${file.base64}` },
    }));
    if (!hasTextInput && !images.length) throw new Error('PREVENTION_GROUP_INPUT_EMPTY');
    const timeoutMs = 120_000;
    const data: any = await fetchPreventionGroupJson(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: 'gpt-5.1', messages: [{ role: 'system', content: system },
          { role: 'user', content: images.length ? [{ type: 'text', text: userContent }, ...images] : userContent }],
          max_completion_tokens: Math.min(12000, 2000 + (observationTexts.length + recommendationTexts.length) * 90) }),
      }, timeoutMs, organizationId);
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') throw new Error('Prevention LLM returned no content');
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Prevention LLM returned invalid JSON'); }
    const phase = parsed?.preventionPhase;
    const confidence = parsed?.preventionPhaseConfidence;
    const justification = typeof parsed?.preventionPhaseJustification === 'string' ? parsed.preventionPhaseJustification.trim().slice(0, 1000) : '';
    if (!isPreventionConstructionPhase(phase) || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100 || !justification) {
      throw new BadRequestException('Prevention LLM returned invalid phase metadata');
    }
    const parseRiskVector = (items: unknown, expectedCount: number, name: string): PreventionOnlyResult['observations'] => {
      if (!Array.isArray(items)) throw new PreventionRiskVectorError(name, 'NOT_ARRAY', expectedCount);
      if (items.length !== expectedCount || items.length > 100) {
        throw new PreventionRiskVectorError(name, 'COUNT_MISMATCH', expectedCount, items.length);
      }
      return items.map((item: any, expectedIndex: number) => {
        const index = item?.index;
        const riskLevel = item?.riskLevel;
        if (!Number.isInteger(index) || index !== expectedIndex) {
          throw new PreventionRiskVectorError(name, 'INDEX_MISMATCH', expectedCount, items.length);
        }
        if (!['faible', 'moyen', 'eleve'].includes(riskLevel)) {
          throw new PreventionRiskVectorError(name, 'RISK_LEVEL_INVALID', expectedCount, items.length);
        }
        const value = item?.confidence;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
          throw new BadRequestException(`Prevention LLM returned an invalid ${name} confidence`);
        }
        return { index, riskLevel, confidence: value } as { index: number; riskLevel: 'faible' | 'moyen' | 'eleve'; confidence: number };
      });
    };
    const observations = parseRiskVector(parsed?.observations, observationTexts.length, 'observation');
    const recommendations = parseRiskVector(parsed?.recommendations, recommendationTexts.length, 'recommendation')
      .map((risk, index) => {
        const item = parsed.recommendations[index];
        const actionType = safePreventionActionType(item?.actionType, recommendationTexts[index]);
        const rawConfidence = item?.actionTypeConfidence;
        const actionTypeConfidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence) && rawConfidence >= 0 && rawConfidence <= 100
          ? rawConfidence : 0;
        return { ...risk, actionType: actionType === UNCLASSIFIED_ACTION_TYPE ? 'specific-action' : actionType, actionTypeConfidence, actionTypeVersion: PREVENTION_ACTION_TYPE_VERSION,
          actionMetric: normalizePreventionActionMetric(item?.actionMetric) };
      });
    return { phase, confidence, justification, observations, recommendations };
  }
}
