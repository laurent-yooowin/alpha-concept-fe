import Swal from 'sweetalert2';
import { preventionAPI } from '../../lib/api';
import { PREVENTION_PHASES, PreventionPhase } from '../../services/aiService';
import { filterOptionsBySearch, normalizedFilterSearch } from './filterSearch';
import { formMultiSelectPlacement } from './MultiSelect';

export interface GroupPreventionStatus {
  processingStatus: 'PENDING' | 'PROCESSING' | 'RETRY' | 'READY' | 'FAILED';
  phaseStatus: 'PROPOSED' | 'VALIDATED';
  proposedPhase: PreventionPhase | null;
  effectivePhase: PreventionPhase | null;
  proposedPhaseLabel?: string | null;
  effectivePhaseLabel?: string | null;
  confidence: number | string | null;
  justification: string | null;
}

export function groupPreventionPhaseLabel(status?: GroupPreventionStatus): string {
  if (!status) return 'En attente';
  const phase = status.phaseStatus === 'VALIDATED' ? status.effectivePhase : status.proposedPhase;
  const label = status.phaseStatus === 'VALIDATED' ? status.effectivePhaseLabel : status.proposedPhaseLabel;
  return label || PREVENTION_PHASES.find((option) => option.value === phase)?.label || 'En attente';
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

  let options: Array<{ value: string; label: string }>;
  try {
    options = await preventionAPI.phaseCatalog();
  } catch {
    await Swal.fire({ icon: 'error', title: 'Catalogue des phases indisponible', text: 'Réessayez plus tard pour confirmer la phase.' });
    return;
  }
  const customOption = '__CUSTOM_PHASE__';
  const phaseFieldClass = 'box-border h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200';
  let cleanupMenu = () => {};
  const choice = await Swal.fire({
    title: 'Confirmer la phase du chantier ?',
    html: `<p>Proposition Prévention facultative. Vous pouvez la confirmer, la modifier ou revenir plus tard.</p>
      <label for="prevention-phase-select" class="mb-2 mt-4 block text-left text-sm font-medium text-slate-700">Phase</label>
      <button id="prevention-phase-select" type="button" class="${phaseFieldClass} flex items-center justify-between text-left" aria-label="Phase de chantier" aria-haspopup="listbox" aria-expanded="false" aria-controls="prevention-phase-options"><span id="prevention-phase-selected" class="truncate"></span><span aria-hidden="true">▾</span></button>
      <div id="prevention-phase-menu" class="fixed z-50 overflow-y-auto rounded-lg border border-slate-300 bg-white p-2 text-left shadow-lg" style="display:none">
        <input id="prevention-phase-search" type="search" class="${phaseFieldClass} mb-2 block" aria-label="Rechercher une phase" placeholder="Rechercher une phase…" autocomplete="off" />
        <div id="prevention-phase-options" role="listbox" aria-label="Phases de chantier"></div>
        <p id="prevention-phase-search-empty" class="px-2 py-2 text-sm text-slate-500" style="display:none">Aucun résultat.</p>
      </div>
      <div id="prevention-custom-phase-row" style="display:none">
        <label for="prevention-custom-phase" class="mb-2 mt-4 block text-left text-sm font-medium text-slate-700">Nouvelle phase</label>
        <input id="prevention-custom-phase" type="text" class="${phaseFieldClass} block" maxlength="80" autocomplete="off" />
      </div>`,
    showCancelButton: true,
    confirmButtonText: 'Confirmer',
    cancelButtonText: 'Plus tard',
    didOpen: () => {
      const popup = Swal.getPopup();
      const select = popup?.querySelector<HTMLButtonElement>('#prevention-phase-select');
      const selectedLabel = popup?.querySelector<HTMLElement>('#prevention-phase-selected');
      const menu = popup?.querySelector<HTMLElement>('#prevention-phase-menu');
      const list = popup?.querySelector<HTMLElement>('#prevention-phase-options');
      const search = popup?.querySelector<HTMLInputElement>('#prevention-phase-search');
      const empty = popup?.querySelector<HTMLElement>('#prevention-phase-search-empty');
      const customRow = popup?.querySelector<HTMLElement>('#prevention-custom-phase-row');
      if (!select || !selectedLabel || !menu || !list || !search || !empty || !customRow) return;
      popup?.append(menu);
      let selected = status.effectivePhase || status.proposedPhase || options[0]?.value || '';
      const closeMenu = () => { menu.style.display = 'none'; select.setAttribute('aria-expanded', 'false'); };
      const positionMenu = () => {
        if (menu.style.display === 'none') return;
        const placement = formMultiSelectPlacement(select.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
        Object.assign(menu.style, { left: `${placement.left}px`, top: `${placement.top}px`, width: `${placement.width}px`, maxHeight: `${placement.maxHeight}px`, transform: placement.above ? 'translateY(-100%)' : '' });
      };
      const renderOptions = () => {
        const matches = filterOptionsBySearch(options, search.value);
        const customMatches = !normalizedFilterSearch(search.value) || normalizedFilterSearch('Autre phase…').includes(normalizedFilterSearch(search.value));
        list.replaceChildren();
        for (const option of [...matches, ...(customMatches ? [{ value: customOption, label: 'Autre phase…' }] : [])]) {
          const item = document.createElement('button');
          item.type = 'button';
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', String(option.value === selected));
          item.className = 'block w-full rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-100';
          item.textContent = option.label;
          item.addEventListener('click', () => {
            selected = option.value;
            select.dataset.phase = selected;
            selectedLabel.textContent = option.label;
            customRow.style.display = selected === customOption ? 'block' : 'none';
            closeMenu();
            if (selected === customOption) popup?.querySelector<HTMLInputElement>('#prevention-custom-phase')?.focus();
            else select.focus();
          });
          list.append(item);
        }
        empty.style.display = list.childElementCount ? 'none' : 'block';
      };
      select.dataset.phase = selected;
      selectedLabel.textContent = options.find((option) => option.value === selected)?.label || 'Choisissez une phase';
      renderOptions();
      search.addEventListener('input', renderOptions);
      select.addEventListener('click', () => {
        if (menu.style.display !== 'none') { closeMenu(); return; }
        menu.style.display = 'block';
        select.setAttribute('aria-expanded', 'true');
        positionMenu();
        search.focus();
      });
      select.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' && menu.style.display === 'none') { event.preventDefault(); select.click(); }
      });
      menu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); select.focus(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const items = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
          if (!items.length) return;
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (event.target !== search && index < 0) return;
          event.preventDefault();
          items[event.key === 'ArrowDown' ? Math.min(index + 1, items.length - 1) : index <= 0 ? items.length - 1 : index - 1].focus();
        }
      });
      const onOutside = (event: PointerEvent) => {
        if (event.target instanceof Node && !menu.contains(event.target) && !select.contains(event.target)) closeMenu();
      };
      document.addEventListener('pointerdown', onOutside);
      window.addEventListener('resize', positionMenu);
      window.addEventListener('scroll', positionMenu, true);
      cleanupMenu = () => {
        document.removeEventListener('pointerdown', onOutside);
        window.removeEventListener('resize', positionMenu);
        window.removeEventListener('scroll', positionMenu, true);
      };
    },
    willClose: () => cleanupMenu(),
    preConfirm: () => {
      const popup = Swal.getPopup();
      const selected = popup?.querySelector<HTMLButtonElement>('#prevention-phase-select')?.dataset.phase || '';
      if (selected === customOption) {
        const label = popup?.querySelector<HTMLInputElement>('#prevention-custom-phase')?.value.trim().replace(/\s+/g, ' ') || '';
        if (label.length < 3 || label.length > 80 || /[\u0000-\u001f\u007f<>]/.test(label)) {
          Swal.showValidationMessage('Saisissez une phase de 3 à 80 caractères sans caractères interdits.');
          return false;
        }
        return { customPhaseLabel: label };
      }
      if (!options.some((option) => option.value === selected)) {
        Swal.showValidationMessage('Choisissez une phase valide.');
        return false;
      }
      return { phase: selected };
    },
  });
  if (!choice.isConfirmed || !choice.value) return;
  try {
    const result = await preventionAPI.updateVisitGroupPhase(visitId, groupId, choice.value);
    onStatus({ ...status, phaseStatus: 'VALIDATED', effectivePhase: result.effectivePhase,
      effectivePhaseLabel: result.effectivePhaseLabel });
  } catch (error) {
    const status = (error as { status?: number })?.status;
    const message = status === 400
      ? 'Cette phase existe déjà ou son libellé est invalide. Choisissez une phase dans la liste.'
      : status === 429
        ? 'Limite de création de phases atteinte pour aujourd’hui. Réessayez demain.'
        : 'Le rapport SPS reste enregistré. Vous pourrez confirmer la phase plus tard.';
    await Swal.fire({ icon: 'error', title: 'Validation Prévention indisponible', text: message });
  }
}
