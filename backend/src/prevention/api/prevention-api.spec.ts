import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PreventionApiService } from './prevention-api.service';
import { PreventionRebuildQueueService } from "./prevention-rebuild-queue.service";
import { loadPreventionBulkConfiguration } from '../scheduler/prevention-bulk.config';
import { ConfigService } from "@nestjs/config";
import { requireJwtSecret } from "../../auth/strategies/jwt.strategy";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { PreventionQueryDto } from "./prevention-api.dto";
import { UserRole } from '../../user/user.entity';
import { budgetClientIdentity } from '../budget/prevention-budget-client';

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
  assert.match(calls.at(-1).sql, /DATE_FORMAT\(f\.businessDate,'%Y-%m-%d'\) businessDate/);
  assert.ok(!Object.keys(result.items[0]).some((key) => /prompt|directive|sourceGroup|snapshot/i.test(key)));
});

test('client and chantier filters intersect without accepting a foreign client key', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes('SELECT id,client FROM missions')) return [
      { id: '10000000-0000-4000-8000-000000000001', client: 'ÉDF' },
      { id: '10000000-0000-4000-8000-000000000002', client: 'édF' },
      { id: '10000000-0000-4000-8000-000000000003', client: 'Autre' },
    ];
    return sql.startsWith('SELECT COUNT') ? [{ count: 0 }] : [];
  } };
  const service = new PreventionApiService(db as any, {} as any);
  const key = budgetClientIdentity('édF').key;
  await service.findings(admin, { preset: 'ALL', missionId: '10000000-0000-4000-8000-000000000001', clientKeys: [key] } as any);
  const filtered = calls.find((call) => call.sql.startsWith('SELECT COUNT'))!;
  assert.match(filtered.sql, /f\.missionId=\?/);
  assert.match(filtered.sql, /f\.missionId IN \(\?\)/);
  assert.ok(filtered.args.includes('10000000-0000-4000-8000-000000000001'));
  assert.deepEqual(filtered.args.find((arg) => Array.isArray(arg)), [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
  ]);
  await assert.rejects(() => service.findings(admin, { preset: 'ALL', clientKeys: ['a'.repeat(64)] } as any), /Client introuvable/);
});

test('critical severity is derived from elevated risk and a priority score of at least 80', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    return sql.startsWith('SELECT COUNT') ? [{ count: 0 }] : [];
  } };
  const service = new PreventionApiService(db as any, {} as any);

  await service.findings(admin, {
    from: '2026-01-01', to: '2026-01-31', severity: 'critique', page: 1, limit: 10,
  } as any);

  assert.ok(calls.every((call) => call.args[0] === 'org-a'));
  assert.ok(calls.every((call) => call.args.includes(80)));
  assert.match(calls[0].sql, /f\.riskLevel='eleve'/);
  assert.match(calls[0].sql, /prevention_priority_scores ps/);
  assert.match(calls[0].sql, />=\?/);
});

test('recommendations support priority ordering by descending score', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    return sql.startsWith('SELECT COUNT') ? [{ count: 0 }] : [];
  } };
  const service = new PreventionApiService(db as any, {} as any);

  await service.recommendations(admin, {
    from: '2026-01-01',
    to: '2026-01-31',
    sortBy: 'score',
    sortOrder: 'desc',
  } as any);

  const listQuery = calls.find((call) => call.sql.includes('LIMIT ? OFFSET ?'));
  const countQuery = calls.find((call) => call.sql.includes('recommendationPatterns'));
  assert.match(countQuery?.sql ?? '', /GROUP BY f\.patternKey,f\.missionType,COALESCE\(f\.categoryId,'UNCATEGORIZED'\)/);
  assert.match(listQuery?.sql ?? '', /ROW_NUMBER\(\) OVER/);
  assert.match(listQuery?.sql ?? '', /WHERE patternRank=1/);
  assert.match(listQuery?.sql ?? '', /ORDER BY score DESC,id ASC/);
  assert.match(listQuery?.sql ?? '', /DATE_FORMAT\(f\.businessDate,'%Y-%m-%d'\) businessDate/);
});

test('categories are active and tenant scoped', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    return [{ id: 'category-a', code: 'HEIGHT', label: 'Travaux en hauteur', color: '#3182CE', displayOrder: '2' }];
  } };
  const service = new PreventionApiService(db as any, {} as any);

  const result = await service.categories(admin);

  assert.equal(result.items[0].displayOrder, 2);
  assert.match(calls[0].sql, /organizationId=\?/);
  assert.match(calls[0].sql, /isActive=1/);
  assert.deepEqual(calls[0].args, ['org-a']);
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

