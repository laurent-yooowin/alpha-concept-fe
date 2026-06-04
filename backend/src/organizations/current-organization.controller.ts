import { Body, Controller, ForbiddenException, Get, NotFoundException, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../user/user.entity';
import { OrganizationService } from './organization.service';
import { UpdateOrganizationDto, ValidateLegalDocumentsDto } from './organization.dto';

/**
 * Returns the current authenticated user's organization (with signed logo URL).
 * Hyper-admins have no organization and will receive null.
 */
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class CurrentOrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  private async serializeCurrentOrganization(organizationId: string) {
    const org = await this.orgService.findOne(organizationId).catch(() => null);
    if (!org) throw new NotFoundException('Organisation introuvable');
    const logoUrl = await this.orgService.getLogoUrl(org);
    const backgroundImageUrl = await this.orgService.getBackgroundImageUrl(org);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl,
      backgroundImageUrl,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      cguContent: org.cguContent,
      privacyContent: org.privacyContent,
      loginTitle: org.loginTitle,
      loginContent: org.loginContent,
      legalValidationStatus: org.legalValidationStatus,
      legalValidationRequestedAt: org.legalValidationRequestedAt,
      legalValidationValidatedAt: org.legalValidationValidatedAt,
    };
  }

  @Get('current')
  async getCurrent(@CurrentUser() user: User) {
    if (!user?.organizationId) return null;
    return this.serializeCurrentOrganization(user.organizationId);
  }

  @Patch('current')
  async updateCurrent(
    @CurrentUser() user: User,
    @Body() dto: Pick<UpdateOrganizationDto, 'cguContent' | 'privacyContent'>,
  ) {
    if (!user?.organizationId) return null;
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      throw new ForbiddenException('Seul un administrateur peut modifier ces contenus');
    }
    await this.orgService.update(user.organizationId, {
      cguContent: dto.cguContent,
      privacyContent: dto.privacyContent,
    }, user);
    return this.serializeCurrentOrganization(user.organizationId);
  }

  @Patch('current/legal-validation')
  async validateLegalDocuments(
    @CurrentUser() user: User,
    @Body() dto: ValidateLegalDocumentsDto,
  ) {
    if (!user?.organizationId) return null;
    await this.orgService.validateLegalDocuments(user.organizationId, user, dto);
    return this.serializeCurrentOrganization(user.organizationId);
  }
}
