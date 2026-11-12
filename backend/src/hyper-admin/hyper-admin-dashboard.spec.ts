import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HyperAdminService } from './hyper-admin.service';

function statusQuery() {
  return {
    select() { return this; },
    addSelect() { return this; },
    where() { return this; },
    groupBy() { return this; },
    async getRawMany() { return []; },
  };
}

test('Hyper Admin counts distinct mission clients per organization and sums those counts', async () => {
  const missions = [
    { organizationId: 'org-a', client: ' EDF ' },
    { organizationId: 'org-a', client: 'edf' },
    { organizationId: 'org-a', client: 'Yooowin' },
    { organizationId: 'org-a', client: '   ' },
    { organizationId: 'org-b', client: 'EDF' },
    { organizationId: 'org-b', client: '' },
  ];
  const queries: Array<{ sql: string; organizationId: string }> = [];
  const repository = { count: async () => 0, createQueryBuilder: statusQuery };
  const missionRepo = {
    ...repository,
    query: async (sql: string, [organizationId]: [string]) => {
      queries.push({ sql, organizationId });
      const clients = new Set(missions
        .filter((mission) => mission.organizationId === organizationId)
        .map((mission) => mission.client.trim().toLowerCase())
        .filter(Boolean));
      return [{ clientCount: String(clients.size) }];
    },
  };
  const service = new HyperAdminService(
    { find: async () => [{ id: 'org-a' }, { id: 'org-b' }] } as any,
    repository as any,
    missionRepo as any,
    repository as any,
    repository as any,
    {} as any,
  );

  const dashboard = await service.globalDashboard();

  assert.deepEqual(dashboard.perOrganization.map((row) => [row.organization.id, row.clients]), [
    ['org-a', 2], ['org-b', 1],
  ]);
  assert.equal(dashboard.totals.clients, 3);
  assert.deepEqual(queries.map((query) => query.organizationId).sort(), ['org-a', 'org-b']);
  for (const { sql } of queries) {
    assert.match(sql, /COUNT\(DISTINCT LOWER\(NULLIF\(TRIM\(client\), ''\)\)\)/);
    assert.match(sql, /FROM missions WHERE organizationId=\?/);
  }
});

test('Hyper Admin returns zero clients without organizations or orphan mission reads', async () => {
  let queried = false;
  const repository = { count: async () => 0, createQueryBuilder: statusQuery };
  const service = new HyperAdminService(
    { find: async () => [] } as any,
    repository as any,
    { ...repository, query: async () => { queried = true; return []; } } as any,
    repository as any,
    repository as any,
    {} as any,
  );

  const dashboard = await service.globalDashboard();

  assert.equal(dashboard.totals.clients, 0);
  assert.deepEqual(dashboard.perOrganization, []);
  assert.equal(queried, false);
});