test('day and week trend buckets are returned as date-only strings', async () => {
  const calls: string[] = [];
  const db = { query: async (sql: string) => { calls.push(sql); return []; } };
  const service = new PreventionApiService(db as any, {} as any);
  const missionId = '10000000-0000-4000-8000-000000000001';
  await service.trends(admin, { from: '2026-01-01', to: '2026-01-02', missionId } as any);
  assert.match(calls.at(-1) ?? '', /DATE_FORMAT\(f\.businessDate,'%Y-%m-%d'\) bucket/);
  await service.trends(admin, { from: '2026-01-01', to: '2026-05-01', missionId } as any);
  assert.match(calls.at(-1) ?? '', /DATE_FORMAT\(DATE_SUB\(f\.businessDate,INTERVAL WEEKDAY\(f\.businessDate\) DAY\),'%Y-%m-%d'\) bucket/);
});

test('dashboard exposes RTE category and unique recommendation priority dimensions', async () => {
  const calls: string[] = [];
  const db = { query: async (sql: string) => {
    calls.push(sql);
    if (sql.includes('GROUP BY f.missionId,f.categoryId')) return [{ missionId: 'mission-a', missionTitle: 'Chantier A', categoryId: 'cat-a', categoryCode: 'EPI', categoryLabel: 'EPI & Équipements', observationCount: '4' }];
    if (sql.includes('GROUP BY f.missionId')) return [{ missionId: 'mission-a', missionTitle: 'Chantier A', faibleCount: '1', moyenCount: '2', eleveCount: '1' }];
    if (sql.includes("'critique','eleve','moyen','faible'")) return [{ riskLevel: 'critique', count: '1' }, { riskLevel: 'moyen', count: '2' }];
    if (sql.includes("SUM(f.riskLevel='faible')")) return [{ categoryKey: 'cat-a', categoryId: 'cat-a', categoryLabel: 'EPI', faibleCount: '1', moyenCount: '2', eleveCount: '1' }];
    if (sql.includes('prioritizedPatterns')) return [{ prioritizedPatterns: '3', averageScore: '72.5', maxScore: '91' }];
    if (sql.includes('GROUP BY f.missionType')) return [{ missionType: 'CSPS', reportCount: '2', observationCount: '4' }];
    if (sql.includes('averageConformity')) return [{ measuredReports: '2', averageConformity: '72.5' }];
    if (sql.includes('riskRank')) return [{ id: 'risk-a', content: 'Garde-corps absent', riskLevel: 'eleve', score: '88', occurrenceCount: '3', reportCount: '2', reportId: 'report-a', reportTitle: 'Rapport A' }];
    if (sql.includes("NULLIF(TRIM(m.client),''")) return [{ client: 'Entreprise A', categoryId: 'cat-a', categoryCode: 'EPI', categoryLabel: 'EPI & Équipements', observationCount: '4' }];
    if (sql.includes('prevention_analysis_groups g')) return [{ effectivePhase: 'INSTALLATION_ELECTRIQUE', reportCount: '2' }];
    if (sql.includes('MAX(c.label) categoryLabel')) return [{ categoryKey: 'cat-a', categoryId: 'cat-a', categoryLabel: 'EPI', findingCount: '4' }];
    if (sql.includes('ROW_NUMBER() OVER')) return [{ id: 'finding-a', content: 'Porter le casque', categoryLabel: 'EPI', riskLevel: 'eleve', score: '91', occurrenceCount: '3', reportCount: '2', reportId: 'report-a', reportTitle: 'Rapport A' }];
    if (sql.includes('SUM(s.findingCount)')) return [{ findings: '4' }];
    if (sql.includes('prevention_report_snapshots')) return [{ reports: '2', visits: '2', missions: '1' }];
    return [];
  } };
  const service = new PreventionApiService(db as any, {} as any);

  const result = await service.dashboard(admin, { from: '2026-01-01', to: '2026-01-31' } as any);

  assert.deepEqual(result.categoryBreakdown, [{ categoryKey: 'cat-a', categoryId: 'cat-a', categoryLabel: 'EPI', findingCount: 4 }]);
  assert.equal(result.topPriorities[0].content, 'Porter le casque');
  assert.equal(result.topPriorities[0].score, 91);
  assert.deepEqual(result.categoryRiskMatrix[0], { categoryKey: 'cat-a', categoryId: 'cat-a', categoryLabel: 'EPI', faible: 1, moyen: 2, eleve: 1 });
  assert.deepEqual(result.scoreSummary, { prioritizedPatterns: 3, averageScore: 72.5, maxScore: 91 });
  assert.deepEqual(result.missionTypeBreakdown, [{ missionType: 'CSPS', reportCount: 2, observationCount: 4 }]);
  assert.deepEqual(result.conformitySummary, { measuredReports: 2, averageConformity: 72.5 });
  assert.deepEqual(result.missionRiskMatrix[0], { missionId: 'mission-a', missionTitle: 'Chantier A', faible: 1, moyen: 2, eleve: 1 });
  assert.deepEqual(result.missionCategoryMatrix[0], { missionId: 'mission-a', missionTitle: 'Chantier A', categoryId: 'cat-a', categoryCode: 'EPI', categoryLabel: 'EPI & Équipements', observationCount: 4 });
  assert.deepEqual(result.clientCategoryMatrix[0], { client: 'Entreprise A', categoryId: 'cat-a', categoryCode: 'EPI', categoryLabel: 'EPI & Équipements', observationCount: 4 });
  assert.deepEqual(result.phaseBreakdown[0], { phase: 'INSTALLATION_ELECTRIQUE', label: 'Installation électrique', reportCount: 2 });
  assert.deepEqual(result.riskBreakdown, [{ riskLevel: 'critique', count: 1 }, { riskLevel: 'moyen', count: 2 }]);
  assert.equal(result.topRisks[0].content, 'Garde-corps absent');
  assert.equal(result.topRisks[0].score, 88);
  const severityQuery = calls.find((sql) => sql.includes("'critique','eleve','moyen','faible'"));
  assert.ok(severityQuery);
  assert.doesNotMatch(severityQuery, /FIELD\(\s*riskLevel\s*,/);
  assert.match(severityQuery, /\) severityCounts\s+ORDER BY FIELD\(severityCounts\.riskLevel,/);
  const phaseQuery = calls.find((sql) => sql.includes('prevention_analysis_groups g'));
  assert.match(phaseQuery ?? '', /COUNT\(DISTINCT g\.reportId\)/);
  assert.match(phaseQuery ?? '', /prevention_report_snapshots s/);
  const clientMatrixQuery = calls.find((sql) => sql.includes("NULLIF(TRIM(m.client),''"));
  assert.match(clientMatrixQuery ?? '', /GROUP BY COALESCE\(NULLIF\(TRIM\(m\.client\),''\),'Client non renseigné'\),f\.categoryId/);
});


test("materialized trends count each report and visit once per bucket", async () => {
  const calls: any[] = [];
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes("prevention_daily_statistics")) return [{ bucket: "2026-01-01", findingCount: "6", observationCount: "4" }];
    if (sql.includes("prevention_report_snapshots")) return [{ bucket: "2026-01-01", reportCount: "1", visitCount: "1" }];
    return [];
  } };
  const service = new PreventionApiService(db as any, {} as any);
  const result = await service.trends(admin, { from: "2026-01-01", to: "2026-01-31" } as any);
  assert.deepEqual(result.items, [{ bucket: "2026-01-01", findingCount: 6, observationCount: 4, reportCount: 1, visitCount: 1 }]);
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
    if (sql.includes('f.regulatoryReferences')) return [
      { reportId: '10000000-0000-4000-8000-000000000001', reportTitle: 'Rapport', reportFileUrl: 'https://example.invalid/report.pdf', categoryLabel: 'Travaux en hauteur', severity: 'critique', regulatoryReferences: JSON.stringify(['R. 4534-1', 'R. 4534-1']) },
      { reportId: '10000000-0000-4000-8000-000000000002', reportTitle: 'Rapport 2', reportFileUrl: 'https://example.invalid/report-2.pdf', categoryLabel: 'EPI', severity: 'moyen', regulatoryReferences: JSON.stringify(['R. 4534-1']) },
    ];
    return [{ reportId: "10000000-0000-4000-8000-000000000001", title: "Rapport", reportFileUrl: "https://example.invalid/report.pdf", visitId: "20000000-0000-4000-8000-000000000001", missionId: "30000000-0000-4000-8000-000000000001", findingCount: "2" }];
  } };
  const service = new PreventionApiService(db as any, {} as any);
  const result = await service.references(admin, { from: "2026-01-01", to: "2026-01-31", page: 1, limit: 10 } as any);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].reportRoute, "/reports/10000000-0000-4000-8000-000000000001");
  assert.equal(result.items[0].findingCount, 2);
  assert.match(calls.find((call) => call.sql.includes('GROUP BY f.reportId'))?.sql ?? '', /DATE_FORMAT\(MIN\(f\.businessDate\),'%Y-%m-%d'\) businessDate/);
  assert.equal(result.regulatoryItems[0].reference, 'R.4534-1');
  assert.equal(result.regulatoryItems[0].citationCount, 2);
  assert.equal(result.regulatoryItems[0].reportCount, 2);
  assert.deepEqual(result.regulatoryItems[0].domains, ['Travaux en hauteur', 'EPI']);
  assert.deepEqual(result.regulatoryItems[0].riskLevels, ['critique', 'moyen']);
  assert.ok(result.regulatoryItems[0].reports.every((report: any) => !('url' in report)));
  assert.ok(calls.every((call) => call.args[0] === "org-a"));
});


