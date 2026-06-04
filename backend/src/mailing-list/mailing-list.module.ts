import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailingListEntry } from './mailing-list.entity';
import { MailingListService } from './mailing-list.service';
import { MailingListController } from './mailing-list.controller';
import { Mission } from '../missions/mission.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MailingListEntry, Mission])],
  controllers: [MailingListController],
  providers: [MailingListService],
  exports: [MailingListService],
})
export class MailingListModule {}
