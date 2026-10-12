import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { createPreventionRedisOptions } from '../prevention/redis/prevention-redis.config';

const HEARTBEAT_KEY = 'prevention:observability:worker-heartbeat';

export async function checkPreventionWorkerHealth(
  redis: Pick<Redis, 'get'>,
  staleSeconds: number,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isInteger(staleSeconds) || staleSeconds < 30 || staleSeconds > 3_600) return false;
  const value = await redis.get(HEARTBEAT_KEY);
  if (!value) return false;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= staleSeconds * 1_000;
}

async function main(): Promise<void> {
  const config = new ConfigService(process.env);
  const staleSeconds = Number(config.get('PREVENTION_WORKER_HEARTBEAT_STALE_SECONDS', 120));
  const redis = new Redis({ ...createPreventionRedisOptions(config), commandTimeout: 2_000 });
  try {
    if (!await checkPreventionWorkerHealth(redis, staleSeconds)) process.exitCode = 1;
  } catch {
    process.exitCode = 1;
  } finally {
    await redis.quit().catch(() => redis.disconnect(false));
  }
}

if (require.main === module) void main();
