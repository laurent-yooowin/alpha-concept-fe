import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { MissionService } from './mission.service';
import { UserRole } from '../user/user.entity';

const organizationId = '10000000-0000-4000-8000-000000000001';
const missionId = '20000000-0000-4000-8000-000000000001';
const user = { id: 'user-a', organizationId, role: UserRole.ADMIN } as any;

function fixture(reportStatus: string) {
  const calls: string[] = [];
  const service = Object.create(MissionService.prototype) as MissionService;
  const mission = { id: missionId, organizationId, status: 'planifiee' };
  (service as any).missionRepository = {
    findOne: async () => mission,
    manager: { transaction: async (work: (manager: any) => Promise<void>) => {
      await work({
        query: async (sql: string) => {
          if (sql.startsWith('SELECT id FROM missions')) return [{ id: missionId }];
          if (sql.startsWith('SELECT id FROM visits')) return [{ id: 'visit-a' }];
          if (sql.startsWith('SELECT r.id,r.status')) return [{ id: 'report-a', status: reportStatus }];
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        getRepository: () => ({ remove: async () => { calls.push('mission-remove'); } }),
      });
      calls.push('commit');
    } },
  };
  (service as any).assignmentRepository = { findOne: async () => null };
  (service as any).reportService = {
    markReportDeletionPartitions: async () => { calls.push('partitions'); },
    notifyReportDeletedAfterCommit: () => { calls.push('event'); },
  };
  return { service, calls };
}

test('mission deletion cannot cascade into a sent or archived report', async () => {
  for (const status of ['envoye_au_client', 'archive']) {
    const { service, calls } = fixture(status);
    await assert.rejects(() => service.delete(missionId, user), ConflictException);
    assert.deepEqual(calls, []);
  }
});

test('mission deletion queues derived-data repair for draft reports before cascade', async () => {
  const { service, calls } = fixture('brouillon');
  await service.delete(missionId, user);
  assert.deepEqual(calls, ['partitions', 'mission-remove', 'commit', 'event']);
});

test('changing mission PDF metadata invalidates only unlocked linked artifacts', async () => {
  const service = Object.create(MissionService.prototype) as MissionService;
  const calls: string[] = [];
  const mission = { id: missionId, organizationId, title: 'Ancien chantier',
    client: 'Client', address: 'Paris', type: 'CSPS' };
  const persistedMission = { ...mission };
  (service as any).missionRepository = {
    findOne: async () => mission,
    manager: { transaction: async (work: (manager: any) => Promise<unknown>) => work({
      query: async (sql: string) => {
        if (sql.startsWith('SELECT id,title,client')) return [persistedMission];
        if (sql.startsWith('SELECT id FROM visits')) return [{ id: 'visit-a' }];
        if (sql.startsWith('UPDATE reports r')) { calls.push(sql); return []; }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      getRepository: () => ({ save: async (value: unknown) => value }),
    }) },
  };
  await service.update(missionId, user, { title: 'Nouveau chantier' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /status NOT IN \('envoye_au_client','archive'\)/);
});

test('mission visit exposes admin-authored draft and sent report statuses to its coordinator', async () => {
  for (const status of ['brouillon', 'envoye_au_client']) {
    const service = Object.create(MissionService.prototype) as MissionService;
    const coordinator = { id: 'user-a', organizationId, role: UserRole.USER } as any;
    const visit = { id: 'visit-a', missionId, organizationId, userId: coordinator.id, visitDate: new Date('2026-10-05T12:32:35Z') };
    const summary = { id: 'report-a', visitId: visit.id, status, createdAt: new Date('2026-10-05T13:00:00Z') };
    (service as any).missionRepository = { findOne: async ({ where }: any) => {
      assert.equal(where.organizationId, organizationId);
      assert.equal(where.userId, coordinator.id);
      return { id: missionId, organizationId, userId: coordinator.id };
    } };
    (service as any).assignmentRepository = { findOne: async () => null };
    (service as any).visitService = { findByMission: async () => [visit] };
    (service as any).reportService = {
      findStatusSummariesForVisits: async () => [summary],
      findByVisit: async () => null,
    };

    const mission = await service.findOne(missionId, coordinator);
    assert.equal(mission.visits[0].report.id, summary.id);
    assert.equal(mission.visits[0].report.status, status);
  }
});

test('mission list exposes the same linked status to the coordinator', async () => {
  const service = Object.create(MissionService.prototype) as MissionService;
  const coordinator = { id: 'user-a', organizationId, role: UserRole.USER } as any;
  const visit = { id: 'visit-a', missionId, organizationId, userId: coordinator.id, visitDate: new Date('2026-10-05T12:32:35Z') };
  const summary = { id: 'report-a', visitId: visit.id, status: 'envoye_au_client', createdAt: new Date('2026-10-05T13:00:00Z') };
  (service as any).missionRepository = { find: async ({ where }: any) => {
    assert.equal(where.organizationId, organizationId);
    assert.equal(where.userId, coordinator.id);
    return [{ id: missionId, organizationId, userId: coordinator.id }];
  } };
  (service as any).assignmentRepository = { findOne: async () => null };
  (service as any).visitService = { findByMission: async () => [visit] };
  (service as any).reportService = {
    findStatusSummariesForVisits: async () => [summary],
    findByVisit: async () => null,
  };

  const missions = await service.findAll(coordinator);
  assert.equal(missions[0].visits[0].report.id, summary.id);
  assert.equal(missions[0].visits[0].report.status, 'envoye_au_client');
});
