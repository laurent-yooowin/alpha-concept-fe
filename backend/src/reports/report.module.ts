import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Report } from './report.entity';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { MissionService } from '../missions/mission.service';
import { MissionModule } from '../missions/mission.module';

@Module({
  imports: [MissionModule, TypeOrmModule.forFeature([Report])],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],

})
export class ReportModule { }