test("manual rebuild enforces the tenant cooldown with 429", async () => {
  const rebuild: any = Object.create(PreventionRebuildQueueService.prototype);
  rebuild.previewSecret = 'test-prevention-rebuild-preview-secret';
  const queries: string[] = [];
  rebuild.cooldownSeconds = 3600;
  rebuild.bulkConfiguration = loadPreventionBulkConfiguration(new ConfigService({}));
  rebuild.dataSource = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes('COUNT(DISTINCT r.id)')) return [{ reportCount: 0, findingCount: 0 }];
    if (sql.includes('ageSeconds')) return [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "COMPLETED", ageSeconds: 60 }];
    return [];
  } };
  await assert.rejects(
    () => rebuild.enqueue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    (error: any) => error?.getStatus?.() === 429 && error?.getResponse?.().retryAfterSeconds === 3540,
  );
  const cooldownQuery = queries.find((sql) => sql.includes('ageSeconds'));
  assert.match(cooldownQuery ?? '', /CURRENT_TIMESTAMP\(\)/);
  assert.doesNotMatch(cooldownQuery ?? '', /UTC_TIMESTAMP/);
});

test('manual rebuild preview snapshots the selected client and chantier and rejects a changed confirmation', async () => {
  const organizationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const missionA = '10000000-0000-4000-8000-000000000001';
  const missionB = '10000000-0000-4000-8000-000000000002';
  const key = budgetClientIdentity('ÉDF').key;
  const rebuild: any = Object.create(PreventionRebuildQueueService.prototype);
  rebuild.previewSecret = 'test-prevention-rebuild-preview-secret';
  rebuild.bulkConfiguration = loadPreventionBulkConfiguration(new ConfigService({}));
  let sourceRevision = '2026-10-01T00:00:00Z';
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  rebuild.dataSource = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes('SELECT id,client FROM missions')) return [{ id: missionA, client: 'ÉDF' }, { id: missionB, client: 'Autre' }];
    if (sql.includes('SELECT r.id,r.updatedAt reportUpdatedAt')) return [{ id: 'report-a', reportUpdatedAt: sourceRevision, visitUpdatedAt: sourceRevision, photosHash: 'hash' }];
    return [{ reportCount: 1, findingCount: 3 }];
  } };
  const preview = await rebuild.preview(organizationId, { missionId: missionA, clientKeys: [key] });
  assert.deepEqual(preview.scopeMissionIds, [missionA]);
  const volumeQuery = calls.find((call) => call.sql.includes('COUNT(DISTINCT r.id)'))!;
  assert.match(volumeQuery.sql, /v\.missionId IN \(\?\)/);
  assert.deepEqual(volumeQuery.args[2], [missionA]);
  await assert.rejects(() => rebuild.admit(organizationId, preview.previewToken, { missionId: missionB }),
    (error: any) => error?.getStatus?.() === 409);
  const [encoded, signature] = preview.previewToken.split('.');
  const tampered = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  tampered.issuedAt += 1000;
  await assert.rejects(() => rebuild.admit(organizationId,
    `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`,
    { missionId: missionA, clientKeys: [key] }), (error: any) => error?.getStatus?.() === 409);
  sourceRevision = '2026-10-02T00:00:00Z';
  await assert.rejects(() => rebuild.admit(organizationId, preview.previewToken, { missionId: missionA, clientKeys: [key] }),
    (error: any) => error?.getStatus?.() === 409);
});

