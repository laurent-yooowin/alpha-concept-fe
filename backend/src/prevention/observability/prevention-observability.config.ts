import { ConfigService } from '@nestjs/config';

export interface PreventionObservabilityConfiguration {
  token: string;
  delayAlertSeconds: number;
  heartbeatStaleSeconds: number;
  workerHeartbeatKey: string;
  allowedIps: ReadonlySet<string>;
  cacheTtlMs: number;
  timeoutMs: number;
  minimumScrapeIntervalMs: number;
}

function boundedInteger(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(config.get(key, fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function loadPreventionObservabilityConfiguration(
  config: ConfigService,
): PreventionObservabilityConfiguration {
  const token = String(config.get('PREVENTION_OBSERVABILITY_TOKEN', '')).trim();
  if (token.length < 32 || token.length > 512) {
    throw new Error('PREVENTION_OBSERVABILITY_TOKEN must contain between 32 and 512 characters');
  }
  const allowedIps = String(config.get(
    'PREVENTION_OBSERVABILITY_ALLOWED_IPS', '127.0.0.1,::1,::ffff:127.0.0.1',
  )).split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowedIps.length || allowedIps.length > 32 || allowedIps.some((value) => value.length > 64)) {
    throw new Error('PREVENTION_OBSERVABILITY_ALLOWED_IPS must contain between 1 and 32 bounded addresses');
  }
  return {
    token,
    delayAlertSeconds: boundedInteger(config, 'PREVENTION_ALERT_DELAY_SECONDS', 900, 60, 86_400),
    heartbeatStaleSeconds: boundedInteger(config, 'PREVENTION_WORKER_HEARTBEAT_STALE_SECONDS', 120, 30, 3_600),
    workerHeartbeatKey: 'prevention:observability:worker-heartbeat',
    allowedIps: new Set(allowedIps),
    cacheTtlMs: boundedInteger(config, 'PREVENTION_OBSERVABILITY_CACHE_TTL_MS', 5_000, 1_000, 60_000),
    timeoutMs: boundedInteger(config, 'PREVENTION_OBSERVABILITY_TIMEOUT_MS', 3_000, 250, 10_000),
    minimumScrapeIntervalMs: boundedInteger(
      config, 'PREVENTION_OBSERVABILITY_MIN_SCRAPE_INTERVAL_MS', 1_000, 250, 60_000,
    ),
  };
}
