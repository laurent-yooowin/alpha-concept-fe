import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PreventionScoreEnvironmentService, scoreConfigurationFingerprint, validateScoreConfiguration } from './prevention-score.config';
import { PreventionScoreConfiguration } from './prevention-score.types';
import { PreventionScoreConfigurationSource } from './prevention-statistics.enums';

export interface EffectiveScoreConfiguration {
  value: PreventionScoreConfiguration;
  source: PreventionScoreConfigurationSource;
  id: string | null;
  version: number | null;
  fingerprint: string;
}

@Injectable()
export class PreventionScoreConfigurationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly environment: PreventionScoreEnvironmentService,
  ) {}

  async effectiveFor(organizationId: string): Promise<EffectiveScoreConfiguration> {
    const [row]: Array<any> = await this.dataSource.query(
      `SELECT id, version, configurationFingerprint, weights, factors, thresholds
       FROM prevention_score_configurations
       WHERE organizationId = ? AND isActive = 1
       ORDER BY version DESC LIMIT 1`,
      [organizationId],
    );
    if (!row) return {
      value: this.environment.configuration,
      source: PreventionScoreConfigurationSource.ENVIRONMENT,
      id: null,
      version: null,
      fingerprint: this.environment.fingerprint,
    };
    const parse = (value: unknown): Record<string, number> =>
      typeof value === 'string' ? JSON.parse(value) : value as Record<string, number>;
    const weights = parse(row.weights);
    const factors = parse(row.factors);
    const thresholds = parse(row.thresholds);
    const assertKeys = (record: Record<string, number>, expected: string[], label: string) => {
      if (!record || typeof record !== 'object' || Array.isArray(record) ||
          Object.keys(record).sort().join('|') !== [...expected].sort().join('|')) {
        throw new Error(`Prevention administrator ${label} is invalid`);
      }
    };
    assertKeys(weights, ['severity', 'frequency', 'coverage', 'recency',
      'recurrence', 'trend', 'emergence'], 'weights');
    assertKeys(factors, ['severityLow', 'severityMedium', 'severityHigh',
      'recencyCurrent', 'recencyOlder', 'recencyStale'], 'factors');
    assertKeys(thresholds, ['frequencyTarget', 'coverageTarget', 'recencyRecentDays',
      'recencyCurrentDays', 'recencyOlderDays', 'recurrenceTargetDays',
      'trendWindowDays', 'emergenceDays', 'emergenceMinimumOccurrences'], 'thresholds');
    const value: PreventionScoreConfiguration = {
      weights: weights as unknown as PreventionScoreConfiguration['weights'],
      severityFactors: {
        low: factors.severityLow, medium: factors.severityMedium, high: factors.severityHigh,
      },
      frequencyTarget: thresholds.frequencyTarget,
      coverageTarget: thresholds.coverageTarget,
      recencyRecentDays: thresholds.recencyRecentDays,
      recencyCurrentDays: thresholds.recencyCurrentDays,
      recencyOlderDays: thresholds.recencyOlderDays,
      recencyCurrentFactor: factors.recencyCurrent,
      recencyOlderFactor: factors.recencyOlder,
      recencyStaleFactor: factors.recencyStale,
      recurrenceTargetDays: thresholds.recurrenceTargetDays,
      trendWindowDays: thresholds.trendWindowDays,
      emergenceDays: thresholds.emergenceDays,
      emergenceMinimumOccurrences: thresholds.emergenceMinimumOccurrences,
    };
    validateScoreConfiguration(value);
    const fingerprint = scoreConfigurationFingerprint(value);
    if (fingerprint !== row.configurationFingerprint) {
      throw new Error('Prevention score configuration fingerprint mismatch');
    }
    return {
      value, source: PreventionScoreConfigurationSource.ADMIN,
      id: row.id, version: Number(row.version), fingerprint,
    };
  }
}
