import { SetMetadata } from '@nestjs/common';
import { PermissionLevel, PermissionModule } from '../permissions/permissions.types';

export const PERMISSION_META = 'required_permission';

export interface RequiredPermission {
  module: PermissionModule;
  level: PermissionLevel;
}

export const RequirePermission = (module: PermissionModule, level: PermissionLevel) =>
  SetMetadata(PERMISSION_META, { module, level } as RequiredPermission);
