import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PreventionApiService } from './prevention-api.service';
import { PreventionRebuildQueueService } from "./prevention-rebuild-queue.service";
import { ConfigService } from "@nestjs/config";
import { requireJwtSecret } from "../../auth/strategies/jwt.strategy";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { PreventionQueryDto } from "./prevention-api.dto";
import { UserRole } from '../../user/user.entity';

const query = (values: any[]) => ({ query: async () => values });
const admin = { role: UserRole.ADMIN, organizationId: 'org-a' } as any;

test('prevention API rejects coordinators, hyper-admins and users without organization', async () => {
  const service = new PreventionApiService(query([]) as any, { enqueue: async () => ({ id: 'x', status: 'PENDING' }) } as any);
  for (const user of [
    { role: UserRole.USER, organizationId: 'org-a' },
    { role: UserRole.HYPER_ADMIN, organizationId: null },
    { role: UserRole.ADMIN, organizationId: null },
  ]) await assert.rejects(() => service.dashboard(user as any, {} as any), ForbiddenException);
});

test('findings query is tenant scoped and returns only derived fields', async () => {
  const calls: any[] = [];
  const db = { query: async (sql: string, args: unknown[]) => { calls.push({ sql, args }); return sql.startsWith('SELECT COUNT') ? [{ count: 1 }] : [{ id: 'f1', content: 'Observation', findingType: 'OBSERVATION' }]; } };
  const service = new PreventionApiService(db as any, {} as any);
  const result = await service.findings(admin, { from: '2026-01-01', to: '2026-01-31', page: 1, limit: 10, sortBy: 'businessDate', sortOrder: 'desc' } as any);
  assert.equal(result.items[0].id, 'f1');
  assert.match(calls[0].sql, /f\.organizationId=\?/);
  assert.ok(!Object.keys(result.items[0]).some((key) => /prompt|directive|sourceGroup|snapshot/i.test(key)));
});

test('job status does not cross organization boundary', async () => {
  const service = new PreventionApiService(query([]) as any, {} as any);
  await assert.rejects(() => service.job(admin, '00000000-0000-4000-8000-000000000001'), NotFoundException);
});


test("invalid or inverted periods return a bad request", async () => {
  const service = new PreventionApiService(query([]) as any, {} as any);
  await assert.rejects(
    () => service.dashboard(admin, { from: "2026-02-01", to: "2026-01-01" } as any),
    (error: any) => error?.getStatus?.() === 400,
  );
});

test("dashboard and trends use tenant-scoped distinct counts and bounded buckets", async () => {
  const calls: any[] = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.startsWith("SELECT COUNT(*) findings")) return [{ findings: 2, reports: 1, visits: 1, missions: 1 }];
    return [];
  } };
  const service = new PreventionApiService(db as any, {} as any);
  const dto = { from: "2026-01-01", to: "2026-12-31", missionId: "10000000-0000-4000-8000-000000000001" } as any;
  const dashboard = await service.dashboard(admin, dto);
  assert.equal(dashboard.totals.reports, 1);
  await service.trends(admin, dto);
  assert.ok(calls.every((call) => call.args[0] === "org-a"));
  assert.match(calls.at(-1).sql, /DATE_(?:FORMAT|SUB)\(f\.businessDate/);
  assert.match(calls.at(-1).sql, /f\.missionId=\?/);
});


test("materialized trends count each report and visit once per bucket", async () => {
  const calls: any[] = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes("prevention_daily_statistics")) return [{ bucket: "2026-01-01", findingCount: "6" }];
    if (sql.includes("prevention_report_snapshots")) return [{ bucket: "2026-01-01", reportCount: "1", visitCount: "1" }];
    return [];
  } };
  const service = new PreventionApiService(db as any, {} as any);
  const result = await service.trends(admin, { from: "2026-01-01", to: "2026-01-31" } as any);
  assert.deepEqual(result.items, [{ bucket: "2026-01-01", findingCount: 6, reportCount: 1, visitCount: 1 }]);
  assert.match(calls[0].sql, /SUM\(s\.findingCount\)/);
  assert.doesNotMatch(calls[0].sql, /SUM\(s\.(?:reportCount|visitCount)\)/);
  assert.match(calls[1].sql, /COUNT\(DISTINCT p\.reportId\).*COUNT\(DISTINCT p\.visitId\)/);
  assert.ok(calls.every((call) => call.args[0] === "org-a"));
});

test("references return paginated tenant-scoped report sources", async () => {
  const calls: any[] = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.startsWith("SELECT COUNT")) return [{ count: 1 }];
    return [{ reportId: "10000000-0000-4000-8000-000000000001", title: "Rapport", reportFileUrl: "https://example.invalid/report.pdf", visitId: "20000000-0000-4000-8000-000000000001", missionId: "30000000-0000-4000-8000-000000000001", findingCount: "2" }];
  } };
  const service = new PreventionApiService(db as any, {} as any);
  const result = await service.references(admin, { from: "2026-01-01", to: "2026-01-31", page: 1, limit: 10 } as any);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].reportRoute, "/reports/10000000-0000-4000-8000-000000000001");
  assert.equal(result.items[0].findingCount, 2);
  assert.ok(calls.every((call) => call.args[0] === "org-a"));
});


test("manual rebuild enforces the tenant cooldown with 429", async () => {
  const rebuild: any = Object.create(PreventionRebuildQueueService.prototype);
  let call = 0;
  rebuild.cooldownSeconds = 3600;
  rebuild.dataSource = { query: async () => { call += 1; return call === 1 ? [] : [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "COMPLETED", ageSeconds: 60 }]; } };
  await assert.rejects(
    () => rebuild.enqueue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    (error: any) => error?.getStatus?.() === 429 && error?.getResponse?.().retryAfterSeconds === 3540,
  );
});


test("JWT configuration rejects missing, weak and legacy secrets", () => {
  for (const secret of [undefined, "short", "your-secret-key-change-in-production"]) {
    assert.throws(() => requireJwtSecret(new ConfigService(secret ? { JWT_SECRET: secret } : {})), /JWT_SECRET/);
  }
  assert.equal(requireJwtSecret(new ConfigService({ JWT_SECRET: "a-secure-random-secret-with-32-characters" })), "a-secure-random-secret-with-32-characters");
});


test("prevention query DTO rejects invalid status, preset and unbounded pages", () => {
  const dto = plainToInstance(PreventionQueryDto, { status: "unknown", preset: "FOREVER", page: 1001, limit: 101 });
  const properties = new Set(validateSync(dto).map((error) => error.property));
  assert.ok(properties.has("status"));
  assert.ok(properties.has("preset"));
  assert.ok(properties.has("page"));
  assert.ok(properties.has("limit"));
});
