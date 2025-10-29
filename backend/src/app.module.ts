import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { databaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { MissionModule } from './missions/mission.module';
import { VisitModule } from './visits/visit.module';
import { ReportModule } from './reports/report.module';
import { UploadModule } from './upload/upload.module';
import { AiModule } from './ai/ai.module';
import { ActivityLogModule } from './activity-logs/activity-log.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    AuthModule,
    UserModule,
    MissionModule,
    VisitModule,
    ReportModule,
    UploadModule,
    AiModule,
    ActivityLogModule,
    DashboardModule,
  ],
})
export class AppModule {}
