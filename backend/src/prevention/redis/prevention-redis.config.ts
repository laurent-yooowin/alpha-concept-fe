import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

export function createPreventionRedisOptions(config: ConfigService): RedisOptions {
  const password = config.get<string>('REDIS_PASSWORD') || undefined;
  if (config.get('NODE_ENV') === 'production' && !password) {
    throw new Error('REDIS_PASSWORD is required in production');
  }

  const port = Number(config.get('REDIS_PORT', 6379));
  const db = Number(config.get('REDIS_DB', 0));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_PORT must be a valid TCP port');
  }
  if (!Number.isInteger(db) || db < 0) {
    throw new Error('REDIS_DB must be a non-negative integer');
  }

  const options: RedisOptions = {
    host: config.get('REDIS_HOST', 'localhost'),
    port,
    password,
    db,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (config.get('REDIS_TLS', 'false') === 'true') {
    options.tls = {};
  }
  return options;
}
