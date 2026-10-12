import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { VisitService } from './visit.service';
import { UserRole } from '../user/user.entity';

const organizationId = '10000000-0000-4000-8000-000000000001';
const visitId = '20000000-0000-4000-8000-000000000001';
const user = { id: 'user-a', organizationId, role: UserRole.ADMIN } as any;

function syncFixture(status = 'brouillon', photos: any[] = []) {
  const report = { id: 'report-a', organizationId, status, header: 'En-tête personnalisé', footer: 'Pied personnalisé' };
  const visit = { id: visitId, organizationId, userId: user.id, missionId: 'mission-a', photos };
  const updates: Array<{ sql: string; params: any[] }> = [];
  let events = 0;
  const service = Object.create(VisitService.prototype) as VisitService;
  (service as any).reportService = {
    notifyVisitReportChangedInTransaction: async () => { events += 1; },
  };
  const manager = {
    query: async (sql: string, params: any[] = []) => {
      if (sql.startsWith('SELECT id,organizationId,status,header,footer FROM reports')) return [report];
      if (sql.startsWith('SELECT * FROM visits')) return [visit];
      if (sql.startsWith('SELECT title,client,address FROM missions')) return [{ title: 'Chantier', client: 'Client', address: 'Paris' }];
      if (sql.startsWith('UPDATE ')) { updates.push({ sql, params }); return []; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { service, manager, updates, get events() { return events; } };
}

test('a group change refreshes the existing report in the backend and preserves custom framing', async () => {
  const f = syncFixture('brouillon', [{
    id: 'photo-a', groupId: 'group-a', uri: 'photo.jpg',
    analysis: { observation: ['Observation récente'], recommendation: ['Nouvelle action'], references: ['R1'], riskLevel: 'eleve' },
  }]);
  await (f.service as any).invalidateReportPdf(f.manager, organizationId, visitId);
  const reportUpdate = f.updates.find((item) => item.sql.startsWith('UPDATE reports SET content='));
  assert.ok(reportUpdate);
  assert.match(reportUpdate.params[0], /Observation récente/);
  assert.equal(reportUpdate.params[1], 'En-tête personnalisé');
  assert.equal(reportUpdate.params[2], 'Pied personnalisé');
  assert.equal(reportUpdate.params[3], 50);
  assert.equal(f.updates.find((item) => item.sql.startsWith('UPDATE visits SET reportGenerated='))?.params[0], 1);
  assert.equal(f.events, 1);
});

test('removing the last group empties the unlocked report and clears the visit marker', async () => {
  const f = syncFixture();
  await (f.service as any).invalidateReportPdf(f.manager, organizationId, visitId);
  const reportUpdate = f.updates.find((item) => item.sql.startsWith('UPDATE reports SET content='));
  assert.deepEqual(reportUpdate?.params.slice(0, 4), ['', '', '', 0]);
  assert.equal(f.updates.find((item) => item.sql.startsWith('UPDATE visits SET reportGenerated='))?.params[0], 0);
  assert.equal(f.events, 1);
});

test('a sent or archived report blocks group persistence even after earlier AI work', async () => {
  for (const status of ['envoye_au_client', 'archive']) {
    const f = syncFixture(status, [{ id: 'photo-a', groupId: 'group-a', analysis: { observation: ['A'] } }]);
    await assert.rejects(
      () => (f.service as any).invalidateReportPdf(f.manager, organizationId, visitId),
      ConflictException,
    );
    assert.equal(f.updates.some((item) => item.sql.startsWith('UPDATE reports SET content=')), false);
    assert.equal(f.events, 0);
  }
});

test('deleting a visit deletes its linked draft report before the visit and announces its removal', async () => {
  const service = Object.create(VisitService.prototype) as VisitService;
  const calls: string[] = [];
  (service as any).findOne = async () => ({ id: visitId, organizationId, userId: user.id, report: { status: 'brouillon' } });
  (service as any).reportService = {
    markReportDeletionPartitions: async () => calls.push('partitions'),
    notifyReportDeletedAfterCommit: () => calls.push('event'),
  };
  (service as any).dataSource = { transaction: async (work: (manager: any) => Promise<void>) => {
    await work({ query: async (sql: string) => {
      if (sql.startsWith('SELECT * FROM visits')) return [{ id: visitId, userId: user.id }];
      if (sql.startsWith('SELECT id,organizationId,status FROM reports')) return [{ id: 'report-a', organizationId, status: 'brouillon' }];
      if (sql.startsWith('DELETE FROM reports')) { calls.push('report'); return []; }
      if (sql.startsWith('DELETE FROM visits')) { calls.push('visit'); return []; }
      throw new Error(`Unexpected SQL: ${sql}`);
    } });
    calls.push('commit');
  } };
  await service.delete(visitId, user);
  assert.deepEqual(calls, ['partitions', 'report', 'visit', 'commit', 'event']);
});
