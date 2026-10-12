import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_NO_ORG_KEY } from '../decorators/scope.decorators';
import { UserRole } from '../../user/user.entity';

/**
 * Defense-in-depth: requires every authenticated business request to have
 * an organizationId on the JWT user, except routes explicitly marked
 * with @AllowNoOrg() or accessed by a HYPER_ADMIN.
 *
 * Service-level filtering by organizationId remains the primary mechanism.
 */
@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

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
      throw new ForbiddenException(
        'Utilisateur sans organisation — accès refusé',
      );
    }
    return true;
  }
}
