import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { OrganizationService } from './organization.service';

/**
 * Public endpoint used by the custom login portals (e.g. /login/edf).
 * Returns only public branding fields, no secret data.
 */
@Controller('public/organizations')
export class PublicOrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  @Get('by-slug/:slug')
  async getBySlug(@Param('slug') slug: string) {
    const org = await this.orgService.findBySlug(slug);
    if (!org || !org.isActive) {
      throw new NotFoundException('Organisation introuvable');
    }
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
    };
  }
}
