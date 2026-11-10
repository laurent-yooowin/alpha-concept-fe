import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

test('report summary shows cancelled instead of the obsolete validated card', () => {
  assert.match(dashboard, /\{stats\.cancelledReports\}<\/p>\s*<p[^>]*>Annulés<\/p>/);
  assert.match(dashboard, /\{stats\.sentReports\}<\/p>\s*<p[^>]*>Envoyés au client<\/p>/);
  assert.doesNotMatch(dashboard, /stats\.validatedReports|>Validés<|Aucun rapport validé/);
});

test('processing time describes chantier creation to first client send', () => {
  assert.match(dashboard, /Temps moyen de traitement/);
  assert.match(dashboard, /création du chantier → premier envoi client/);
  assert.match(dashboard, /Aucun chantier avec rapport envoyé daté/);
  assert.match(dashboard, /item\.status === 'terminee' \? 'Terminés' : missionStatusLabel\(item\.status\)/);
});
