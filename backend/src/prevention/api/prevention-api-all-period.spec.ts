import assert from 'node:assert/strict';
import test from 'node:test';
import { PreventionApiService } from './prevention-api.service';
import { UserRole } from '../../user/user.entity';

const admin = { role: UserRole.ADMIN, organizationId: 'org-a' } as any;

test('ALL omits date predicates across prevention screens and keeps trend aggregation bounded', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    query: async (sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      if (sql.startsWith('SELECT COUNT(DISTINCT f.reportId)')) return [{ count: 0 }];
      if (sql.startsWith('SELECT COUNT(*) count')) return [{ count: 0 }];
      return [];
    },
  };
  const service = new PreventionApiService(db as any, {} as any);
  const query = { preset: 'ALL', page: 1, limit: 10 } as any;

  await service.dashboard(admin, query);
  await service.findings(admin, query);
  await service.recommendations(admin, query);
  const beforeTrends = calls.length;
  await service.trends(admin, query);
  const trendCalls = calls.slice(beforeTrends);
  await service.references(admin, query);

  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /(?:businessDate|statDate)\s+BETWEEN\s+/i);
    assert.ok(!call.args.includes('2026-10-06'));
    assert.ok(!call.args.some((arg) => typeof arg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(arg)));
    assert.equal(call.args[0], 'org-a');
  }

  assert.equal(trendCalls.length, 2);
  assert.ok(trendCalls.every((call) => call.sql.includes('LIMIT 1000')));
});

test('ALL exposes an unbounded display period while bounded custom periods retain date bounds', () => {
  const service = new PreventionApiService({ query: async () => [] } as any, {} as any);
  const all = (service as any).period({ preset: 'ALL' });
  assert.equal(all.all, true);
  assert.equal(all.from, null);
  assert.equal(all.to, null);
  assert.equal(all.granularity, 'month');

  const custom = (service as any).period({ preset: 'CUSTOM', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(custom.all, false);
  assert.equal(custom.from, '2026-01-01');
  assert.equal(custom.to, '2026-01-31');
  assert.throws(
    () => (service as any).period({ preset: 'CUSTOM', from: '2010-01-01', to: '2021-01-01' }),
    /10 ans/,
  );
});
