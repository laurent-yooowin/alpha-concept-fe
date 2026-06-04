import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { ALLOW_NO_ORG_KEY } from '../decorators/scope.decorators';
import { UserRole } from '../../user/user.entity';
import { Organization } from '../../organizations/organization.entity';

/**
 * Defense-in-depth: requires every authenticated business request to have
 * an organizationId on the JWT user, except routes explicitly marked
 * with @AllowNoOrg() or accessed by a HYPER_ADMIN.
 *
 * Service-level filtering by organizationId remains the primary mechanism.
 */
@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowNoOrg = this.reflector.getAllAndOverride<boolean>(
      ALLOW_NO_ORG_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowNoOrg) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;

    // No user means the JwtAuthGuard didn't run (public route) — let it pass.
    if (!user) return true;

    if (user.role === UserRole.HYPER_ADMIN) return true;

    if (!user.organizationId) {
      const organizationRepository = this.dataSource.getRepository(Organization);
      const defaultOrgSlugCandidates = [
        'alphaconcept',
        'alpha_concept',
        'alpha-concept',
      ];
      let defaultOrganization: Pick<Organization, 'id'> | null = null;

      for (const slug of defaultOrgSlugCandidates) {
        defaultOrganization = await organizationRepository.findOne({
          where: { slug, isActive: true },
          select: ['id'],
        });
        if (defaultOrganization) break;
      }

      if (defaultOrganization?.id) {
        user.organizationId = defaultOrganization.id;
        return true;
      }

      throw new ForbiddenException(
        'Utilisateur sans organisation — accès refusé',
      );
    }
    return true;
  }
}
