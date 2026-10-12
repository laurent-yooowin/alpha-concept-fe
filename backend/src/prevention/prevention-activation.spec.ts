import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { PreventionActivationGuard } from './prevention-activation.guard';
import { PreventionActivationService } from './prevention-activation.service';
import { PreventionOutboxService } from './outbox/prevention-outbox.service';
import { PreventionSchedulerService } from './scheduler/prevention-scheduler.service';
import { PREVENTION_DIFFERENTIAL_JOB } from './scheduler/prevention-scheduler.types';
import { PreventionBudgetService } from './budget/prevention-budget.service';
import { PREVENTION_BUDGET_BUILD_JOB } from './budget/prevention-budget.types';
import { OrganizationScopeGuard } from '../common/guards/organization-scope.guard';
import { UserRole } from '../user/user.entity';

test('organization scope guard never assigns the pilot organization implicitly', async () => {
  const guard = new OrganizationScopeGuard({
    getAllAndOverride: () => false,
  } as any);
  const request = { user: { role: UserRole.ADMIN, organizationId: null } };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;

  await assert.rejects(() => guard.canActivate(context), ForbiddenException);
  assert.equal(request.user.organizationId, null);
});

test('activation service distinguishes enabled and disabled organizations', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const service = new PreventionActivationService({
    query: async (sql: string, args: unknown[]) => {
      calls.push({ sql, args });
      return [{ isActive: args[0] === 'inactive' ? 0 : 1,
        preventionEnabled: args[0] === 'disabled' ? 0 : 1 }];
    },
  } as any);
  assert.equal(await service.isEnabled('enabled'), true);
  assert.equal(await service.isEnabled('disabled'), false);
  assert.equal(await service.isEnabled('inactive'), false);
  await assert.rejects(() => service.assertEnabled('disabled'), ForbiddenException);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.sql.includes('preventionEnabled') && call.sql.includes('isActive')));
});

test('activation guard rejects disabled tenant requests and allows the pilot', async () => {
  const guard = new PreventionActivationGuard({
    assertEnabled: async (organizationId: string) => {
      if (organizationId === 'disabled') throw new ForbiddenException();
    },
  } as any);
  const context = (organizationId: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ user: { organizationId } }) }),
  } as any);
  assert.equal(await guard.canActivate(context('enabled')), true);
  await assert.rejects(() => guard.canActivate(context('disabled')), ForbiddenException);
});

test('disabled tenant does not create new outbox events while enabled tenant does', async () => {
  const repository = {
    create: (value: any) => value,
    createQueryBuilder: () => ({
      insert: () => ({
        values: () => ({ execute: async () => undefined }),
      }),
    }),
    findOneByOrFail: async (value: any) => value,
  };
  const manager = { getRepository: () => repository } as any;
  const activation = { isEnabled: async (organizationId: string) => organizationId === 'enabled' };
  const outbox = new PreventionOutboxService(activation as any);
  assert.equal(await outbox.enqueueReportEvent(manager, {
    organizationId: 'disabled', reportId: 'report', eventType: 'REPORT_UPSERTED', aggregateVersion: 'v1',
  }), null);
  assert.ok(await outbox.enqueueReportEvent(manager, {
    organizationId: 'enabled', reportId: 'report', eventType: 'REPORT_UPSERTED', aggregateVersion: 'v1',
  }));
});

test('already queued scheduler and budget work become safe no-ops while disabled', async () => {
  let enqueued = false;
  const scheduler: any = Object.create(PreventionSchedulerService.prototype);
  scheduler.activation = { isEnabled: async () => false };
  scheduler.enqueueOrganizationScan = async () => { enqueued = true; };
  assert.equal(await scheduler.processOrganization(PREVENTION_DIFFERENTIAL_JOB, 'disabled', new Date().toISOString()), 0);
  assert.equal(enqueued, false);

  const budget: any = Object.create(PreventionBudgetService.prototype);
  budget.activation = { isEnabled: async () => false };
  budget.dataSource = { query: async () => { throw new Error('disabled tenant was read'); } };
  const result = await budget.process({
    name: PREVENTION_BUDGET_BUILD_JOB,
    data: {
      organizationId: '10000000-0000-4000-8000-000000000001',
      scenarioId: '20000000-0000-4000-8000-000000000001',
      scenarioVersion: 1,
      sourceVersion: 'source-v1',
    },
  } as any);
  assert.equal(result, 'SKIPPED_DISABLED');
});
