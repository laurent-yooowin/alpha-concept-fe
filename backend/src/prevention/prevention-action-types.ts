/** Budget action vocabulary shared by the Prevention classifier and materializer. */
export const PREVENTION_ACTION_TYPES = [
  { id: 'specific-action', title: 'Mesure de prévention spécifique', categoryKey: 'Mesure spécifique' },
  { id: 'height-training', title: 'Formation sécurité travaux en hauteur', categoryKey: 'Hauteur' },
  { id: 'height-protection', title: 'Protections collectives contre les chutes', categoryKey: 'Hauteur' },
  { id: 'height-access', title: 'Moyens d’accès sécurisés en hauteur', categoryKey: 'Hauteur' },
  { id: 'ppe-supply', title: 'EPI complémentaires — dotation et stock', categoryKey: 'EPI' },
  { id: 'ppe-enforcement', title: 'Contrôle et rappel du port des EPI', categoryKey: 'EPI' },
  { id: 'equipment-compliance', title: 'Audit et mise en conformité de l’outillage', categoryKey: 'EPI' },
  { id: 'lighting', title: 'Éclairage des zones de travail et de circulation', categoryKey: 'Éclairage' },
  { id: 'traffic-plan', title: 'Signalisation et plan de circulation chantier', categoryKey: 'Circulation' },
  { id: 'traffic-separation', title: 'Séparation et balisage des circulations', categoryKey: 'Circulation' },
  { id: 'excavation-dewatering', title: 'Pompage et drainage des fouilles', categoryKey: 'Circulation' },
  { id: 'excavation-stability', title: 'Stabilité des talus et déblais de fouille', categoryKey: 'Circulation' },
  { id: 'excavation-protection', title: 'Protection et accès aux fouilles', categoryKey: 'Circulation' },
  { id: 'site-documents', title: 'Contrôle des justificatifs et habilitations', categoryKey: 'Admin' },
  { id: 'electrical-compliance', title: 'Contrôle et mise en conformité des installations électriques', categoryKey: 'Électrique' },
  { id: 'fire-protection', title: 'Moyens de prévention incendie', categoryKey: 'Incendie' },
  { id: 'lifting-controls', title: 'Sécurisation du levage et de la manutention', categoryKey: 'Levage' },
  { id: 'spill-retention', title: 'Rétention des produits et protection des sols', categoryKey: 'Organisation' },
  { id: 'waste-management', title: 'Organisation du tri et de la propreté', categoryKey: 'Organisation' },
  { id: 'waste-disposal', title: 'Collecte et évacuation des déchets', categoryKey: 'Organisation' },
  { id: 'waste-complete', title: 'Tri, collecte et évacuation des déchets', categoryKey: 'Organisation' },
  { id: 'dust-control', title: 'Maîtrise des poussières', categoryKey: 'Organisation' },
  { id: 'site-water', title: 'Gestion des eaux de chantier', categoryKey: 'Organisation' },
  { id: 'site-storage', title: 'Organisation et sécurisation des stockages', categoryKey: 'Organisation' },
  { id: 'sps-coordination', title: 'Renforcement de la coordination SPS', categoryKey: 'Organisation' },
] as const;

export const PREVENTION_ACTION_TYPE_VERSION = 'v2';
export const UNCLASSIFIED_ACTION_TYPE = 'A_CLASSER';
export type PreventionActionType = typeof PREVENTION_ACTION_TYPES[number]['id'] | typeof UNCLASSIFIED_ACTION_TYPE;

export const PREVENTION_ACTION_METRIC_UNITS = ['UNITE', 'PERSONNE', 'M', 'M2', 'JOUR'] as const;
export type PreventionActionMetricUnit = typeof PREVENTION_ACTION_METRIC_UNITS[number];
export interface PreventionActionMetric {
  quantity: string;
  unit: PreventionActionMetricUnit;
  basis: string;
  confidence: number;
}

export function normalizePreventionActionMetric(value: unknown): PreventionActionMetric | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.quantity !== 'string' || !/^\d+(?:\.\d+)?$/.test(item.quantity.trim())) return null;
  const quantity = item.quantity.trim();
  const numeric = Number(quantity);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 1_000_000) return null;
  if (!PREVENTION_ACTION_METRIC_UNITS.includes(item.unit as PreventionActionMetricUnit)) return null;
  if (typeof item.basis !== 'string' || !item.basis.trim() || item.basis.length > 500) return null;
  if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 100) return null;
  return { quantity, unit: item.unit as PreventionActionMetricUnit, basis: item.basis.trim(), confidence: item.confidence };
}

export function isPreventionActionType(value: unknown): value is PreventionActionType {
  return value === UNCLASSIFIED_ACTION_TYPE || PREVENTION_ACTION_TYPES.some((item) => item.id === value);
}

export function preventionActionDefinition(value: unknown): typeof PREVENTION_ACTION_TYPES[number] | null {
  return PREVENTION_ACTION_TYPES.find((item) => item.id === value) ?? null;
}

/** A guardrail against the observed false positive, not a keyword classifier. */
export function safePreventionActionType(value: unknown, recommendation: string): PreventionActionType {
  if (!isPreventionActionType(value)) return UNCLASSIFIED_ACTION_TYPE;
  const text = recommendation.toLocaleLowerCase('fr-FR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ');
  if (value === 'waste-management' || value === 'waste-disposal' || value === 'waste-complete') {
    const sorting = /\b(?:tri|trier|proprete|propre|nettoyage|nettoyer|rangement|ranger|flux|bennes? de tri)\b/.test(text);
    const disposal = /\b(?:evacuation|evacuer|enlevement|enlever|collecte|collecter|traitement des dechets)\b/.test(text);
    if (sorting && disposal) return 'waste-complete';
    if (sorting) return 'waste-management';
    if (disposal) return 'waste-disposal';
    return UNCLASSIFIED_ACTION_TYPE;
  }
  if (value === 'dust-control' || value === 'site-water') {
    const dust = /\b(?:poussieres?|arrosage|arroser)\b/.test(text);
    const water = /\b(?:ruissellement|fosses?|rigoles?|bassins?|decantation|eaux boueuses)\b/.test(text);
    if (dust && water) return UNCLASSIFIED_ACTION_TYPE;
    if (dust) return 'dust-control';
    if (water) return 'site-water';
    return UNCLASSIFIED_ACTION_TYPE;
  }
  if (value !== 'fire-protection') return value;
  const wasteEvidence = /\b(?:dechets?|bennes?|tri des|tri selectif)\b/.test(text);
  const fireEvidence = /\b(?:incendie|extincteurs?|fumee|alarme|feu|secours)\b/.test(text);
  return wasteEvidence && !fireEvidence ? UNCLASSIFIED_ACTION_TYPE : value;
}
