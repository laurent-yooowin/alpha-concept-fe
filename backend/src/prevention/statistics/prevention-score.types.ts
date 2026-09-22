export interface PreventionScoreWeights {
  severity: number;
  frequency: number;
  coverage: number;
  recency: number;
  recurrence: number;
  trend: number;
  emergence: number;
}

export interface PreventionScoreConfiguration {
  weights: PreventionScoreWeights;
  severityFactors: { low: number; medium: number; high: number };
  frequencyTarget: number;
  coverageTarget: number;
  recencyRecentDays: number;
  recencyCurrentDays: number;
  recencyOlderDays: number;
  recencyCurrentFactor: number;
  recencyOlderFactor: number;
  recencyStaleFactor: number;
  recurrenceTargetDays: number;
  trendWindowDays: number;
  emergenceDays: number;
  emergenceMinimumOccurrences: number;
}

export interface PreventionScoreInput {
  riskLevel: 'faible' | 'moyen' | 'eleve';
  occurrenceCount: number;
  missionCount: number;
  distinctDayCount: number;
  firstOccurrence: string;
  lastOccurrence: string;
  recentWindowCount: number;
  previousWindowCount: number;
  referenceDate: string;
}

export interface PreventionScoreResult {
  score: number;
  components: PreventionScoreWeights;
}
