import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UserRole } from '../../user/user.entity';
import { PreventionApiController } from './prevention-api.controller';
import { PreventionPhaseValidationController } from './prevention-phase-validation.controller';

const guard = new PermissionsGuard(new Reflector());

function context(controller: any, method: string, user: object): any {
  return {
    getClass: () => controller,
    getHandler: () => controller.prototype[method],
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
}

test('read-only visit user can inspect status but cannot validate a phase', async () => {
  const user = { role: UserRole.USER, permissions: { visits: 'read' } };
  assert.equal(await guard.canActivate(context(PreventionPhaseValidationController, 'status', user)), true);
  assert.equal(await guard.canActivate(context(PreventionPhaseValidationController, 'catalog', user)), true);
  await assert.rejects(
    guard.canActivate(context(PreventionPhaseValidationController, 'validate', user)),
    ForbiddenException,
  );
});

test('admin with read-only permissions cannot trigger backfill, rebuild or mutate budgets', async () => {
  const user = { role: UserRole.ADMIN, permissions: { visits: 'read', reports: 'read' } };
  assert.equal(await guard.canActivate(context(PreventionApiController, 'dashboard', user)), true);
  assert.equal(await guard.canActivate(context(PreventionApiController, 'budgetsList', user)), true);
  for (const [controller, method] of [
    [PreventionPhaseValidationController, 'backfill'],
    [PreventionApiController, 'rebuild'],
    [PreventionApiController, 'budgetsCreate'],
    [PreventionApiController, 'calculateBudgetScope'],
    [PreventionApiController, 'catalogCreate'],
    [PreventionApiController, 'catalogCreateAlias'],
    [PreventionApiController, 'catalogStatus'],
    [PreventionApiController, 'catalogStatusAlias'],
    [PreventionApiController, 'budgetPatch'],
    [PreventionApiController, 'budgetRecalculate'],
    [PreventionApiController, 'budgetItemPatch'],
  ] as const) {
    await assert.rejects(guard.canActivate(context(controller, method, user)), ForbiddenException, method);
  }
});
