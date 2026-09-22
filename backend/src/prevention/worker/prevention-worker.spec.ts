import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import {
  PreventionWorkerRuntimeService,
  retryWorkerDependency,
} from './prevention-worker-runtime.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('worker dependency retry is bounded and eventually succeeds', async () => {
  let calls = 0;
  const waits: number[] = [];
  await retryWorkerDependency(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('not ready');
    },
    3,
    25,
    async (delay) => { waits.push(delay); },
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [25, 25]);
});

test('production Redis configuration requires authentication', () => {
  const config = new ConfigService({ NODE_ENV: 'production', REDIS_PORT: '6379', REDIS_DB: '0' });
  assert.throws(() => createPreventionRedisOptions(config), /REDIS_PASSWORD/);
});

test('shared Redis configuration validates numeric options', () => {
  const config = new ConfigService({ REDIS_PORT: 'invalid', REDIS_DB: '0' });
  assert.throws(() => createPreventionRedisOptions(config), /REDIS_PORT/);
});

test('worker shutdown closes its Redis connection only once', async () => {
  let quits = 0;
  const redis = { quit: async () => { quits += 1; } };
  const runtime = new PreventionWorkerRuntimeService(
    {} as any,
    new ConfigService(),
    redis as any,
  );
  await runtime.onApplicationShutdown();
  await runtime.onApplicationShutdown();
  assert.equal(quits, 1);
});

test('worker bootstrap stays outside the HTTP application', () => {
  const moduleSource = readFileSync(
    resolve(process.cwd(), 'src/prevention/worker/prevention-worker.module.ts'),
    'utf8',
  );
  const bootstrapSource = readFileSync(
    resolve(process.cwd(), 'src/workers/prevention.worker.ts'),
    'utf8',
  );
  assert.doesNotMatch(moduleSource, /AppModule|controllers\s*:/);
  assert.match(bootstrapSource, /createApplicationContext/);
  assert.doesNotMatch(bootstrapSource, /\.listen\s*\(|create\s*\(AppModule/);
});
