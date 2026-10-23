import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the Web phase confirmation uses the global catalog and can create a custom phase', () => {
  const confirmation = source('../src/components/prevention/offerGroupPhaseConfirmation.ts');
  const api = source('../src/lib/api.ts');
  assert.match(api, /phaseCatalog:.*\/prevention\/visits\/phases/);
  assert.match(confirmation, /await preventionAPI\.phaseCatalog\(\)/);
  assert.match(confirmation, /Autre phase…/);
  assert.match(confirmation, /customPhaseLabel: label/);
  assert.match(confirmation, />Nouvelle phase<\/label>/);
  assert.doesNotMatch(confirmation, /Nouvelle phase \(visible par toutes les organisations\)/);
  assert.match(confirmation, /effectivePhaseLabel: result\.effectivePhaseLabel/);
  assert.match(confirmation, /phaseFieldClass = '[^']*h-10 w-full[^']*border border-slate-300[^']*'/);
  assert.match(confirmation, /id="prevention-phase-select" type="button" class="\$\{phaseFieldClass\} flex/);
  assert.match(confirmation, /id="prevention-phase-menu"[\s\S]*?id="prevention-phase-search"/);
  assert.match(confirmation, /id="prevention-custom-phase" type="text" class="\$\{phaseFieldClass\} block"/);
  assert.match(confirmation, /for="prevention-phase-select" class="mb-2 mt-4 block/);
  assert.match(confirmation, /for="prevention-custom-phase" class="mb-2 mt-4 block/);
  assert.doesNotMatch(confirmation, /id="prevention-phase-select" class="swal2-select"/);
});

test('the mobile phase confirmation retains the server label and offers a custom input', () => {
  const screen = source('../../mobile/app/tabs/visite.tsx');
  const service = source('../../mobile/services/preventionPhaseService.ts');
  assert.match(service, /getPhaseCatalog\(\)/);
  assert.match(service, /customPhaseLabel: string/);
  assert.match(screen, /preventionPhaseService\.getPhaseCatalog\(\)/);
  assert.match(screen, /Autre phase…/);
  assert.match(screen, /customPreventionPhaseLabel/);
  assert.match(screen, /effectivePhaseLabel: validated\.effectivePhaseLabel/);
  assert.match(screen, /accessibilityState=\{\{ expanded: preventionPhaseDropdownOpen \}\}/);
  assert.match(screen, /preventionPhaseDropdownOpen && <View[\s\S]*?accessibilityLabel="Rechercher une phase"/);
});
