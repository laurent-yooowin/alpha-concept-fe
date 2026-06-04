import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './organization.entity';
import { OrganizationService } from './organization.service';
import { OrganizationController } from './organization.controller';
import { PublicOrganizationController } from './public-organization.controller';
import { CurrentOrganizationController } from './current-organization.controller';
import { UserModule } from '../user/user.module';
import { UploadModule } from '../upload/upload.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization]),
    UserModule,
    UploadModule,
    MailModule,
  ],
  controllers: [OrganizationController, PublicOrganizationController, CurrentOrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
