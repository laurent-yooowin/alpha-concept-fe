import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../src/components/Dashboard.tsx', import.meta.url), 'utf8');

test('organization dashboard activity subtitle omits SPS', () => {
  assert.match(dashboard, />Vue d'ensemble de l'activité<\/p>/);
  assert.doesNotMatch(dashboard, /Vue d'ensemble de l'activité SPS/);
});

test('report summary shows cancelled instead of the obsolete validated card', () => {
  assert.match(dashboard, /\{stats\.cancelledReports\}<\/p>\s*<p[^>]*>Annulés<\/p>/);
  assert.match(dashboard, /\{stats\.sentReports\}<\/p>\s*<p[^>]*>Envoyés au client<\/p>/);
  assert.doesNotMatch(dashboard, /stats\.validatedReports|>Validés<|Aucun rapport validé/);
});

test('processing time shows the eligible chantier count from the same average', () => {
  assert.match(dashboard, /Temps moyen de traitement/);
  assert.match(dashboard, /stats\.avgProcessingMissionCount/);
  assert.match(dashboard, /avec rapport envoyé/);
  assert.match(dashboard, /Aucun chantier avec rapport envoyé daté/);
  assert.match(dashboard, /item\.status === 'terminee' \? 'Terminés' : missionStatusLabel\(item\.status\)/);
});
