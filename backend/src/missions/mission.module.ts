import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mission } from './mission.entity';
import { MissionAssignment } from './mission-assignment.entity';
import { MissionService } from './mission.service';
import { MissionController } from './mission.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule, TypeOrmModule.forFeature([Mission, MissionAssignment])],
  controllers: [MissionController],
  providers: [MissionService],
  exports: [MissionService],
})
export class MissionModule { }
