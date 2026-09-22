import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PreventionScoreConfiguration } from './prevention-score.types';

const ENV_KEYS = {
  severity: 'PREVENTION_SCORE_WEIGHT_SEVERITY',
  frequency: 'PREVENTION_SCORE_WEIGHT_FREQUENCY',
  coverage: 'PREVENTION_SCORE_WEIGHT_COVERAGE',
  recency: 'PREVENTION_SCORE_WEIGHT_RECENCY',
  recurrence: 'PREVENTION_SCORE_WEIGHT_RECURRENCE',
  trend: 'PREVENTION_SCORE_WEIGHT_TREND',
  emergence: 'PREVENTION_SCORE_WEIGHT_EMERGENCE',
} as const;

function numberValue(config: ConfigService, key: string, options: {
  integer?: boolean; min?: number; max?: number;
} = {}): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new Error(`${key} is required`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || (options.integer && !Number.isInteger(value)) ||
      value < (options.min ?? -Infinity) || value > (options.max ?? Infinity)) {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export function validateScoreConfiguration(value: PreventionScoreConfiguration): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.weights || typeof value.weights !== 'object' || Array.isArray(value.weights) ||
      !value.severityFactors || typeof value.severityFactors !== 'object' ||
      Array.isArray(value.severityFactors)) {
    throw new Error('Prevention score configuration is incomplete');
  }
  const exactKeys = (record: object, expected: string[], label: string) => {
    const actual = Object.keys(record).sort();
    if (actual.join('|') !== [...expected].sort().join('|')) {
      throw new Error(`Prevention score ${label} fields are invalid`);
    }
  };
  exactKeys(value.weights, Object.keys(ENV_KEYS), 'weight');
  exactKeys(value.severityFactors, ['low', 'medium', 'high'], 'severity factor');
  const weights = Object.values(value.weights);
  if (weights.some((weight) => typeof weight !== 'number' || !Number.isInteger(weight) ||
      weight < 0 || weight > 100) ||
      weights.reduce((sum, weight) => sum + weight, 0) !== 100) {
    throw new Error('Prevention score weights must be integers totaling 100');
  }
  const factors = Object.values(value.severityFactors);
  if (factors.some((factor) => typeof factor !== 'number' || !Number.isFinite(factor) ||
      factor < 0 || factor > 1) ||
      !(factors[0] <= factors[1] && factors[1] <= factors[2])) {
    throw new Error('Prevention severity factors must be ordered between 0 and 1');
  }
  if (!(value.recencyRecentDays < value.recencyCurrentDays &&
        value.recencyCurrentDays < value.recencyOlderDays)) {
    throw new Error('Prevention recency thresholds must be strictly increasing');
  }
  if (!(value.recencyCurrentFactor >= value.recencyOlderFactor &&
        value.recencyOlderFactor >= value.recencyStaleFactor)) {
    throw new Error('Prevention recency factors must be decreasing');
  }
  const positiveIntegers = [value.frequencyTarget, value.coverageTarget,
    value.recurrenceTargetDays, value.trendWindowDays, value.emergenceDays,
    value.emergenceMinimumOccurrences];
  const nonNegativeIntegers = [value.recencyRecentDays, value.recencyCurrentDays,
    value.recencyOlderDays];
  const recencyFactors = [value.recencyCurrentFactor, value.recencyOlderFactor,
    value.recencyStaleFactor];
  if (positiveIntegers.some((item) => typeof item !== 'number' ||
      !Number.isInteger(item) || item < 1) ||
      nonNegativeIntegers.some((item) => typeof item !== 'number' ||
        !Number.isInteger(item) || item < 0) ||
      recencyFactors.some((item) => typeof item !== 'number' ||
        !Number.isFinite(item) || item < 0 || item > 1)) {
    throw new Error('Prevention score thresholds or factors are invalid');
  }
}

