import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { createWinstonLogger } from './config/winston-logger';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const apiLogger = createWinstonLogger('api');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: apiLogger,
    bufferLogs: true,
    bodyParser: false,
  });

  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  const port = process.env.PORT || 8089;
  await app.listen(port);

  apiLogger.log(`Server is running on: http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap().catch((error: unknown) => {
  const failure = error instanceof Error ? error : new Error(String(error));
  apiLogger.error('Backend API bootstrap failed', failure.stack, 'ApiBootstrap');
  process.exitCode = 1;
});
