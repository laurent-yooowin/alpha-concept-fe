import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PreventionWorkerModule } from '../prevention/worker/prevention-worker.module';
import { createWinstonLogger } from '../config/winston-logger';

const workerLogger = createWinstonLogger('prevention-worker');

export async function bootstrapPreventionWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(PreventionWorkerModule, {
    logger: workerLogger,
    // A standalone application has no later HTTP bootstrap step that would
    // flush buffered logs. Keep startup diagnostics visible immediately.
    bufferLogs: false,
  });
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
}

if (require.main === module) {
  void bootstrapPreventionWorker().catch((error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    workerLogger.error('Prevention worker bootstrap failed', failure.stack, 'PreventionWorkerBootstrap');
    process.exitCode = 1;
  });
}
