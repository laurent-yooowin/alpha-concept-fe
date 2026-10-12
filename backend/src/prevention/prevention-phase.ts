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
