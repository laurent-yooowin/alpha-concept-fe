import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cleanMissionAddress, formatMissionDate, missionAttributionKind, missionAttributionLabel, missionStatusLabel } from '../src/lib/missionPresentation.ts';

test('missing dates and imported addresses are not displayed as 1970 or undefined', () => {
  assert.equal(formatMissionDate(null), 'Date non renseignée');
  assert.equal(formatMissionDate(''), 'Date non renseignée');
  assert.equal(cleanMissionAddress('PETIT CAUX undefined'), 'PETIT CAUX');
  assert.equal(cleanMissionAddress('PARIS 75001'), 'PARIS 75001');
  const missions = readFileSync(new URL('../src/components/MissionManagement.tsx', import.meta.url), 'utf8');
  const reports = readFileSync(new URL('../src/components/ReportManagement.tsx', import.meta.url), 'utf8');
  assert.match(missions, /address: cleanMissionAddress\(mission\.address\)/);
  assert.match(reports, /'Adresse': cleanMissionAddress\(mission\?\.address\)/);
});

test('planned, allocated and assigned remain distinct', () => {
  assert.equal(missionStatusLabel('planifiee'), 'Planifié');
  assert.equal(missionStatusLabel('assignee'), 'Assigné');
  assert.equal(missionStatusLabel('en_cours'), 'En cours');
  assert.equal(missionStatusLabel('en_attente'), 'En attente');
  assert.equal(missionAttributionLabel({ assigned: false, userId: 'coord', user: { role: 'ROLE_USER' } }), 'Affecté au coordonnateur');
  assert.equal(missionAttributionKind({ assigned: false, userId: 'coord', user: { role: 'ROLE_USER' } }), 'affectee');
  assert.equal(missionAttributionKind({ assigned: true, userId: 'coord', user: { role: 'ROLE_USER' } }), 'assignee');
  assert.equal(missionAttributionLabel({ assigned: true, userId: 'coord', user: { role: 'ROLE_USER' } }), 'Assigné via attribution');
  assert.equal(missionAttributionLabel({ assigned: false, userId: 'admin', user: { role: 'ROLE_ADMIN' } }), 'Non affecté');
});

test('budget UI explains why its report denominator differs from indexed reports', () => {
  const budget = readFileSync(new URL('../src/components/prevention/BudgetPage.tsx', import.meta.url), 'utf8');
  const summary = readFileSync(new URL('../src/components/prevention/PreventionPage.tsx', import.meta.url), 'utf8');
  assert.match(budget, /rapport\(s\) avec recommandations budgétisables/);
  assert.match(budget, /rapports sans recommandation exploitable ne sont pas comptés/);
  assert.match(summary, /Rapports indexés/);
});