test('concurrent manual reconstruction cannot confirm a different persisted scope', async () => {
  const rebuild: any = Object.create(PreventionRebuildQueueService.prototype);
  rebuild.cooldownSeconds = 3600;
  let enqueued = false;
  rebuild.dataSource = {
    query: async (sql: string) => sql.includes('SELECT r.id,r.status,c.scopeDigest')
      ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'PROCESSING', scopeDigest: 'other-scope' }]
      : [],
    transaction: async (callback: (manager: any) => Promise<void>) => callback({ query: async () => ({ affectedRows: 0 }) }),
  };
  rebuild.queue = { add: async () => { enqueued = true; } };
  await assert.rejects(() => rebuild.enqueueMeasured('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
    reportCount: 1, findingCount: 1, immediateLimit: 5000, executionMode: 'IMMEDIATE', scheduledFor: null,
    scopeDigest: 'requested-scope', scopeMissionIds: [], previewToken: 'unused',
  }), (error: any) => error?.getStatus?.() === 409);
  assert.equal(enqueued, false);
});

test("manual rebuild checkpoint is immediately available in UTC", async () => {
  const transactionQueries: string[] = [];
  const rebuild: any = Object.create(PreventionRebuildQueueService.prototype);
  rebuild.previewSecret = 'test-prevention-rebuild-preview-secret';
  rebuild.cooldownSeconds = 3600;
  rebuild.bulkConfiguration = loadPreventionBulkConfiguration(new ConfigService({}));
  rebuild.activation = undefined;
  rebuild.dataSource = {
    query: async (sql: string) => {
      if (sql.includes('COUNT(DISTINCT r.id)')) return [{ reportCount: 0, findingCount: 0 }];
      if (sql.includes('SELECT r.id,r.updatedAt reportUpdatedAt') || sql.includes('r.status IN') || sql.includes('ageSeconds')) return [];
      return [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "PROCESSING" }];
    },
    transaction: async (callback: (manager: any) => Promise<void>) => callback({
      query: async (sql: string) => { transactionQueries.push(sql); return { affectedRows: 1 }; },
    }),
  };
  rebuild.queue = { getJob: async () => null, add: async () => undefined };

  await rebuild.enqueue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

  const checkpointInsert = transactionQueries.find((sql) => sql.includes("prevention_scheduler_checkpoints"));
  assert.match(checkpointInsert ?? "", /availableAt,scopeDigest,scopeMissionIds\).*UTC_TIMESTAMP\(6\)/);
});

