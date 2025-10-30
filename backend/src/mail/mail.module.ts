import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mission } from '../missions/mission.entity';
import { Report } from '../reports/report.entity';
import { User } from '../user/user.entity';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailerModule } from '@nestjs-modules/mailer';

@Module({
  imports: [MailerModule.forRoot({
    transport: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER, // ton email
        pass: process.env.SMTP_PASS, // mot de passe ou app password
      },
    },
    defaults: {
      from: '"Rapports Automatiques" <noreply@tondomaine.com>',
    },
  }),],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})

export class MailModule { }
