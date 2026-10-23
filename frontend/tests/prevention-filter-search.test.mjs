import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterOptionsBySearch, selectAllVisibleKeys } from '../src/components/prevention/filterSearch.ts';
import SearchableSelect from '../src/components/prevention/SearchableSelect.tsx';
import * as mobilePhaseSearch from '../../mobile/services/preventionPhaseSearch.ts';

const { filterPhaseOptions, phaseSearchMatches } = mobilePhaseSearch.default ?? mobilePhaseSearch;

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Web option search ignores case and accents without changing the underlying options', () => {
  const options = [{ key: 'a', label: 'Échafaudage' }, { key: 'b', label: 'Gros œuvre' }];
  assert.deepEqual(filterOptionsBySearch(options, '  ECHA  '), [options[0]]);
  assert.deepEqual(filterOptionsBySearch(options, 'oeuvre'), [options[1]]);
  assert.deepEqual(filterOptionsBySearch(options, 'aucun'), []);
  assert.deepEqual(filterOptionsBySearch(options, ''), options);
  assert.equal(options.length, 2);
});

test('select all stays global without search and adds only matching options with search', () => {
  const options = [
    { key: 'a', label: 'Échafaudage' },
    { key: 'b', label: 'Gros œuvre' },
    { key: 'c', label: 'Petit œuvre' },
  ];
  assert.deepEqual(selectAllVisibleKeys(options, ['a'], '', 50), ['a', 'b', 'c']);
  assert.deepEqual(selectAllVisibleKeys(options, ['a'], 'oeuvre', 50), ['a', 'b', 'c']);
  assert.deepEqual(selectAllVisibleKeys(options, ['a'], 'gros', 50), ['a', 'b']);
  assert.equal(selectAllVisibleKeys(options, ['a'], 'absent', 50), null);
  assert.deepEqual(selectAllVisibleKeys(Array.from({ length: 51 }, (_, index) => ({ key: String(index), label: String(index) })), [], '', 50).length, 50);
});

test('search select all never partially changes the selection at the 50-item ceiling', () => {
  const options = Array.from({ length: 51 }, (_, index) => ({ key: String(index), label: index < 49 ? 'Autre' : 'Cible' }));
  const selected = options.slice(0, 49).map((option) => option.key);
  assert.equal(selectAllVisibleKeys(options, selected, 'cible', 50), null);
  assert.deepEqual(selected, options.slice(0, 49).map((option) => option.key));
  const roomForBoth = selected.slice(0, 48);
  assert.deepEqual(selectAllVisibleKeys(options, roomForBoth, 'cible', 50), [...roomForBoth, '49', '50']);
});

test('mobile phase search retains the selected phase even if its label does not match', () => {
  const options = [{ value: 'a', label: 'Échafaudage' }, { value: 'b', label: 'Gros œuvre' }];
  assert.deepEqual(filterPhaseOptions(options, 'oeuvre', 'a'), options);
  assert.deepEqual(filterPhaseOptions(options, 'echa'), [options[0]]);
  assert.deepEqual(filterPhaseOptions(options, 'aucun'), []);
  assert.equal(phaseSearchMatches('Autre phase…', 'AUTRE'), true);
  assert.equal(phaseSearchMatches('Autre phase…', 'aucun'), false);
});

test('single-value Web selector retains its current label and exposes a searchable popup', () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const markup = renderToStaticMarkup(createElement(SearchableSelect, {
      options: [{ value: 'ALL', label: 'Toute la période' }], value: 'ALL', label: 'Période', onChange: () => undefined,
    }));
    assert.match(markup, /aria-haspopup="listbox"/);
    assert.match(markup, /Toute la période/);
  } finally {
    globalThis.React = previousReact;
  }
  assert.match(source('../src/components/prevention/SearchableSelect.tsx'), /type="search"/);
  assert.match(source('../src/components/prevention/SearchableSelect.tsx'), /createPortal\(menu, portalTarget\)/);
});

test('existing Web filters and both phase confirmations add search without changing selection contracts', () => {
  const multi = source('../src/components/prevention/MultiSelect.tsx');
  const page = source('../src/components/prevention/PreventionPage.tsx');
  const budget = source('../src/components/prevention/BudgetPage.tsx');
  const webPhase = source('../src/components/prevention/offerGroupPhaseConfirmation.ts');
  const mobile = source('../../mobile/app/tabs/visite.tsx');
  assert.match(multi, /filterOptionsBySearch\(options, search\)/);
  assert.match(multi, /aria-label=\{`Rechercher dans \$\{label\}`\}/);
  assert.match(multi, /selectAllVisibleKeys\(options, selectedKeys, search, MAX_MULTISELECT_OPTIONS\)/);
  assert.match(multi, /if \(selectAllKeys\) onChange\(selectAllKeys\)/);
  assert.match(page, /<SearchableSelect label="Période"/);
  assert.match(budget, /<SearchableSelect appearance="form" label="Période de départ"/);
  assert.match(webPhase, /id="prevention-phase-search"/);
  assert.match(webPhase, /popup\?\.append\(menu\)/);
  assert.ok(webPhase.indexOf('id="prevention-phase-search"') > webPhase.indexOf('id="prevention-phase-menu"'));
  assert.match(webPhase, /dataset\.phase/);
  assert.match(mobile, /visiblePreventionPhaseOptions\.map\(phase =>/);
  assert.match(mobile, /accessibilityLabel="Rechercher une phase"/);
  assert.match(mobile, /preventionPhaseDropdownOpen && <View[\s\S]*?<TextInput value=\{preventionPhaseSearch\}/);
});
