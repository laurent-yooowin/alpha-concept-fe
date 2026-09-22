import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PreventionWorkerModule } from '../prevention/worker/prevention-worker.module';
import { winstonLogger } from '../config/winston-logger';

export async function bootstrapPreventionWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(PreventionWorkerModule, {
    logger: winstonLogger,
    bufferLogs: true,
  });
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
}

if (require.main === module) {
  void bootstrapPreventionWorker().catch(() => {
    process.exitCode = 1;
  });
}
