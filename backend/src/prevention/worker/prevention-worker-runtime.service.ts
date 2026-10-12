import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { PREVENTION_WORKER_REDIS } from './prevention-worker.constants';

export async function retryWorkerDependency(
  operation: () => Promise<unknown>,
  attempts: number,
  delayMs: number,
  wait: (delay: number) => Promise<void> = (delay) =>
    new Promise((resolve) => setTimeout(resolve, delay)),
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw lastError;
}

@Injectable()
export class PreventionWorkerRuntimeService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PreventionWorkerRuntimeService.name);
  private closed = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly heartbeatKey = 'prevention:observability:worker-heartbeat';

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(PREVENTION_WORKER_REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const attempts = this.positiveInteger('PREVENTION_WORKER_STARTUP_ATTEMPTS', 10);
    const delayMs = this.positiveInteger('PREVENTION_WORKER_STARTUP_DELAY_MS', 3_000);
    await retryWorkerDependency(
      async () => {
        await this.dataSource.query('SELECT 1');
        await this.redis.ping();
      },
      attempts,
      delayMs,
    );
    await this.writeHeartbeat();
    const heartbeatIntervalMs = this.boundedInteger(
      'PREVENTION_WORKER_HEARTBEAT_INTERVAL_MS', 10_000, 5_000, 60_000,
    );
    this.heartbeatTimer = setInterval(() => {
      void this.writeHeartbeat().catch(() => {
        this.logger.warn({
          message: 'Prevention worker heartbeat failed',
          context: PreventionWorkerRuntimeService.name,
          event: 'PREVENTION_WORKER_HEARTBEAT_FAILED',
        } as any);
      });
    }, heartbeatIntervalMs);
    this.heartbeatTimer.unref();
    this.logger.log('Prevention worker runtime ready');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    await this.redis.quit().catch(() => this.redis.disconnect(false));
  }

  private async writeHeartbeat(): Promise<void> {
    const ttlSeconds = this.boundedInteger(
      'PREVENTION_WORKER_HEARTBEAT_TTL_SECONDS', 300, 30, 600,
    );
    await this.redis.set(this.heartbeatKey, String(Date.now()), 'EX', ttlSeconds);
  }

  private positiveInteger(name: string, fallback: number): number {
    const value = Number(this.config.get(name, fallback));
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
  }

  private boundedInteger(name: string, fallback: number, min: number, max: number): number {
    const value = Number(this.config.get(name, fallback));
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return value;
  }
}
