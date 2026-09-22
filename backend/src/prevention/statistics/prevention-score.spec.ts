import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  loadScoreConfiguration,
  scoreConfigurationFingerprint,
  validateScoreConfiguration,
} from './prevention-score.config';
import { calculatePreventionScore } from './prevention-score.calculator';
import { PreventionScoreConfigurationService } from './prevention-score-configuration.service';

const env = {
  PREVENTION_SCORE_WEIGHT_SEVERITY: '35', PREVENTION_SCORE_WEIGHT_FREQUENCY: '20',
  PREVENTION_SCORE_WEIGHT_COVERAGE: '15', PREVENTION_SCORE_WEIGHT_RECENCY: '10',
  PREVENTION_SCORE_WEIGHT_RECURRENCE: '10', PREVENTION_SCORE_WEIGHT_TREND: '5',
  PREVENTION_SCORE_WEIGHT_EMERGENCE: '5', PREVENTION_SCORE_SEVERITY_LOW_FACTOR: '0.2',
  PREVENTION_SCORE_SEVERITY_MEDIUM_FACTOR: '0.6', PREVENTION_SCORE_SEVERITY_HIGH_FACTOR: '1',
  PREVENTION_SCORE_FREQUENCY_TARGET: '10', PREVENTION_SCORE_COVERAGE_TARGET: '5',
  PREVENTION_SCORE_RECENCY_RECENT_DAYS: '7', PREVENTION_SCORE_RECENCY_CURRENT_DAYS: '30',
  PREVENTION_SCORE_RECENCY_OLDER_DAYS: '90', PREVENTION_SCORE_RECENCY_CURRENT_FACTOR: '0.75',
  PREVENTION_SCORE_RECENCY_OLDER_FACTOR: '0.4', PREVENTION_SCORE_RECENCY_STALE_FACTOR: '0.1',
  PREVENTION_SCORE_RECURRENCE_TARGET_DAYS: '4', PREVENTION_SCORE_TREND_WINDOW_DAYS: '30',
  PREVENTION_SCORE_EMERGENCE_DAYS: '30', PREVENTION_SCORE_EMERGENCE_MIN_OCCURRENCES: '2',
};

test('environment score configuration is complete, strict and deterministic', () => {
  const configuration = loadScoreConfiguration(new ConfigService(env));
  assert.equal(Object.values(configuration.weights).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(scoreConfigurationFingerprint(configuration).length, 64);
  assert.throws(() => loadScoreConfiguration(new ConfigService({ ...env,
    PREVENTION_SCORE_WEIGHT_EMERGENCE: '6' })), /totaling 100/);
  assert.throws(() => loadScoreConfiguration(new ConfigService({ ...env,
    PREVENTION_SCORE_FREQUENCY_TARGET: '' })), /required/);
});

test('score calculator follows default components and bounds the total', () => {
  const configuration = loadScoreConfiguration(new ConfigService(env));
  const result = calculatePreventionScore({
    riskLevel: 'eleve', occurrenceCount: 10, missionCount: 5, distinctDayCount: 5,
    firstOccurrence: '2026-09-01', lastOccurrence: '2026-09-14', referenceDate: '2026-09-15',
    recentWindowCount: 10, previousWindowCount: 2,
  }, configuration);
  assert.equal(result.score, 100);
  assert.deepEqual(result.components, configuration.weights);
});

test('custom configuration changes the score and rejects incoherent thresholds', () => {
  const configuration = loadScoreConfiguration(new ConfigService(env));
  const custom = { ...configuration, weights: {
    severity: 100, frequency: 0, coverage: 0, recency: 0,
    recurrence: 0, trend: 0, emergence: 0,
  } };
  validateScoreConfiguration(custom);
  assert.equal(calculatePreventionScore({
    riskLevel: 'faible', occurrenceCount: 1, missionCount: 1, distinctDayCount: 1,
    firstOccurrence: '2026-01-01', lastOccurrence: '2026-01-01', referenceDate: '2026-09-15',
    recentWindowCount: 0, previousWindowCount: 0,
  }, custom).score, 20);
  assert.throws(() => validateScoreConfiguration({ ...configuration,
    recencyCurrentDays: 7 }), /strictly increasing/);
  assert.throws(() => validateScoreConfiguration({ ...configuration,
    frequencyTarget: 0 }), /thresholds or factors/);
});

test('database configuration rejects missing and extra JSON fields', async () => {
  const configuration = loadScoreConfiguration(new ConfigService(env));
  const row = {
    id: '70000000-0000-4000-8000-000000000001', version: 1,
    configurationFingerprint: scoreConfigurationFingerprint(configuration),
    weights: { ...configuration.weights },
    factors: {
      severityLow: configuration.severityFactors.low,
      severityMedium: configuration.severityFactors.medium,
      severityHigh: configuration.severityFactors.high,
      recencyCurrent: configuration.recencyCurrentFactor,
      recencyOlder: configuration.recencyOlderFactor,
      recencyStale: configuration.recencyStaleFactor,
    },
    thresholds: {
      frequencyTarget: configuration.frequencyTarget,
      coverageTarget: configuration.coverageTarget,
      recencyRecentDays: configuration.recencyRecentDays,
      recencyCurrentDays: configuration.recencyCurrentDays,
      recencyOlderDays: configuration.recencyOlderDays,
      recurrenceTargetDays: configuration.recurrenceTargetDays,
      trendWindowDays: configuration.trendWindowDays,
      emergenceDays: configuration.emergenceDays,
      emergenceMinimumOccurrences: configuration.emergenceMinimumOccurrences,
    },
  };
  const service = (invalidRow: any) => new PreventionScoreConfigurationService(
    { query: async () => [invalidRow] } as any,
    { configuration, fingerprint: scoreConfigurationFingerprint(configuration) } as any,
  );
  const missing = { ...row, thresholds: { ...row.thresholds } };
  delete missing.thresholds.trendWindowDays;
  await assert.rejects(() => service(missing).effectiveFor('org'), /thresholds is invalid/);
  await assert.rejects(() => service({ ...row, weights: { ...row.weights, arbitrary: 0 } })
    .effectiveFor('org'), /weights is invalid/);
});
