import assert from 'node:assert/strict';
import test from 'node:test';
import { OrganizationController } from './organization.controller';

const org = '11111111-1111-4111-8111-111111111111';

test('Hyper Admin organization recovery controller delegates preview, confirmation and status contracts', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const controller = new OrganizationController(
    { findAll: async () => [{ id: org }] } as any,
    {
      preview: async (id: string) => { calls.push({ method: 'preview', args: [id] }); return { organizationId: id }; },
      confirm: async (...args: unknown[]) => { calls.push({ method: 'confirm', args }); return { runId: '22222222-2222-4222-8222-222222222222' }; },
      status: async (...args: unknown[]) => { calls.push({ method: 'status', args }); return { organizationId: args[0] }; },
      statuses: async (ids: string[]) => { calls.push({ method: 'statuses', args: [ids] }); return ids.map((id) => ({ organizationId: id })); },
    } as any,
  );

  assert.deepEqual(await controller.preventionRecoveryPreview(org), { organizationId: org });
  assert.deepEqual(await controller.preventionRecoveryConfirm(org, { confirmationToken: 'token', immediateRequested: true } as any, { id: '33333333-3333-4333-8333-333333333333' } as any), { runId: '22222222-2222-4222-8222-222222222222' });
  assert.deepEqual(await controller.preventionRecoveryStatus(org), { organizationId: org });
  assert.deepEqual(await controller.preventionRecoveryStatuses(), { items: [{ organizationId: org }] });
  assert.deepEqual(calls.map((call) => call.method), ['preview', 'confirm', 'status', 'statuses']);
  assert.deepEqual(calls[1].args, [org, 'token', true, '33333333-3333-4333-8333-333333333333']);
});
