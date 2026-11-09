import { SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Organization } from '../organizations/organization.entity';
import { User, UserRole } from '../user/user.entity';

export const ALLOW_PENDING_LEGAL_VALIDATION = 'allowPendingLegalValidation';
export const pendingLegalValidation = Symbol('pendingLegalValidation');

export const AllowPendingLegalValidation = () =>
  SetMetadata(ALLOW_PENDING_LEGAL_VALIDATION, true);

export function assertOrganizationAccess(
  user: Pick<User, 'role' | 'organizationId'>,
  organization: Pick<Organization, 'isActive' | 'legalValidationStatus'> | null,
): boolean {
  if (user.role === UserRole.HYPER_ADMIN) return false;
  if (!user.organizationId || !organization || !organization.isActive) {
    throw new UnauthorizedException('Organisation introuvable ou inactive');
  }
  if (organization.legalValidationStatus !== 'termine') {
    if (user.role !== UserRole.ADMIN) {
      throw new UnauthorizedException({
        code: 'ORG_LEGAL_VALIDATION_PENDING',
        message: "L'organisation doit valider ses CGU avant la connexion",
      });
    }
    return true;
  }
  return false;
}
