import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PERMISSION_META, RequiredPermission } from '../decorators/permissions.decorator';
import { UserRole } from '../../user/user.entity';
import {
  PERMISSION_PRESETS,
  PermissionLevel,
  PermissionModule,
  UserPermissions,
  levelMeets,
} from '../permissions/permissions.types';

/**
 * Defaults applied when a user has no explicit `permissions` JSON.
 * Keeps backward compatibility: ADMIN = full write, USER = coordinator-style.
 */
function defaultPermissionsFor(role: UserRole): UserPermissions {
  if (role === UserRole.ADMIN) return PERMISSION_PRESETS.ADMIN_FULL;
  if (role === UserRole.USER) return PERMISSION_PRESETS.COORDINATOR;
  return {};
}

export function effectivePermission(user: any, module: PermissionModule): PermissionLevel {
  if (!user) return 'none';
  if (user.role === UserRole.HYPER_ADMIN) return 'write';
  // An explicit permissions object is authoritative. A partial object is
  // intentionally restrictive: omitted modules are `none`, never a role
  // preset, so an administrator cannot accidentally regain access through a
  // stale default after custom permissions were assigned.
  if (user.permissions !== null && user.permissions !== undefined) {
    const explicit = typeof user.permissions === 'string'
      ? (() => { try { return JSON.parse(user.permissions); } catch { return {}; } })()
      : user.permissions;
    const value = explicit && typeof explicit === 'object' ? explicit[module] : undefined;
    return value === 'none' || value === 'read' || value === 'write' ? value : 'none';
  }
  const source = defaultPermissionsFor(user.role);
  return (source[module] as PermissionLevel) || 'none';
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly jwtAuthGuard = new JwtAuthGuard();

  constructor(private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission>(PERMISSION_META, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    let { user } = ctx.switchToHttp().getRequest();
    // Global guards run before route-level guards, so JwtAuthGuard may not
    // have populated `req.user` yet. Run JWT auth on-demand so permission
    // checks always have an authenticated user when required.
    if (!user) {
      try {
        await this.jwtAuthGuard.canActivate(ctx);
        user = ctx.switchToHttp().getRequest().user;
      } catch (e) {
        throw new ForbiddenException('Non authentifié');
      }
    }
    if (!user) throw new ForbiddenException('Non authentifié');
    if (user.role === UserRole.HYPER_ADMIN) return true;

    const actual = effectivePermission(user, required.module);
    if (!levelMeets(actual, required.level)) {
      throw new ForbiddenException(
        `Permission insuffisante (${required.module}: ${required.level} requis)`,
      );
    }
    return true;
  }
}
