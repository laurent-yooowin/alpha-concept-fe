import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../src/components/hyperAdmin/HyperAdminDashboard.tsx', import.meta.url), 'utf8');
const organizations = readFileSync(new URL('../src/components/hyperAdmin/HyperAdminOrganizations.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');

test('report status chart colors are keyed by status, not chart position', () => {
  assert.match(dashboard, /envoye_au_client: \{[^\n]*chartColor: '#7c3aed'/);
  assert.match(dashboard, /brouillon: \{[^\n]*chartColor: '#64748b'/);
  assert.match(dashboard, /fill=\{entry\.chartColor\}/);
});

test('organization link displays the actual slug-first login path', () => {
  assert.match(dashboard, />\/\{row\.organization\.slug\}\/login/);
  assert.doesNotMatch(dashboard, /\/login\/\{row\.organization\.slug\}/);
});

test('empty organization results distinguish filtering from no organizations', () => {
  assert.match(organizations, /orgs\.length === 0 \? 'Aucune organisation\. Créez la première\.' : 'Aucune organisation ne correspond aux filtres\.'/);
});

test('pending legal validation does not mount the application outlet', () => {
  assert.match(layout, /if \(isAdmin && organization\?\.legalValidationStatus === 'en_cours'\)/);
  assert.match(layout, /return <div className="min-h-screen bg-slate-100"><LegalValidationModal onSignOut=\{handleSignOut\} \/><\/div>/);
});
