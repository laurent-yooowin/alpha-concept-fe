import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mission } from './mission.entity';
import { MissionAssignment } from './mission-assignment.entity';
import { MissionService } from './mission.service';
import { MissionController } from './mission.controller';
import { UserModule } from '../user/user.module';
import { VisitModule } from '../visits/visit.module';
import { ReportModule } from '../reports/report.module';

@Module({
  imports: [UserModule, forwardRef(() => VisitModule), forwardRef(() => ReportModule), TypeOrmModule.forFeature([Mission, MissionAssignment])],
  controllers: [MissionController],
  providers: [MissionService],
  exports: [MissionService],
})
export class MissionModule { }
