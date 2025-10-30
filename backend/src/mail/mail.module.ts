import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { Mission } from '../missions/mission.entity';
// import { Report } from '../reports/report.entity';
// import { User } from '../user/user.entity';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
// import { MailerModule } from '@nestjs-modules/mailer';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [UploadModule],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})

export class MailModule { }
