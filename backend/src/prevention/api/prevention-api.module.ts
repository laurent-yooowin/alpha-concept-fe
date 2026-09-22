import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PreventionApiController } from './prevention-api.controller';
import { PreventionApiService } from './prevention-api.service';
import { PreventionRebuildQueueService } from './prevention-rebuild-queue.service';

@Module({ imports: [ConfigModule], controllers: [PreventionApiController], providers: [PreventionApiService, PreventionRebuildQueueService] })
export class PreventionApiModule {}
