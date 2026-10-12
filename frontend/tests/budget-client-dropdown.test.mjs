import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClientMultiSelect from '../src/components/prevention/ClientMultiSelect.tsx';

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
    assert.match(clientFilter, /appearance === 'form' \? 'relative w-full' : 'absolute left-0 top-full min-w-\[240px\]'/);
    assert.match(clientFilter, /onClick=\{\(\) => onChange\(\[\]\)\}>Tout désélectionner<\/button>/);
    assert.match(clientFilter, /Sans sélection : tous les clients\./);
    const budgetPage = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
    assert.match(budgetPage, /sm:col-span-2[^\n]*<ClientMultiSelect appearance="form"/);
    assert.match(budgetPage, /filterControlClass = '[^']*bg-white[^']*'/);
  } finally {
    globalThis.React = previousReact;
  }
});
