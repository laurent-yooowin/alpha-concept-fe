import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { databaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { MissionModule } from './missions/mission.module';
import { VisitModule } from './visits/visit.module';
import { ReportModule } from './reports/report.module';
import { UploadModule } from './upload/upload.module';
import { AiModule } from './ai/ai.module';
import { ActivityLogModule } from './activity-logs/activity-log.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MailModule } from './mail/mail.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { HealthcheckModule } from './healthcheck/healthcheck.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MailerModule.forRoot({
      transport: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,          // ❗ false pour STARTTLS
        requireTLS: true,       // ❗ force le chiffrement TLS (comme "encryption=tls")
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          minVersion: 'TLSv1.2',  // bonne pratique
          rejectUnauthorized: true,
        },
      },
      defaults: {
        from: '"Rapports Automatiques" <noreply@tondomaine.com>',
      },
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    AuthModule,
    UserModule,
    MissionModule,
    VisitModule,
    ReportModule,
    UploadModule,
    AiModule,
    ActivityLogModule,
    DashboardModule,
    MailModule,
    HealthcheckModule,
  ],
})
export class AppModule { }
