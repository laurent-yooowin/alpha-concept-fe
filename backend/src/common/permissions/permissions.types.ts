export type PermissionModule = 'missions' | 'visits' | 'reports' | 'clients' | 'users';
export type PermissionLevel = 'none' | 'read' | 'write';

export type UserPermissions = Partial<Record<PermissionModule, PermissionLevel>>;

export const ALL_MODULES: PermissionModule[] = [
  'missions',
  'visits',
  'reports',
  'clients',
  'users',
];

/**
 * Predefined presets used by the hyper-admin / admin UIs.
 */
export const PERMISSION_PRESETS: Record<string, UserPermissions> = {
  ADMIN_FULL: {
    missions: 'write',
    visits: 'write',
    reports: 'write',
    clients: 'write',
    users: 'write',
  },
  COORDINATOR: {
    missions: 'write',
    visits: 'write',
    reports: 'write',
    clients: 'read',
    users: 'none',
  },
  READ_ONLY: {
    missions: 'read',
    visits: 'read',
    reports: 'read',
    clients: 'read',
    users: 'none',
  },
};

const RANK: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2 };

export function levelMeets(actual: PermissionLevel | undefined, required: PermissionLevel): boolean {
  if (!actual) return false;
  return RANK[actual] >= RANK[required];
}
