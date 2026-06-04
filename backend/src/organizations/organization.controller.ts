import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/user.entity';
import { OrganizationService } from './organization.service';
import {
  CreateOrganizationDto,
  UpdateReportBtpLegalDocsDto,
  UpdateOrganizationDto,
} from './organization.dto';

import { AllowNoOrg } from '../common/decorators/scope.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../user/user.entity';

@Controller('hyper-admin/organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.HYPER_ADMIN)
@AllowNoOrg()
export class OrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  @Get()
  async findAll() {
    const orgs = await this.orgService.findAll();
    return Promise.all(
      orgs.map(async (o) => ({
        ...o,
        logoUrl: await this.orgService.getLogoUrl(o),
        backgroundImageUrl: await this.orgService.getBackgroundImageUrl(o),
      })),
    );
  }

  @Get('reportbtp/legal-docs')
  getReportBtpLegalDocs() {
    return this.orgService.getReportBtpLegalDocs();
  }

  @Patch('reportbtp/legal-docs')
  updateReportBtpLegalDocs(@Body() dto: UpdateReportBtpLegalDocsDto) {
    return this.orgService.updateReportBtpLegalDocs(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const org = await this.orgService.findOne(id);
    const logoUrl = await this.orgService.getLogoUrl(org);
    const backgroundImageUrl = await this.orgService.getBackgroundImageUrl(org);
    return { ...org, logoUrl, backgroundImageUrl };
  }

  @Post()
  create(@Body() dto: CreateOrganizationDto, @CurrentUser() user: User) {
    return this.orgService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto, @CurrentUser() user: User) {
    return this.orgService.update(id, dto, user);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.orgService.remove(id);
    return { success: true };
  }

  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file'))
  uploadLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.orgService.setLogo(id, file);
  }

  @Post(':id/background')
  @UseInterceptors(FileInterceptor('file'))
  uploadBackground(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.orgService.setBackgroundImage(id, file);
  }
}
