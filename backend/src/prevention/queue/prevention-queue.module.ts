import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { PreventionOutboxEvent } from '../outbox/prevention-outbox.entity';
import { PreventionOutboxService } from '../outbox/prevention-outbox.service';
import { PREVENTION_QUEUE, PREVENTION_REDIS } from './prevention-queue.constants';
import { PREVENTION_QUEUE_NAME } from '../outbox/prevention-outbox.types';
import { PreventionQueueService } from './prevention-queue.service';
import { createPreventionRedisOptions } from '../redis/prevention-redis.config';

@Module({})
export class PreventionQueueModule {
  static register(): DynamicModule {
    return {
      module: PreventionQueueModule,
      imports: [ConfigModule, TypeOrmModule.forFeature([PreventionOutboxEvent])],
      providers: [
        {
          provide: PREVENTION_REDIS,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => new Redis(createPreventionRedisOptions(config)),
        },
        {
          provide: PREVENTION_QUEUE,
          inject: [PREVENTION_REDIS],
          useFactory: (redis: Redis) => new Queue(PREVENTION_QUEUE_NAME, { connection: redis }),
        },
        PreventionOutboxService,
        PreventionQueueService,
      ],
      exports: [PreventionOutboxService, PreventionQueueService],
    };
  }
}
