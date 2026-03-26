import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Visit } from './visit.entity';
import { VisitService } from './visit.service';
import { VisitController } from './visit.controller';
import { MissionModule } from '../missions/mission.module';
import { ReportModule } from '../reports/report.module';

@Module({
  imports: [
    forwardRef(() => MissionModule),
    forwardRef(() => ReportModule),
    TypeOrmModule.forFeature([Visit]),
  ],
  controllers: [VisitController],
  providers: [VisitService],
  exports: [VisitService],
})
export class VisitModule { }
