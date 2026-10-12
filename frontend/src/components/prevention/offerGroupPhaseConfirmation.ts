import Swal from 'sweetalert2';
import { preventionAPI } from '../../lib/api';
import { PREVENTION_PHASES, PreventionPhase } from '../../services/aiService';

export interface GroupPreventionStatus {
  processingStatus: 'PENDING' | 'PROCESSING' | 'RETRY' | 'READY' | 'FAILED';
  phaseStatus: 'PROPOSED' | 'VALIDATED';
  proposedPhase: PreventionPhase | null;
  effectivePhase: PreventionPhase | null;
  confidence: number | string | null;
  justification: string | null;
}

/** Optional Prevention action. Never participate in an SPS save or analysis promise. */
export async function offerGroupPhaseConfirmation(
  visitId: string,
  groupId: string,
  onStatus: (status: GroupPreventionStatus) => void,
): Promise<void> {
  let status: GroupPreventionStatus;
  try {
    status = await preventionAPI.groupStatus(visitId, groupId);
  } catch {
    // The group may not be staged yet, or Prevention may be disabled/unavailable.
    return;
  }
  onStatus(status);
  if (status.processingStatus !== 'READY' || status.phaseStatus === 'VALIDATED' || !status.proposedPhase) return;

  const options = Object.fromEntries(PREVENTION_PHASES.map(({ value, label }) => [value, label]));
  const choice = await Swal.fire({
    title: 'Confirmer la phase du chantier ?',
    text: 'Proposition Prévention facultative. Vous pouvez la confirmer, la modifier ou revenir plus tard.',
    input: 'select',
    inputOptions: options,
    inputValue: status.effectivePhase || status.proposedPhase,
    showCancelButton: true,
    confirmButtonText: 'Confirmer',
    cancelButtonText: 'Plus tard',
    inputValidator: (value) => value && PREVENTION_PHASES.some((phase) => phase.value === value)
      ? undefined : 'Choisissez une phase valide',
  });
  if (!choice.isConfirmed) return;
  try {
    await preventionAPI.updateVisitGroupPhase(visitId, groupId, choice.value as PreventionPhase);
    onStatus({ ...status, phaseStatus: 'VALIDATED', effectivePhase: choice.value as PreventionPhase });
  } catch {
    await Swal.fire({ icon: 'error', title: 'Validation Prévention indisponible', text: 'Le rapport SPS reste enregistré. Vous pourrez confirmer la phase plus tard.' });
  }
}
