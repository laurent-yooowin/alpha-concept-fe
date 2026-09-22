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
    this.logger.log('Prevention worker runtime ready');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.redis.quit().catch(() => this.redis.disconnect(false));
  }

  private positiveInteger(name: string, fallback: number): number {
    const value = Number(this.config.get(name, fallback));
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
  }
}
