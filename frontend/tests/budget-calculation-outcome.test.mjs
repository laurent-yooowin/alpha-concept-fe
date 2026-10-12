import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetCalculationOutcome } from '../src/components/prevention/budgetCalculationOutcome.ts';

test('a completed budget with priced and unclassified lines is not reported as an AI failure', () => {
  const message = budgetCalculationOutcome([
    { status: 'ESTIME', aiEstimateDetails: { kind: 'AI_ESTIMATE' } },
    { status: 'A_CHIFFRER', aiEstimateDetails: null },
  ], 'Calcul terminé.');
  assert.match(message, /1 estimation\(s\) IA/);
  assert.match(message, /1 poste\(s\) à classer/);
  assert.doesNotMatch(message, /worker|configuration LLM/);
});

test('a completed budget with only unclassified lines reports zero estimates without inventing a worker failure', () => {
  assert.equal(budgetCalculationOutcome([{ status: 'A_CHIFFRER' }], 'Calcul terminé.'),
    'Calcul terminé. 0 estimation(s) IA ; 1 poste(s) à classer ou chiffrer manuellement.');
});
