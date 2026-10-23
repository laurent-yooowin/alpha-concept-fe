import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { filterMissions } from '../services/missionSearch.ts';
const today = new Date(2026, 9, 23);
const missions = [
  { id: 'a', title: 'Résidence Alpha', client: 'Yooowin', location: 'Paris', refClient: null, refBusiness: null, status: 'planifiees' },
  { id: 'b', title: 'Échafaudage Nord', client: 'RTE', location: 'Lyon', refClient: 'REF-12', refBusiness: '', status: 'aujourdhui' },
  { id: 'c', title: 'Chantier Sud', client: 'RTE', location: null, refClient: null, refBusiness: 'AFF-42', status: 'en_retard' },
];

test('mobile chantier search filters all projects by title, client, location and references', () => {
  assert.deepEqual(filterMissions(missions, 'toutes', '  residence  ', today).map((m) => m.id), ['a']);
  assert.deepEqual(filterMissions(missions, 'toutes', 'ECHAFAUDAGE', today).map((m) => m.id), ['b']);
  assert.deepEqual(filterMissions(missions, 'toutes', 'RTE', today).map((m) => m.id), ['b', 'c']);
  assert.deepEqual(filterMissions(missions, 'toutes', 'PARIS', today).map((m) => m.id), ['a']);
  assert.deepEqual(filterMissions(missions, 'toutes', 'ref-12', today).map((m) => m.id), ['b']);
  assert.deepEqual(filterMissions(missions, 'toutes', 'aff-42', today).map((m) => m.id), ['c']);
});

test('search and status filters intersect, and clearing search restores that status scope', () => {
  assert.deepEqual(filterMissions(missions, 'aujourdhui', 'RTE', today).map((m) => m.id), ['b']);
  assert.deepEqual(filterMissions(missions, 'planifiees', 'RTE', today).map((m) => m.id), []);
  assert.deepEqual(filterMissions(missions, 'planifiees', '', today).map((m) => m.id), ['a']);
  assert.deepEqual(filterMissions(missions, 'toutes', '', today).map((m) => m.id), ['a', 'b', 'c']);
});

test('missing fields and empty result do not break chantier search', () => {
  assert.deepEqual(filterMissions([{ id: 'empty', title: null }], 'toutes', 'absent', today), []);
  assert.deepEqual(filterMissions([], 'toutes', 'alpha', today), []);
});

test('Chantiers screen derives visible missions from list, search and active status', () => {
  const screen = readFileSync(new URL('../app/tabs/missions.tsx', import.meta.url), 'utf8');
  assert.match(screen, /useMemo\(\s*\(\) => filterMissions\(missions, activeFilter, searchQuery\),\s*\[missions, activeFilter, searchQuery\]/);
  assert.doesNotMatch(screen, /setFilteredMissions|filtermissions\(/);
});
