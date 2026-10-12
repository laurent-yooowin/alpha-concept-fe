import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatReportDate,
  withoutLegacyGeneratedFooterDate,
  withoutLegacyGeneratedHeaderDate,
  withReportDatesAfterLocation,
} from '../src/components/reportDatePresentation.ts';

test('chantier, visit and report dates retain distinct calendar days', () => {
  assert.equal(formatReportDate('2026-09-28'), '28/09/2026');
  assert.equal(formatReportDate('2026-09-30T08:00:00.000Z'), '30/09/2026');
  assert.equal(formatReportDate('2026-09-29T08:00:00.000Z'), '29/09/2026');
  assert.equal(formatReportDate('29/09/2026'), '29/09/2026');
});

test('visit and report dates appear as plain lines between location and coordinator', () => {
  const header = 'RAPPORT DE VISITE SPS\nLIEU: Paris\nCOORDONNATEUR: Alice\nRÉSUMÉ';
  assert.equal(withReportDatesAfterLocation(header, [
    { label: 'Date de la visite', value: '11/08/2026' },
    { label: 'Date du rapport', value: '10/08/2026' },
  ]), 'RAPPORT DE VISITE SPS\nLIEU: Paris\nDate de la visite : 11/08/2026\nDate du rapport : 10/08/2026\nCOORDONNATEUR: Alice\nRÉSUMÉ');
});


test('only legacy generated date lines are removed from editable framing', () => {
  assert.equal(
    withoutLegacyGeneratedHeaderDate('RAPPORT DE VISITE SPS\nNote conservée\nDATE: 01/10/2026\nAutre ligne'),
    'RAPPORT DE VISITE SPS\nNote conservée\nAutre ligne',
  );
  assert.equal(
    withoutLegacyGeneratedFooterDate('CONCLUSION:\nÀ suivre\nDate: 01/10/2026'),
    'CONCLUSION:\nÀ suivre',
  );
  assert.equal(
    withoutLegacyGeneratedHeaderDate('En-tête personnalisé\nDATE: 01/10/2026'),
    'En-tête personnalisé\nDATE: 01/10/2026',
  );
});
