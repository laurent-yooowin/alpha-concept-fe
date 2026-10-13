import { api, apiRequest, ApiResponse } from './api';

export const PREVENTION_PHASES = [
  'GROS_OEUVRE',
  'STRUCTURE_CLOS_COUVERT',
  'SECOND_OEUVRE',
  'INSTALLATIONS_FINITIONS',
  'INSTALLATION_ELECTRIQUE',
  'FINITIONS_INTERIEURES',
  'FINITIONS_EXTERIEURES',
] as const;

export const PREVENTION_PHASE_LABELS: Record<PreventionPhase, string> = {
  GROS_OEUVRE: 'Gros œuvre',
  STRUCTURE_CLOS_COUVERT: 'Structure & Clos couvert',
  SECOND_OEUVRE: 'Second œuvre',
  INSTALLATIONS_FINITIONS: 'Installations & Finitions',
  INSTALLATION_ELECTRIQUE: 'Installation électrique',
  FINITIONS_INTERIEURES: 'Finitions intérieures',
  FINITIONS_EXTERIEURES: 'Finitions extérieures',
};

export type PreventionPhase = typeof PREVENTION_PHASES[number];
export type PreventionProcessingStatus = 'PENDING' | 'PROCESSING' | 'RETRY' | 'READY' | 'FAILED';
export type PreventionPhaseStatus = 'PROPOSED' | 'VALIDATED';

export const PREVENTION_PROCESSING_LABELS: Record<PreventionProcessingStatus, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  RETRY: 'Nouvelle tentative prévue',
  READY: 'Prêt',
  FAILED: 'Échec',
};

export interface PreventionGroupPhaseStatus {
  sourceGroupId: string;
  processingStatus: PreventionProcessingStatus;
  phaseStatus: PreventionPhaseStatus;
  proposedPhase: PreventionPhase | null;
  effectivePhase: PreventionPhase | null;
  confidence: number | string | null;
  justification: string | null;
  attempts?: number;
  lastErrorCode?: string | null;
  updatedAt?: string;
}

interface PreventionPhaseValidationResult {
  status: 'VALIDATED';
  effectivePhase: PreventionPhase;
}

export const preventionPhaseService = {
  getGroupStatus(visitId: string, groupId: string): Promise<ApiResponse<PreventionGroupPhaseStatus>> {
    return api.get(`/prevention/visits/${encodeURIComponent(visitId)}/groups/${encodeURIComponent(groupId)}/status`);
  },

  updateGroupPhase(visitId: string, groupId: string, phase: PreventionPhase) {
    return apiRequestPhase<PreventionPhaseValidationResult>(visitId, groupId, phase);
  },
};

function apiRequestPhase<T>(visitId: string, groupId: string, phase: PreventionPhase) {
  return apiRequestPatch<T>(
    `/prevention/visits/${encodeURIComponent(visitId)}/groups/${encodeURIComponent(groupId)}/phase`,
    { phase },
  );
}

// Keep PATCH construction in this service so the screen never owns API details.
function apiRequestPatch<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>> {
  return apiRequest<T>(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
