import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HyperAdminController } from './hyper-admin.controller';
import { HyperAdminService } from './hyper-admin.service';
import { Organization } from '../organizations/organization.entity';
import { User } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';
import { Report } from '../reports/report.entity';
import { Client } from '../clients/client.entity';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, User, Mission, Visit, Report, Client]),
    UserModule,
  ],
  controllers: [HyperAdminController],
  providers: [HyperAdminService],
})
export class HyperAdminModule {}
