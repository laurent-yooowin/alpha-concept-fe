import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLegacyMissionAddress, importedMissionAddress } from './mission-address';

test('CSV or Excel import never appends an absent postal code as undefined', () => {
  assert.equal(importedMissionAddress('PETIT CAUX', undefined), 'PETIT CAUX');
  assert.equal(importedMissionAddress('PETIT CAUX', ''), 'PETIT CAUX');
  assert.equal(importedMissionAddress('PETIT CAUX', '76630'), 'PETIT CAUX 76630');
  assert.equal(importedMissionAddress('PETIT CAUX', 'undefined'), 'PETIT CAUX');
});

test('legacy display cleanup removes only a trailing import artifact', () => {
  assert.equal(cleanLegacyMissionAddress('PARIS undefined'), 'PARIS');
  assert.equal(cleanLegacyMissionAddress('undefined Avenue'), 'undefined Avenue');
  assert.equal(cleanLegacyMissionAddress('PARIS 75001'), 'PARIS 75001');
});
