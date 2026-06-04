import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { UploadModule } from '../upload/upload.module';
import { MailingListModule } from '../mailing-list/mailing-list.module';

@Module({
  imports: [UploadModule, MailingListModule],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})

export class MailModule { }