test("manual rebuild resumes an orphaned active run without creating another run", async () => {
  const queued: any[] = [];
  let removed = 0;
  const rebuild: any = Object.create(PreventionRebuildQueueService.prototype);
  rebuild.previewSecret = 'test-prevention-rebuild-preview-secret';
  rebuild.activation = undefined;
  rebuild.bulkConfiguration = loadPreventionBulkConfiguration(new ConfigService({}));
  rebuild.dataSource = {
    query: async (sql: string) => sql.includes('COUNT(DISTINCT r.id)')
      ? [{ reportCount: 0, findingCount: 0 }]
      : sql.includes('SELECT r.id,r.updatedAt reportUpdatedAt') ? [] : [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "PROCESSING",
        scheduledFor: "2026-09-23T09:33:28.925Z",
      }],
  };
  rebuild.queue = {
    getJob: async () => ({
      getState: async () => "completed",
      remove: async () => { removed += 1; },
    }),
    add: async (...args: any[]) => { queued.push(args); },
  };

  const result = await rebuild.enqueue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

  assert.deepEqual(result, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "PROCESSING",
  });
  assert.equal(removed, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0][1].runId, result.id);
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

test("prevention query DTO accepts the complete available period", () => {
  const dto = plainToInstance(PreventionQueryDto, { preset: "ALL" });
  assert.equal(validateSync(dto).length, 0);
  const service = new PreventionApiService(query([]) as any, {} as any);
  const period = (service as any).period(dto);
  assert.equal(period.all, true);
  assert.equal(period.from, null);
  assert.equal(period.to, null);
  assert.equal(period.granularity, 'month');
});

test('prevention query DTO accepts the approved four display severities', () => {
  for (const severity of ['critique', 'eleve', 'moyen', 'faible']) {
    const dto = plainToInstance(PreventionQueryDto, { severity });
    assert.equal(validateSync(dto).length, 0);
  }
  assert.ok(validateSync(plainToInstance(PreventionQueryDto, { severity: 'inconnue' }))
    .some((error) => error.property === 'severity'));
});
