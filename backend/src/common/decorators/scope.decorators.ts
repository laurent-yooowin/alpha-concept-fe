import { SetMetadata } from '@nestjs/common';

export const HYPER_ADMIN_ONLY_KEY = 'hyperAdminOnly';
export const HyperAdminOnly = () => SetMetadata(HYPER_ADMIN_ONLY_KEY, true);

export const ALLOW_NO_ORG_KEY = 'allowNoOrg';
/**
 * Mark a route as not requiring an organizationId on the current user.
 * Use for /auth/*, /public/*, /healthcheck, /hyper-admin/*.
 */
export const AllowNoOrg = () => SetMetadata(ALLOW_NO_ORG_KEY, true);
