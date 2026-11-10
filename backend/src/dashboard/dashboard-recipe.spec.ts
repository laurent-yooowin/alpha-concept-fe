import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DashboardService } from './dashboard.service';
import { UserRole } from '../user/user.entity';

class QueryStub {
  conditions: string[] = [];
  parameters: Record<string, any> = {};
  constructor(readonly table: 'mission' | 'report') {}
  where(sql: string, parameters: Record<string, any> = {}) { this.conditions.push(sql); Object.assign(this.parameters, parameters); return this; }
  andWhere(sql: string, parameters: Record<string, any> = {}) { return this.where(sql, parameters); }
  clone() {
    const copy = new QueryStub(this.table);
    copy.conditions = [...this.conditions];
    copy.parameters = { ...this.parameters };
    return copy;
  }
  select() { return this; }
  addSelect() { return this; }
  groupBy() { return this; }
  orderBy() { return this; }
  addOrderBy() { return this; }
  async getCount() {
    if (this.table === 'mission') {
      if (this.conditions.some((condition) => condition.includes("status IN"))) return 176;
      if (this.conditions.some((condition) => condition.includes("status = 'terminee'"))) return 0;
      return 176;
    }
    const counts: Record<string, number> = {
      brouillon: 57, envoye: 0, valide: 0, envoye_au_client: 21, annule: 5,
    };
    if (this.parameters.excluded) return Object.entries(counts)
      .filter(([status]) => !this.parameters.excluded.includes(status))
      .reduce((sum, [, count]) => sum + count, 0);
    for (const key of ['draft', 'cancelled', 'validated', 'sent']) {
      if (this.parameters[key]) return counts[this.parameters[key]] ?? 0;
    }
    return 83;
  }
  async getRawOne() { return { avgDays: null }; }
  async getRawMany(): Promise<Array<{ status: string; count: string }>> { return []; }
}

test('dashboard excludes cancelled reports from submitted and counts client-sent reports', async () => {
  const missionRepo = {
    createQueryBuilder: () => new QueryStub('mission'),
    query: async () => [{ avgDays: null }],
  };
  const reportRepo = { createQueryBuilder: () => new QueryStub('report') };
  const userRepo = { createQueryBuilder: () => new QueryStub('mission') };
  const service = new DashboardService(missionRepo as any, reportRepo as any, userRepo as any);
  const stats = await service.getStats({ id: 'admin', organizationId: 'org-a', role: UserRole.ADMIN } as any);
  assert.equal(stats.totalReports, 83);
  assert.equal(stats.submittedReports, 21);
  assert.equal(stats.sentReports, 21);
  assert.equal(stats.draftReports, 57);
  assert.equal(stats.cancelledReports, 5);
  assert.equal(stats.avgProcessingTime, null);
});

test('processing time averages one first client send per authorized mission, not per report', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const missionRepo = {
    createQueryBuilder: () => new QueryStub('mission'),
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [{ avgDays: '2.45' }];
    },
  };
  const service = new DashboardService(
    missionRepo as any,
    { createQueryBuilder: () => new QueryStub('report') } as any,
    { createQueryBuilder: () => new QueryStub('mission') } as any,
  );
  const stats = await service.getStats({ id: 'coord-a', organizationId: 'org-a', role: UserRole.USER } as any);
  assert.equal(stats.avgProcessingTime, 2.5);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['envoye_au_client', 'org-a', 'coord-a']);
  assert.match(calls[0].sql, /AVG\(firstSend\.daysToFirstSend\)/);
  assert.match(calls[0].sql, /MIN\(report\.sentToClientAt\)/);
  assert.match(calls[0].sql, /GROUP BY mission\.id, mission\.createdAt/);
  assert.match(calls[0].sql, /TIMESTAMPDIFF\(SECOND, mission\.createdAt, MIN\(report\.sentToClientAt\)\)/);
  assert.match(calls[0].sql, /visit\.missionId = mission\.id/);
  assert.match(calls[0].sql, /visit\.organizationId = mission\.organizationId/);
  assert.match(calls[0].sql, /report\.visitId = visit\.id/);
  assert.match(calls[0].sql, /report\.missionId = mission\.id/);
  assert.match(calls[0].sql, /report\.sentToClientAt IS NOT NULL/);
  assert.match(calls[0].sql, /report\.sentToClientAt >= mission\.createdAt/);
  assert.match(calls[0].sql, /mission\.organizationId = \?/);
  assert.match(calls[0].sql, /mission\.userId = \?/);
  assert.doesNotMatch(calls[0].sql, /report\.updatedAt|report\.createdAt/);
});

test('admin processing time scopes by organization even for admin-authored reports', async () => {
  let parameters: unknown[] = [];
  const service = new DashboardService(
    {
      createQueryBuilder: () => new QueryStub('mission'),
      query: async (_sql: string, params: unknown[]) => {
        parameters = params;
        return [{ avgDays: null }];
      },
    } as any,
    { createQueryBuilder: () => new QueryStub('report') } as any,
    { createQueryBuilder: () => new QueryStub('mission') } as any,
  );
  const stats = await service.getStats({ id: 'admin-b', organizationId: 'org-b', role: UserRole.ADMIN } as any);
  assert.deepEqual(parameters, ['envoye_au_client', 'org-b']);
  assert.equal(stats.avgProcessingTime, null);
});

test('status breakdown includes completed missions at zero without changing other counts', async () => {
  class StatusQueryStub extends QueryStub {
    constructor(private readonly rows: Array<{ status: string; count: string }>) { super('mission'); }
    async getRawMany() { return this.rows; }
  }
  let rows = [{ status: 'planifiee', count: '3' }];
  const service = new DashboardService(
    { createQueryBuilder: () => new StatusQueryStub(rows) } as any,
    {} as any,
    {} as any,
  );
  const user = { id: 'admin', organizationId: 'org-a', role: UserRole.ADMIN } as any;
  assert.deepEqual(
    await service.getStatusBreakdown(user),
    [{ status: 'planifiee', count: 3 }, { status: 'terminee', count: 0 }],
  );
  rows = [{ status: 'planifiee', count: '3' }, { status: 'terminee', count: '2' }];
  assert.deepEqual(await service.getStatusBreakdown(user), [
    { status: 'planifiee', count: 3 }, { status: 'terminee', count: 2 },
  ]);
});

test('monthly mission query excludes future months and reports only the six current calendar months', async () => {
  const queries: QueryStub[] = [];
  const missionRepo = { createQueryBuilder: () => {
    const query = new QueryStub('mission');
    queries.push(query);
    return query;
  } };
  const service = new DashboardService(missionRepo as any, {} as any, {} as any);
  await service.getMonthlyMissions({ id: 'admin', organizationId: 'org-a', role: UserRole.ADMIN } as any);
  assert.match(queries[0].conditions.join(' '), /INTERVAL 5 MONTH/);
  assert.match(queries[0].conditions.join(' '), /mission\.date </);
  assert.match(queries[0].conditions.join(' '), /organizationId/);
});
