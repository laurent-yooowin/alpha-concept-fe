import assert from 'node:assert/strict';
import test from 'node:test';
import { changedReportGroups, generateEditedReportContent } from '../src/components/reportEdits.ts';

test('an edited historical report sends only changed group fields', () => {
  const original = [
    { id: 'p1', groupId: 'g1', analysis: { observation: ['Avant'], recommendation: ['Avant'], references: ['Avant'], riskLevel: 'moyen' }, comment: 'Note initiale' },
    { id: 'p2', groupId: 'g2', analysis: { observation: ['Intact'], recommendation: [], references: [] }, comment: '' },
  ];
  const edited = [
    { ...original[0], analysis: { observation: ['Après'], recommendation: ['Sécuriser'], references: ['Référence'], riskLevel: 'moyen' }, comment: 'Note modifiée' },
    original[1],
  ];
  assert.deepEqual(changedReportGroups(original, edited), [{
    groupId: 'g1', observations: ['Après'], recommendations: ['Sécuriser'], references: ['Référence'], comment: 'Note modifiée',
  }]);
  assert.equal(original[0].analysis.observation[0], 'Avant');
  const content = generateEditedReportContent(edited);
  assert.match(content, /Après/);
  assert.match(content, /Sécuriser/);
  assert.match(content, /Référence/);
});

test('unchanged or legacy groups are not rewritten by a report-only edit', () => {
  const photos = [
    { id: 'legacy-photo', comment: 'Note historique' },
    { id: 'directive', groupId: 'directive-group', analysis: { observation: 'Consigne existante' } },
  ];
  assert.deepEqual(changedReportGroups(photos, structuredClone(photos)), []);
  assert.doesNotThrow(() => generateEditedReportContent(photos));
});

test('removing a recommendation persists an empty list only for its group', () => {
  const before = [{ id: 'p1', groupId: 'g1', analysis: { recommendation: ['À retirer'] } }];
  const after = [{ id: 'p1', groupId: 'g1', analysis: { recommendation: [] } }];
  assert.deepEqual(changedReportGroups(before, after), [{ groupId: 'g1', recommendations: [] }]);
});
