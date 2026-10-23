import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClientMultiSelect from '../src/components/prevention/ClientMultiSelect.tsx';
import MultiSelect, { formMultiSelectPlacement } from '../src/components/prevention/MultiSelect.tsx';
import { allPreventionFilters } from '../src/components/prevention/preventionFilterState.ts';

test('the shared client filter renders as a compact multiselect dropdown', () => {
  // The Node tsx loader uses the classic JSX runtime, while Vite uses react-jsx.
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const clients = [{ key: 'cl1', label: 'Client 1' }, { key: 'cl2', label: 'Client 2' }];
    const all = renderToStaticMarkup(createElement(ClientMultiSelect, { clients, selectedKeys: [], onChange: () => undefined }));
    const selected = renderToStaticMarkup(createElement(ClientMultiSelect, { clients, selectedKeys: ['cl1'], onChange: () => undefined }));
    const form = renderToStaticMarkup(createElement(ClientMultiSelect, { appearance: 'form', clients, selectedKeys: [], onChange: () => undefined }));
    const formAllSelected = renderToStaticMarkup(createElement(ClientMultiSelect, { appearance: 'form', clients, selectedKeys: clients.map((client) => client.key), onChange: () => undefined }));
    assert.match(all, /aria-haspopup="listbox"/);
    assert.match(all, /Tous les clients/);
    assert.match(selected, /1 client\(s\)/);
    assert.doesNotMatch(selected, /<fieldset/);
    assert.match(form, /class="relative mt-\[2px\] w-full"/);
    assert.match(form, /class="flex w-full items-center justify-between rounded-md border border-\[#d0d9e8\] bg-white/);
    assert.match(formAllSelected, /2 client\(s\)/);
    const clientFilter = readFileSync(new URL('../src/components/prevention/ClientMultiSelect.tsx', import.meta.url), 'utf8');
    assert.match(clientFilter, /MultiSelect/);
    const budgetPage = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
    assert.match(budgetPage, /sm:col-span-2[^\n]*<MultiSelect appearance="form" label="Chantiers"/);
    assert.match(budgetPage, /sm:col-span-2[^\n]*<ClientMultiSelect appearance="form"/);
    assert.match(budgetPage, /filterControlClass = '[^']*bg-white[^']*'/);
  } finally {
    globalThis.React = previousReact;
  }
});

test('prevention filters can render an enterprise multiselect with the shared control', () => {
  const previousReact = globalThis.React;
  globalThis.React = React;
  try {
    const enterprises = [{ key: 'e1', label: 'Entreprise 1' }, { key: 'e2', label: 'Entreprise 2' }];
    const markup = renderToStaticMarkup(createElement(MultiSelect, {
      options: enterprises, selectedKeys: ['e1'], label: 'Entreprises', allLabel: 'Toutes les entreprises',
      selectedLabel: (count) => `${count} entreprise(s)`, onChange: () => undefined,
    }));
    assert.match(markup, /aria-label="Entreprises"/);
    assert.match(markup, /1 entreprise\(s\)/);
    assert.match(markup, /aria-haspopup="listbox"/);
    assert.match(readFileSync(new URL('../src/components/prevention/MultiSelect.tsx', import.meta.url), 'utf8'), /aria-multiselectable="true"/);
  } finally {
    globalThis.React = previousReact;
  }
});