export function loadScoreConfiguration(config: ConfigService): PreventionScoreConfiguration {
  const weights = Object.fromEntries(Object.entries(ENV_KEYS).map(([name, key]) => [
    name, numberValue(config, key, { integer: true, min: 0, max: 100 }),
  ])) as unknown as PreventionScoreConfiguration['weights'];
  const value: PreventionScoreConfiguration = {
    weights,
    severityFactors: {
      low: numberValue(config, 'PREVENTION_SCORE_SEVERITY_LOW_FACTOR', { min: 0, max: 1 }),
      medium: numberValue(config, 'PREVENTION_SCORE_SEVERITY_MEDIUM_FACTOR', { min: 0, max: 1 }),
      high: numberValue(config, 'PREVENTION_SCORE_SEVERITY_HIGH_FACTOR', { min: 0, max: 1 }),
    },
    frequencyTarget: numberValue(config, 'PREVENTION_SCORE_FREQUENCY_TARGET', { integer: true, min: 1 }),
    coverageTarget: numberValue(config, 'PREVENTION_SCORE_COVERAGE_TARGET', { integer: true, min: 1 }),
    recencyRecentDays: numberValue(config, 'PREVENTION_SCORE_RECENCY_RECENT_DAYS', { integer: true, min: 0 }),
    recencyCurrentDays: numberValue(config, 'PREVENTION_SCORE_RECENCY_CURRENT_DAYS', { integer: true, min: 1 }),
    recencyOlderDays: numberValue(config, 'PREVENTION_SCORE_RECENCY_OLDER_DAYS', { integer: true, min: 1 }),
    recencyCurrentFactor: numberValue(config, 'PREVENTION_SCORE_RECENCY_CURRENT_FACTOR', { min: 0, max: 1 }),
    recencyOlderFactor: numberValue(config, 'PREVENTION_SCORE_RECENCY_OLDER_FACTOR', { min: 0, max: 1 }),
    recencyStaleFactor: numberValue(config, 'PREVENTION_SCORE_RECENCY_STALE_FACTOR', { min: 0, max: 1 }),
    recurrenceTargetDays: numberValue(config, 'PREVENTION_SCORE_RECURRENCE_TARGET_DAYS', { integer: true, min: 1 }),
    trendWindowDays: numberValue(config, 'PREVENTION_SCORE_TREND_WINDOW_DAYS', { integer: true, min: 1 }),
    emergenceDays: numberValue(config, 'PREVENTION_SCORE_EMERGENCE_DAYS', { integer: true, min: 1 }),
    emergenceMinimumOccurrences: numberValue(config, 'PREVENTION_SCORE_EMERGENCE_MIN_OCCURRENCES', { integer: true, min: 1 }),
  };
  validateScoreConfiguration(value);
  return value;
}

export function scoreConfigurationFingerprint(value: PreventionScoreConfiguration): string {
  const canonical = {
    weights: {
      severity: value.weights.severity, frequency: value.weights.frequency,
      coverage: value.weights.coverage, recency: value.weights.recency,
      recurrence: value.weights.recurrence, trend: value.weights.trend,
      emergence: value.weights.emergence,
    },
    severityFactors: {
      low: value.severityFactors.low, medium: value.severityFactors.medium,
      high: value.severityFactors.high,
    },
    frequencyTarget: value.frequencyTarget,
    coverageTarget: value.coverageTarget,
    recencyRecentDays: value.recencyRecentDays,
    recencyCurrentDays: value.recencyCurrentDays,
    recencyOlderDays: value.recencyOlderDays,
    recencyCurrentFactor: value.recencyCurrentFactor,
    recencyOlderFactor: value.recencyOlderFactor,
    recencyStaleFactor: value.recencyStaleFactor,
    recurrenceTargetDays: value.recurrenceTargetDays,
    trendWindowDays: value.trendWindowDays,
    emergenceDays: value.emergenceDays,
    emergenceMinimumOccurrences: value.emergenceMinimumOccurrences,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

@Injectable()
export class PreventionScoreEnvironmentService {
  readonly configuration: PreventionScoreConfiguration;
  readonly fingerprint: string;

  constructor(config: ConfigService) {
    this.configuration = loadScoreConfiguration(config);
    this.fingerprint = scoreConfigurationFingerprint(this.configuration);
  }
}
