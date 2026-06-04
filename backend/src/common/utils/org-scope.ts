import { User, UserRole } from '../../user/user.entity';

/**
 * Build a where clause that scopes data to the user's organization,
 * unless the user is HYPER_ADMIN (cross-tenant access).
 *
 * For ROLE_USER you usually combine it with `userId: user.id`.
 */
export function orgScope(user: User, extra: Record<string, any> = {}): Record<string, any> {
  if (user.role === UserRole.HYPER_ADMIN) return { ...extra };
  return { ...extra, organizationId: user.organizationId };
}
