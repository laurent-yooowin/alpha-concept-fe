import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Returns the active organizationId for the current request.
 * For HYPER_ADMIN, returns null (global scope) unless ?organizationId= is passed
 * in the query string, in which case it acts as the active org.
 *
 * For ADMIN/USER, returns the organizationId attached to their user.
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return null;

    // HYPER_ADMIN can target a specific org via ?organizationId=
    if (user.role === 'ROLE_HYPER_ADMIN') {
      return req.query?.organizationId || null;
    }

    return user.organizationId || null;
  },
);
