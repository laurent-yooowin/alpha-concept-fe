import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { OrganizationService } from '../organizations/organization.service';
import { PreventionOrganizationActivationService, stagePreventionOrganizationActivation } from './prevention-organization-activation.service';
import { PREVENTION_DIFFERENTIAL_JOB, PREVENTION_ORGANIZATION_SCAN_JOB } from './scheduler/prevention-scheduler.types';

const organizationId = '519e5508-04b7-41a9-a533-6a0c73657e1f';

function fakeSource(active: boolean, enabled: boolean) {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const manager = { query: async (sql: string, parameters: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.startsWith('SELECT isActive,preventionEnabled')) {
      return [{ isActive: active ? 1 : 0, preventionEnabled: enabled ? 1 : 0 }];
    }
    return { affectedRows: 1 };
  } };
  const source = { transaction: async (work: (manager: any) => Promise<unknown>) => work(manager) };
  return { source, calls };
}

test('inactive or invalid tenants never stage activation work', async () => {
  const { source, calls } = fakeSource(false, false);
  await assert.rejects(() => stagePreventionOrganizationActivation(source as any, organizationId), ConflictException);
  await assert.rejects(() => stagePreventionOrganizationActivation(source as any, "invalid' OR 1=1"), ConflictException);
  assert.equal(calls.length, 1);
  assert.equal(calls.some(({ sql }) => sql.startsWith('INSERT') || sql.startsWith('UPDATE')), false);
});

test('activation creates only one tenant-scoped differential checkpoint and enables that tenant', async () => {
  const { source, calls } = fakeSource(true, false);
  const scan = await stagePreventionOrganizationActivation(source as any, organizationId,
    new Date('2026-10-07T12:00:00.000Z'));
  assert.equal(scan?.organizationId, organizationId);
  assert.equal(scan?.scheduledFor, '2026-10-07T12:00:00.000Z');
  assert.equal(calls.length, 4);
  assert.match(calls[1].sql, /INSERT INTO prevention_scheduler_runs/);
  assert.match(calls[1].sql, /'ACTIVATION'/);
  assert.equal(calls[1].parameters[1], PREVENTION_DIFFERENTIAL_JOB);
  assert.equal(calls[1].parameters[2], '2026-10-07 12:00:00.000000');
  assert.match(calls[2].sql, /INSERT INTO prevention_scheduler_checkpoints/);
  assert.equal(calls[2].parameters[2], organizationId);
  assert.match(calls[3].sql, /WHERE id=\? AND isActive=1 AND preventionEnabled=0/);
  assert.deepEqual(calls[3].parameters, [organizationId]);
});

test('already enabled tenant is idempotent and produces no second run', async () => {
  const { source, calls } = fakeSource(true, true);
  assert.equal(await stagePreventionOrganizationActivation(source as any, organizationId), null);
  assert.equal(calls.length, 1);
});

test('reactivated tenant with Prevention already enabled still gets a differential scan', async () => {
  const { source, calls } = fakeSource(true, true);
  const scan = await stagePreventionOrganizationActivation(source as any, organizationId,
    new Date('2026-10-07T12:00:00.000Z'), true);
  assert.equal(scan?.organizationId, organizationId);
  assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO prevention_scheduler_checkpoints')).length, 1);
});

test('committed activation enqueues only a tenant-scoped differential job', async () => {
  const { source } = fakeSource(true, false);
  const queued: Array<{ name: string; payload: any; options: any }> = [];
  const activation: any = Object.create(PreventionOrganizationActivationService.prototype);
  activation.dataSource = source;
  activation.queue = { add: async (name: string, payload: any, options: any) => {
    queued.push({ name, payload, options });
  } };
  activation.logger = { warn: () => assert.fail('queue should be available') };
  await activation.activate(organizationId);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].name, PREVENTION_ORGANIZATION_SCAN_JOB);
  assert.equal(queued[0].payload.organizationId, organizationId);
  assert.equal(queued[0].payload.parentJobType, PREVENTION_DIFFERENTIAL_JOB);
  assert.equal(queued[0].payload.reportCursor, null);
  assert.equal('runId' in queued[0].payload, false);
  assert.match(queued[0].options.jobId, /^prevention-scheduler-org-[0-9a-f]{64}$/);
});

test('queue outage leaves the committed checkpoint for worker recovery', async () => {
  const { source, calls } = fakeSource(true, false);
  const activation: any = Object.create(PreventionOrganizationActivationService.prototype);
  activation.dataSource = source;
  activation.queue = { add: async () => { throw new Error('Redis unavailable'); } };
  let warned = false;
  activation.logger = { warn: () => { warned = true; } };
  await activation.activate(organizationId);
  assert.equal(warned, true);
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO prevention_scheduler_checkpoints')), true);
});

test('only inactive-to-active organization update triggers activation', async () => {
  async function update(previouslyActive: boolean, requested: boolean | undefined) {
    const org = { id: organizationId, slug: 'edf', isActive: previouslyActive, preventionEnabled: false };
    let activated = 0;
    const repo = { findOne: async () => null, save: async (value: typeof org) => value };
    const activation = { saveActivatedOrganization: async (value: typeof org) => {
      assert.equal(value.id, organizationId); activated += 1; return value;
    } };
    const service = new OrganizationService(repo as any, {} as any, {} as any, {} as any, activation as any);
    service.findOne = async () => org as any;
    await service.update(organizationId, { ...(requested === undefined ? {} : { isActive: requested }) });
    return activated;
  }
  assert.equal(await update(false, true), 1);
  assert.equal(await update(true, true), 0);
  assert.equal(await update(false, false), 0);
  assert.equal(await update(false, undefined), 0);
});

test('concurrent activation requests stage only the first inactive-to-active transition', async () => {
  const current = { isActive: 0, preventionEnabled: 0 };
  let runs = 0;
  const manager = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT isActive,preventionEnabled')) return [{ ...current }];
      if (sql.includes('INSERT INTO prevention_scheduler_runs')) runs += 1;
      if (sql.startsWith('UPDATE organizations SET preventionEnabled=1')) current.preventionEnabled = 1;
      return { affectedRows: 1 };
    },
    getRepository: () => ({ save: async (org: any) => {
      current.isActive = Number(org.isActive);
      current.preventionEnabled = Number(org.preventionEnabled);
      return { ...org };
    } }),
  };
  const activation: any = Object.create(PreventionOrganizationActivationService.prototype);
  activation.dataSource = { transaction: async (work: (manager: any) => Promise<unknown>) => work(manager) };
  activation.queue = { add: async () => undefined };
  activation.logger = { warn: () => assert.fail('queue should be available') };
  await activation.saveActivatedOrganization({ id: organizationId, isActive: true, preventionEnabled: false });
  const second = await activation.saveActivatedOrganization({ id: organizationId, isActive: true, preventionEnabled: false });
  assert.equal(runs, 1);
  assert.equal(current.preventionEnabled, 1);
  assert.equal(second.preventionEnabled, true);
});
