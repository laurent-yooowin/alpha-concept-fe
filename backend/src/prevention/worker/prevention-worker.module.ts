import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { databaseConfig } from '../../config/database.config';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';
import { PREVENTION_WORKER_REDIS } from './prevention-worker.constants';
import { PreventionWorkerRuntimeService } from './prevention-worker-runtime.service';
import { PreventionExtractionService } from '../extraction/prevention-extraction.service';
import { PreventionReportConsumerService } from './prevention-report-consumer.service';
import { PreventionStatisticsService } from '../statistics/prevention-statistics.service';
import { PreventionScoreConfigurationService } from '../statistics/prevention-score-configuration.service';
import { PreventionScoreEnvironmentService } from '../statistics/prevention-score.config';
import { PreventionSchedulerService } from '../scheduler/prevention-scheduler.service';
import { PreventionBudgetService } from '../budget/prevention-budget.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRoot({ ...databaseConfig(), logging: false }),
  ],
  providers: [
    {
      provide: PREVENTION_WORKER_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const commandTimeout = Number(config.get('PREVENTION_WORKER_REDIS_TIMEOUT_MS', 5_000));
        if (!Number.isInteger(commandTimeout) || commandTimeout < 1) {
          throw new Error('PREVENTION_WORKER_REDIS_TIMEOUT_MS must be a positive integer');
        }
        return new Redis({ ...createPreventionRedisOptions(config), commandTimeout });
      },
    },
    PreventionWorkerRuntimeService,
    PreventionExtractionService,
    PreventionScoreEnvironmentService,
    PreventionScoreConfigurationService,
    PreventionStatisticsService,
    PreventionSchedulerService,
    PreventionBudgetService,
    PreventionReportConsumerService,
  ],
})
export class PreventionWorkerModule {}
