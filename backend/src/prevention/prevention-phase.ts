export const PREVENTION_CONSTRUCTION_PHASES = [
  'GROS_OEUVRE',
  'STRUCTURE_CLOS_COUVERT',
  'SECOND_OEUVRE',
  'INSTALLATIONS_FINITIONS',
  'INSTALLATION_ELECTRIQUE',
  'FINITIONS_INTERIEURES',
  'FINITIONS_EXTERIEURES',
] as const;

export type PreventionConstructionPhase = typeof PREVENTION_CONSTRUCTION_PHASES[number];
export type PreventionEffectivePhase = PreventionConstructionPhase | `CUSTOM_${string}`;
export const PREVENTION_CUSTOM_PHASE_CODE_PATTERN = /^CUSTOM_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PREVENTION_PHASE_LABELS: Record<PreventionConstructionPhase, string> = {
  GROS_OEUVRE: 'Gros œuvre',
  STRUCTURE_CLOS_COUVERT: 'Structure & Clos couvert',
  SECOND_OEUVRE: 'Second œuvre',
  INSTALLATIONS_FINITIONS: 'Installations & Finitions',
  INSTALLATION_ELECTRIQUE: 'Installation électrique',
  FINITIONS_INTERIEURES: 'Finitions intérieures',
  FINITIONS_EXTERIEURES: 'Finitions extérieures',
};

export type PreventionPhaseStatus = 'PROPOSED' | 'VALIDATED';
export type PreventionPhaseSource = 'PHOTO' | 'DIRECTIVE' | 'MIXED';

export function isPreventionConstructionPhase(
  value: unknown,
): value is PreventionConstructionPhase {
  return typeof value === 'string' &&
    (PREVENTION_CONSTRUCTION_PHASES as readonly string[]).includes(value);
}

export function isPreventionEffectivePhase(value: unknown): value is PreventionEffectivePhase {
  return isPreventionConstructionPhase(value) ||
    (typeof value === 'string' && PREVENTION_CUSTOM_PHASE_CODE_PATTERN.test(value));
}

export function normalizePreventionPhaseLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR');
}
