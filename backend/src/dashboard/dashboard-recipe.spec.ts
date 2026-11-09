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
  async getRawMany() { return []; }
}

test('dashboard excludes cancelled reports from submitted and counts client-sent reports', async () => {
  const missionRepo = { createQueryBuilder: () => new QueryStub('mission') };
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
