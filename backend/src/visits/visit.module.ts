import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Visit } from './visit.entity';
import { VisitService } from './visit.service';
import { VisitController } from './visit.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Visit])],
  controllers: [VisitController],
  providers: [VisitService],
  exports: [VisitService],
})
export class VisitModule {}