test('the shared and budget controls keep the approved filter order and Synthèse labels', () => {
  const page = readFileSync(new URL('../src/components/prevention/PreventionPage.tsx', import.meta.url), 'utf8');
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');
  const ordered = (source, labels) => {
    const positions = labels.map((label) => source.indexOf(label));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  };
  ordered(page, ['<span>Chantier</span>', '<span>Entreprise</span>', '>Période\n', '<span>Catégorie</span>', '<span>Gravité</span>']);
  ordered(budget.slice(budget.indexOf('Périmètre du calcul budgétaire')), ['<span>Chantier</span>', '<span>Entreprise</span>', '>Période de départ', '<span>Catégorie</span>', '<span>Gravité</span>']);
  assert.match(page, /rte-topbar-title">Synthèse<\/h1>/);
  assert.match(layout, /name: 'Synthèse'/);
});

test('shared multiselect documents and enforces the backend selection ceiling', () => {
  const multiSelect = readFileSync(new URL('../src/components/prevention/MultiSelect.tsx', import.meta.url), 'utf8');
  assert.match(multiSelect, /MAX_MULTISELECT_OPTIONS = 50/);
  assert.match(multiSelect, /selectAllVisibleKeys\(options, selectedKeys, search, MAX_MULTISELECT_OPTIONS\)/);
  assert.match(multiSelect, /La sélection est limitée à/);
});

test('budget form filter menus float outside the modal layout and fit the visible viewport', () => {
  const source = readFileSync(new URL('../src/components/prevention/MultiSelect.tsx', import.meta.url), 'utf8');
  assert.match(source, /createPortal\(menu, portalTarget\)/);
  assert.match(source, /menuRef\.current\?\.closest\('\[role="dialog"\]'\)/);
  assert.match(source, /appearance === 'form' \? 'fixed'/);
  const nearTop = formMultiSelectPlacement({ left: 40, top: 80, bottom: 112, width: 300 }, { width: 900, height: 800 });
  assert.equal(nearTop.above, false);
  assert.equal(nearTop.top, 116);
  assert.equal(nearTop.maxHeight, 256);
  const nearBottom = formMultiSelectPlacement({ left: 40, top: 700, bottom: 732, width: 300 }, { width: 900, height: 800 });
  assert.equal(nearBottom.above, true);
  assert.equal(nearBottom.top, 696);
  assert.equal(nearBottom.maxHeight, 256);
  const narrowScreen = formMultiSelectPlacement({ left: 30, top: 80, bottom: 112, width: 400 }, { width: 320, height: 600 });
  assert.equal(narrowScreen.left, 8);
  assert.equal(narrowScreen.width, 304);
});

test('empty arrays cannot revive obsolete scalar Prevention filters', () => {
  const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/components/prevention/PreventionPage.tsx', import.meta.url), 'utf8');
  assert.match(api, /if \(Array\.isArray\(normalized\.missionIds\)\) delete normalized\.missionId/);
  assert.match(api, /if \(Array\.isArray\(normalized\.categoryIds\)\) delete normalized\.categoryId/);
  assert.match(api, /if \(Array\.isArray\(normalized\.severities\)\) delete normalized\.severity/);
  assert.doesNotMatch(page, /categoryId: saved\.categoryId|severity: saved\.severity|missionId: saved\.missionId/);
});

test('clear all Prevention filters restores the organization-wide scope without stale scalar filters', () => {
  const cleared = allPreventionFilters();
  assert.deepEqual(cleared, {
    preset: 'ALL', missionIds: [], clientKeys: [], categoryIds: [], severities: [], page: 1,
  });
  for (const key of ['from', 'to', 'missionId', 'categoryId', 'severity', 'riskLevel']) {
    assert.equal(Object.hasOwn(cleared, key), false, `${key} must not survive reset`);
  }
});

test('all five Prevention tabs share one clear action that persists the reset and cannot launch work', () => {
  const page = readFileSync(new URL('../src/components/prevention/PreventionPage.tsx', import.meta.url), 'utf8');
  const clearAction = page.slice(page.indexOf('const clearFilters = useCallback('), page.indexOf('const customPeriodIncomplete'));
  assert.match(page, /Effacer les filtres<\/button>/);
  assert.match(page, /<Filters value=\{filters\} onChange=\{updateFilters\} onClear=\{clearFilters\}/);
  assert.match(clearAction, /rebuildPreviewGeneration\.current \+= 1/);
  assert.match(clearAction, /setRebuildPreview\(null\)/);
  assert.match(page, /const requestedPreviewGeneration = rebuildPreviewGeneration\.current/);
  assert.match(page, /if \(requestedPreviewGeneration !== rebuildPreviewGeneration\.current\) return/);
  assert.match(clearAction, /sessionStorage\.setItem\(filterStorageKey, JSON\.stringify\(cleared\)\)/);
  assert.match(clearAction, /setFilters\(cleared\)/);
  assert.doesNotMatch(clearAction, /preventionAPI\.|startRebuild\(|recalculate\(/);
});
