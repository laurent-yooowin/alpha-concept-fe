import assert from 'node:assert/strict';
import test from 'node:test';
import { isFinalReportStatus } from '../src/components/reportFinalStatus.ts';

test('only client-sent and archived reports are immutable', () => {
  assert.equal(isFinalReportStatus('envoye_au_client'), true);
  assert.equal(isFinalReportStatus('archive'), true);
  assert.equal(isFinalReportStatus('brouillon'), false);
  assert.equal(isFinalReportStatus('valide'), false);
  assert.equal(isFinalReportStatus(undefined), false);
});
