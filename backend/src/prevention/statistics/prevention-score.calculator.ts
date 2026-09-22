import {
  PreventionScoreConfiguration,
  PreventionScoreInput,
  PreventionScoreResult,
} from './prevention-score.types';

function daysBetween(referenceDate: string, value: string): number {
  const reference = Date.parse(`${referenceDate}T00:00:00.000Z`);
  const date = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(reference) || !Number.isFinite(date) || date > reference) {
    throw new Error('Invalid prevention score date');
  }
  return Math.floor((reference - date) / 86_400_000);
}

export function calculatePreventionScore(
  input: PreventionScoreInput,
  config: PreventionScoreConfiguration,
): PreventionScoreResult {
  const nonNegative = [input.occurrenceCount, input.missionCount, input.distinctDayCount,
    input.recentWindowCount, input.previousWindowCount];
  if (nonNegative.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('Prevention score counts must be non-negative integers');
  }
  const age = daysBetween(input.referenceDate, input.lastOccurrence);
  const firstAge = daysBetween(input.referenceDate, input.firstOccurrence);
  const severityFactor = input.riskLevel === 'faible'
    ? config.severityFactors.low
    : input.riskLevel === 'moyen'
      ? config.severityFactors.medium
      : config.severityFactors.high;
  const recencyFactor = age <= config.recencyRecentDays ? 1
    : age <= config.recencyCurrentDays ? config.recencyCurrentFactor
      : age <= config.recencyOlderDays ? config.recencyOlderFactor
        : config.recencyStaleFactor;
  const trendFactor = input.recentWindowCount > input.previousWindowCount ? 1
    : input.recentWindowCount === input.previousWindowCount ? 0.5 : 0;
  const factors = {
    severity: severityFactor,
    frequency: Math.min(input.occurrenceCount / config.frequencyTarget, 1),
    coverage: Math.min(input.missionCount / config.coverageTarget, 1),
    recency: recencyFactor,
    recurrence: Math.min(Math.max(input.distinctDayCount - 1, 0) / config.recurrenceTargetDays, 1),
    trend: trendFactor,
    emergence: firstAge <= config.emergenceDays &&
      input.occurrenceCount >= config.emergenceMinimumOccurrences ? 1 : 0,
  };
  const components = Object.fromEntries(Object.entries(config.weights).map(([name, weight]) => [
    name, Math.round(weight * factors[name as keyof typeof factors] * 100) / 100,
  ])) as unknown as PreventionScoreResult['components'];
  return {
    score: Math.max(0, Math.min(100, Math.round(
      Object.values(components).reduce((sum, value) => sum + value, 0),
    ))),
    components,
  };
}
