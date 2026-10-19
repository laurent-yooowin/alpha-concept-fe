import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UserRole } from '../../user/user.entity';
import { PreventionBudgetApiService, budgetCalendarDate, preventionBudgetAnnualScenarioKey, preventionBudgetScopeKey, resolveBudgetPeriod, resolveBudgetScopePeriod } from './prevention-budget-api.service';
import { PreventionBudgetCommandDto, PreventionBudgetExecutionModeDto, PreventionBudgetPreviewDto } from './prevention-budget.dto';
import { PreventionBudgetCreateDto, PreventionBudgetItemPatchDto, PreventionBudgetScopeDto } from './prevention-budget.dto';
import { budgetClientActionKey, budgetClientIdentity } from '../budget/prevention-budget-client';
import { budgetActionGroup } from '../budget/prevention-budget-grouping';
import { materializedActionScopeKey } from '../budget/prevention-budget-materialized';
import { loadPreventionBudgetSourceVersion } from '../budget/prevention-budget.service';

test('budget API is restricted to an organization administrator', async () => {
  const service = new PreventionBudgetApiService({ query: async () => [] } as any, {} as any);
  for (const user of [
    { role: UserRole.USER, organizationId: 'org-a' },
    { role: UserRole.HYPER_ADMIN, organizationId: null },
    { role: UserRole.ADMIN, organizationId: null },
  ]) await assert.rejects(() => service.list(user as any, {} as any), ForbiddenException);
});

test('budget detail is tenant scoped and does not reveal a foreign scenario', async () => {
  const calls: Array<{ sql: string; args: unknown[] | undefined }> = [];
  const service = new PreventionBudgetApiService({ query: async (sql: string, args?: unknown[]) => { calls.push({ sql, args }); return []; } } as any, {} as any);
  await assert.rejects(() => service.detail({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, '10000000-0000-4000-8000-000000000001'), NotFoundException);
  assert.match(calls[0].sql, /organizationId=\?/);
  assert.equal(calls[0].args?.[1], 'org-a');
});

test('budget detail exposes the persisted AI cost rationale and range', async () => {
  const scenario = { id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioKey: 'budget-2026', version: 2, status: 'CALCULATED', contingencyRatePercent: '10.00' };
  const item = {
    id: '20000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioId: scenario.id,
    quantity: '2.0000', unit: 'JOUR', unitCostHt: '180.00', totalHt: '360.00', status: 'ESTIME', lockedManual: 0,
    aiEstimateDetails: JSON.stringify({ kind: 'AI_ESTIMATE', rangeLowHt: '300.00', rangeHighHt: '450.00', rationale: 'Deux jours de pose.' }),
  };
  const db = { query: async (sql: string) => {
    if (sql.includes('SELECT version,status FROM prevention_budget_scenarios')) return [scenario];
    if (sql.includes('FROM prevention_budget_items i')) return [item];
    if (sql.includes('FROM prevention_budget_item_sources')) return [];
    if (sql.includes('FROM prevention_budget_scenarios')) return [scenario];
    return [];
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const result = await service.detail({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, scenario.id);
  assert.equal(result.items[0].justificationDetails.aiEstimate.rationale, 'Deux jours de pose.');
  assert.equal(result.items[0].justificationDetails.aiEstimate.rangeHighHt, '450.00');
});

test('budget DTOs bound periods, prices and optimistic versions', () => {
  const create = plainToInstance(PreventionBudgetCreateDto, {
    periodStart: '2026-01-01', periodEnd: '2026-01-31', contingencyRatePercent: '10.00', unknown: true,
  });
  const item = plainToInstance(PreventionBudgetItemPatchDto, {
    expectedVersion: 1, quantity: '1.23456', unitCostHt: '10.999', priceSource: '',
  });
  const createProperties = new Set(validateSync(create).map((error) => error.property));
  const itemProperties = new Set(validateSync(item).map((error) => error.property));
  assert.ok(!createProperties.has('periodStart'));
  assert.ok(createProperties.has('contingencyRatePercent'));
  assert.ok(!validateSync(plainToInstance(PreventionBudgetCreateDto, {
    periodStart: '2026-01-01', periodEnd: '2026-01-31', contingencyRatePercent: '0.00',
  })).some((error) => error.property === 'contingencyRatePercent'));
  assert.ok(itemProperties.has('quantity'));
  assert.ok(itemProperties.has('unitCostHt'));
  assert.ok(validateSync(plainToInstance(PreventionBudgetCommandDto, { mode: 'CURRENT_YEAR' }))
    .some((error) => error.property === 'confirmationToken'));
});

test('budget listing selects one materialized row per scenario key and exposes pending drafts separately', async () => {
  const calls: string[] = [];
  const db = { query: async (sql: string) => {
    calls.push(sql);
    if (sql.startsWith('SELECT COUNT')) return [{ count: 1 }];
    return [{ id: 'scenario-v2', scenarioKey: 'budget-2026', version: 2, status: 'CALCULATED', contingencyRatePercent: '10.00', retainedBudgetHt: '0.00', estimatedBudgetHt: '0.00', validatedBudgetHt: '0.00', contingencyAmountHt: '0.00', totalBudgetHt: '0.00', pending: 1 }];
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const result = await service.list({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, {} as any);
  assert.equal(result.items.length, 1);
  assert.match(calls[0], /status<>'DRAFT'/);
  assert.match(calls[1], /newerDraft/);
});

test('MySQL budget DATE values remain calendar days in API responses', async () => {
  assert.equal(budgetCalendarDate(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(budgetCalendarDate(new Date(2026, 7, 6)), '2026-08-06');
  assert.equal(budgetCalendarDate('2026-08-06'), '2026-08-06');
  const db = { query: async (sql: string) => sql.startsWith('SELECT COUNT') ? [{ count: 1 }] : [{
    id: 'scenario-1', scenarioKey: 'budget-2026', version: 1, status: 'CALCULATED',
    periodStart: new Date(2026, 0, 1), periodEnd: new Date(2026, 7, 6),
  }] };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const result = await service.list({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, {} as any);
  assert.equal(result.items[0].periodStart, '2026-01-01');
  assert.equal(result.items[0].periodEnd, '2026-08-06');
});

test('legacy catalogue mutations cannot enqueue unadmitted full budget refreshes', async () => {
  const service = new PreventionBudgetApiService({ query: async () => { throw new Error('unexpected SQL'); } } as any,
    { enqueueRefreshForCatalog: async () => { throw new Error('unexpected enqueue'); } } as any);
  const admin = { id: 'admin-1', role: UserRole.ADMIN, organizationId: 'org-a' } as any;
  await assert.rejects(() => service.createCatalog(admin, {} as any), ConflictException);
  await assert.rejects(() => service.setCatalogStatus(admin, 'catalog-1', { isActive: false } as any), ConflictException);
});

test('legacy full-budget commands cannot bypass preview confirmation or bulk admission', async () => {
  const service = new PreventionBudgetApiService({ query: async () => { throw new Error('unexpected SQL'); } } as any,
    { enqueueBuild: async () => { throw new Error('unexpected build'); }, enqueueRecalculate: async () => { throw new Error('unexpected recalculation'); } } as any);
  const admin = { id: 'admin-1', role: UserRole.ADMIN, organizationId: 'org-a' } as any;
  await assert.rejects(() => service.scope(admin, { preset: 'CURRENT_YEAR' } as any, true), ConflictException);
  await assert.rejects(() => service.create(admin, {} as any), ConflictException);
  await assert.rejects(() => service.recalculate(admin, 'scenario-1', {} as any), ConflictException);
  await assert.rejects(() => service.patchScenario(admin, 'scenario-1', {} as any), ConflictException);
});

test('budget scope uses the shared Prevention period presets and bounds custom dates', () => {
  assert.deepEqual(resolveBudgetScopePeriod({ preset: 'LAST_7_DAYS' } as PreventionBudgetScopeDto, new Date('2026-10-03T12:00:00Z')),
    { start: '2026-09-27', end: '2026-10-03' });
  assert.throws(() => resolveBudgetScopePeriod({ preset: 'CUSTOM', from: '2026-10-04', to: '2026-10-03' } as PreventionBudgetScopeDto));
  const invalid = plainToInstance(PreventionBudgetScopeDto, { preset: 'ALL', severity: 'invalid' });
  assert.ok(validateSync(invalid).some((error) => error.property === 'severity'));
});

test('a read-only budget scope lookup never enqueues or creates a scenario', async () => {
  const queries: string[] = [];
  const db = { query: async (sql: string) => {
    queries.push(sql);
    return sql.includes('COUNT(DISTINCT r.id)') ? [{ totalReports: 10 }] : [];
  } };
  const budget = { enqueueBuild: async () => { throw new Error('unexpected build'); } };
  const service = new PreventionBudgetApiService(db as any, budget as any);
  const result = await service.scope({ role: UserRole.ADMIN, organizationId: 'org-a' } as any,
    { preset: 'CURRENT_YEAR', severity: 'eleve' } as PreventionBudgetScopeDto);
  assert.equal(result.totalReports, 10);
  assert.ok(queries.some((sql) => sql.includes('FROM reports r') && sql.includes('JOIN visits v') && sql.includes('v.organizationId=r.organizationId')));
  assert.equal(result.scenario, null);
  assert.ok(queries.every((sql) => sql.startsWith('SELECT')));
});

test('new budget scopes are capped per organization before any enqueue', async () => {
  let enqueued = false;
  const db = { query: async (sql: string) => {
    if (sql.includes('COUNT(DISTINCT scenarioKey)')) return [{ count: 20 }];
    return sql.includes('COUNT(DISTINCT r.id)') ? [{ totalReports: 5 }] : [];
  } };
  const service = new PreventionBudgetApiService(db as any, { enqueueBuild: async () => { enqueued = true; } } as any);
  await assert.rejects(() => service.scope({ role: UserRole.ADMIN, organizationId: 'org-a' } as any,
    { preset: 'CURRENT_YEAR' } as PreventionBudgetScopeDto, true,
    { runId: '11111111-1111-4111-8111-111111111111', executionMode: 'IMMEDIATE' }), ConflictException);
  assert.equal(enqueued, false);
});

test('budget calculation creates a tenant-scoped filtered draft and enqueues only that scope', async () => {
  const organizationId = 'org-a';
  const categoryId = '20000000-0000-4000-8000-000000000001';
  const calls: Array<{ sql: string; args: unknown[] | undefined }> = [];
  let created: Record<string, unknown> | null = null;
  const db = { query: async (sql: string, args?: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes('FROM prevention_categories')) return [{ id: categoryId }];
    if (sql.includes('COUNT(DISTINCT r.id)')) return [{ totalReports: 10 }];
    if (sql.startsWith('INSERT IGNORE INTO prevention_budget_scenarios')) {
      created = { id: args?.[0], organizationId, scenarioKey: args?.[2], version: 1, sourceVersion: args?.[3],
        periodStart: args?.[4], periodEnd: args?.[5], missionId: args?.[6], categoryId: args?.[7], severity: args?.[8], status: 'DRAFT',
        contingencyRatePercent: '0.00', retainedBudgetHt: '0.00', estimatedBudgetHt: '0.00', validatedBudgetHt: '0.00', contingencyAmountHt: '0.00', totalBudgetHt: '0.00' };
      return [];
    }
    if (sql.includes('FROM prevention_budget_scenarios')) return created ? [created] : [];
    return [];
  } };
  let enqueuedOrg = ''; let enqueuedScenario = '';
  const budget = { enqueueBuild: async (request: { organizationId: string; scenarioId: string }) => {
    enqueuedOrg = request.organizationId; enqueuedScenario = request.scenarioId;
    return { id: 'job-1', status: 'QUEUED' };
  } };
  const service = new PreventionBudgetApiService(db as any, budget as any);
  const result = await service.scope({ role: UserRole.ADMIN, organizationId } as any,
    { preset: 'CUSTOM', from: '2026-09-01', to: '2026-09-30', categoryId, severity: 'moyen' } as PreventionBudgetScopeDto, true,
    { runId: '11111111-1111-4111-8111-111111111111', executionMode: 'IMMEDIATE' });
  assert.equal(enqueuedOrg, organizationId);
  assert.equal(enqueuedScenario, result.scenario?.id);
  assert.equal(result.scenario?.severity, 'moyen');
  assert.equal(result.totalReports, 10);
  assert.equal(calls.find((call) => call.sql.startsWith('INSERT IGNORE'))?.args?.[8], 'moyen');
  assert.equal(calls.find((call) => call.sql.startsWith('INSERT IGNORE'))?.args?.[11], null);
  assert.equal(calls.find((call) => call.sql.startsWith('INSERT IGNORE'))?.args?.[12], 'BOUNDED');
});

test('client choices and budget scope are tenant-bound and selected clients persist on the draft', async () => {
  const selected = budgetClientIdentity('EDF').key;
  const calls: Array<{ sql: string; args?: unknown[] }> = [];
  let draft: any = null;
  const db = { query: async (sql: string, args?: unknown[]) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT client FROM missions')) return [{ client: 'EDF' }, { client: ' edf ' }, { client: 'ENGIE' }];
    if (sql.includes('COUNT(DISTINCT r.id)')) return [{ totalReports: 4 }];
    if (sql.startsWith('INSERT IGNORE INTO prevention_budget_scenarios')) {
      draft = { id: args?.[0], scenarioKey: args?.[2], version: 1, status: 'DRAFT',
        periodStart: args?.[4], periodEnd: args?.[5], clientKeys: args?.[9], adminPrompt: args?.[10] };
      return [];
    }
    if (sql.includes('FROM prevention_budget_scenarios')) return draft ? [draft] : [];
    return [];
  } };
  const service = new PreventionBudgetApiService(db as any, { enqueueBuild: async () => ({ id: 'job' }) } as any);
  const user = { id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any;
  const choices = await service.clients(user);
  assert.equal(choices.items.length, 2);
  const queueOptions = { runId: '11111111-1111-4111-8111-111111111111', executionMode: 'IMMEDIATE' as const };
  await assert.rejects(() => service.scope(user, { preset: 'CURRENT_YEAR', clientKeys: ['0'.repeat(64)] } as PreventionBudgetScopeDto, true, queueOptions));
  assert.equal(calls.some((call) => call.sql.startsWith('INSERT IGNORE')), false);
  const result = await service.scope(user, { preset: 'CURRENT_YEAR', clientKeys: [selected], adminPrompt: 'Deux casques si nécessaire.' } as PreventionBudgetScopeDto, true, queueOptions);
  assert.deepEqual(result.scenario?.clientKeys, [selected]);
  assert.equal(result.scenario?.adminPrompt, 'Deux casques si nécessaire.');
  assert.ok(calls.filter((call) => call.sql.startsWith('SELECT client FROM missions')).every((call) => call.args?.[0] === 'org-a'));
});

test('read-only client scope falls back to the all-client scenario without enqueueing', async () => {
  const organizationId = 'org-a';
  const clientKey = budgetClientIdentity('EDF').key;
  const allScenario = { id: 'all-scenario', scenarioKey: 'all-key', version: 3, status: 'CALCULATED', contingencyRatePercent: '0.00' };
  const calls: string[] = [];
  let scenarioQueries = 0;
  const db = { query: async (sql: string) => {
    calls.push(sql);
    if (sql.startsWith('SELECT client FROM missions')) return [{ client: 'EDF' }];
    if (sql.includes('COUNT(DISTINCT r.id)')) return [{ totalReports: 4 }];
    if (sql.includes('FROM prevention_budget_scenarios')) {
      assert.match(sql, /status<>'DRAFT'/);
      scenarioQueries += 1;
      return scenarioQueries === 2 ? [allScenario] : [];
    }
    return [];
  } };
  let enqueued = false;
  const service = new PreventionBudgetApiService(db as any, { enqueueBuild: async () => { enqueued = true; } } as any);
  const result = await service.scope({ role: UserRole.ADMIN, organizationId } as any, { preset: 'CURRENT_YEAR', clientKeys: [clientKey] } as any);
  assert.equal(result.scenario?.id, allScenario.id);
  assert.equal(scenarioQueries, 2);
  assert.equal(enqueued, false);
  assert.equal(calls.some((sql) => sql.startsWith('INSERT') || sql.startsWith('UPDATE')), false);
});

test('materialized ALL results read latest tenant rows without enqueue and deduplicate overlapping reports', async () => {
  const itemKey = 'a'.repeat(64);
  const rows = [
    { id: 'item-a', scenarioId: 'scope-a', itemKey, clientKey: 'client-edf', clientLabel: 'EDF', title: 'Casques', status: 'ESTIME', totalHt: '100.00' },
    { id: 'item-b', scenarioId: 'scope-b', itemKey, clientKey: 'client-edf', clientLabel: 'EDF', title: 'Casques', status: 'ESTIME', totalHt: '180.00' },
  ];
  const queries: string[] = [];
  const db = { query: async (sql: string, args?: unknown[]) => {
    queries.push(sql);
    if (sql.includes('SELECT i.*,s.scenarioKey,s.missionId originMissionId,s.version originVersion,s.createdAt scenarioCreatedAt')) { assert.equal(args?.[0], 'org-a'); return rows; }
    if (sql.includes('COUNT(DISTINCT r.id) totalReports')) return [{ totalReports: 15 }];
    if (sql.includes('FROM prevention_budget_item_sources src')) return [
      { itemId: 'item-a', sourceKind: 'RECOMMENDATION', sourceKey: 'f1', reportId: 'report-1', reportTitle: 'R1' },
      { itemId: 'item-b', sourceKind: 'RECOMMENDATION', sourceKey: 'f1', reportId: 'report-1', reportTitle: 'R1' },
      { itemId: 'item-b', sourceKind: 'RECOMMENDATION', sourceKey: 'f2', reportId: 'report-2', reportTitle: 'R2' },
    ];
    throw new Error(`unexpected query ${sql}`);
  } };
  const service = new PreventionBudgetApiService(db as any, { enqueueBuild: () => { throw new Error('GET must not enqueue'); } } as any);
  const result = await service.materialized({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, { preset: 'ALL' } as any);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].totalHt, '180.00');
  assert.equal(result.items[0].reportCount, 2);
  assert.equal(result.partial, true);
  assert.equal(result.totalReports, 15);
  assert.equal(result.availableTotalHt, '180.00');
  assert.ok(queries.every((sql) => !sql.includes('INSERT') && !sql.includes('UPDATE')));
});

test('materialized API omits a fully superseded unpriced action without changing persisted budgets', async () => {
  const rows = [
    { id: 'old', organizationId: 'org-a', scenarioId: 'old-scope', itemKey: 'old-action', clientKey: 'client-a', title: 'Mesure spécifique', status: 'A_CHIFFRER', totalHt: '0.00', scenarioCreatedAt: '2026-10-05T10:00:00Z' },
    { id: 'new', organizationId: 'org-a', scenarioId: 'new-scope', itemKey: 'new-action', clientKey: 'client-a', title: 'Protection et accès aux fouilles', status: 'ESTIME', totalHt: '800.00', scenarioCreatedAt: '2026-10-07T10:00:00Z', aiEstimateDetails: { sourceReportEstimates: [{ reportId: 'R1', totalHt: '800.00' }] } },
  ];
  const queries: string[] = [];
  const db = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes('SELECT i.*,s.scenarioKey,s.missionId originMissionId,s.version originVersion,s.createdAt scenarioCreatedAt')) return rows;
    if (sql.includes('COUNT(DISTINCT r.id) totalReports')) return [{ totalReports: 1 }];
    if (sql.includes('FROM prevention_budget_item_sources src')) return [
      { itemId: 'old', sourceKind: 'RECOMMENDATION', sourceKey: 'finding-1', findingId: 'F1', reportId: 'R1' },
      { itemId: 'new', sourceKind: 'RECOMMENDATION', sourceKey: 'finding-1', findingId: 'F1', reportId: 'R1' },
    ];
    throw new Error(`unexpected query ${sql}`);
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const result = await service.materialized({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, { preset: 'ALL' } as any);
  assert.deepEqual(result.items.map((item) => item.title), ['Protection et accès aux fouilles']);
  assert.equal(result.partial, true);
  assert.equal(result.availableTotalHt, '800.00');
  assert.equal(queries.some((sql) => /\b(?:INSERT|UPDATE|DELETE)\b/.test(sql)), false);
});

test('prompted materialized line creates a tenant-bound ALL action scope before recalculating only that action', async () => {
  const user = { id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any;
  const originScenarioId = '10000000-0000-4000-8000-000000000001';
  const originItemId = '20000000-0000-4000-8000-000000000001';
  const actionType = 'ppe-supply';
  const content = 'Fournir des casques de sécurité aux ouvriers.';
  const clientKey = budgetClientIdentity('EDF').key;
  const itemKey = budgetClientActionKey(clientKey, budgetActionGroup({ categoryKey: 'EPI', content, actionType }).itemKey);
  const origin = { id: originItemId, scenarioId: originScenarioId, scenarioKey: 'old-scope', originVersion: 4,
    scenarioStatus: 'CALCULATED', itemKey, clientKey, clientLabel: 'EDF',
    status: 'ESTIME', lockedManual: 0, totalHt: '250.00', categoryKey: 'EPI', title: 'Casques', priority: 'HIGH',
    quantity: '1', unit: 'FORFAIT', unitCostHt: '250.00', priceSource: 'Estimation IA' };
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  let latestOriginVersion = 4;
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith('SELECT id FROM organizations')) { assert.deepEqual(args, ['org-a']); return [{ id: 'org-a' }]; }
    if (sql.includes('SELECT i.*,s.scenarioKey,s.missionId originMissionId,s.version originVersion')) { assert.deepEqual(args, ['org-a', originScenarioId, originItemId]); return [origin]; }
    if (sql.includes('SELECT * FROM prevention_budget_scenarios WHERE id=? AND organizationId=? LIMIT 1')) return [{ id: originScenarioId, scenarioKey: 'old-scope', version: 4 }];
    if (sql.includes('FROM prevention_budget_scenarios') && sql.includes('FOR UPDATE')) {
      assert.deepEqual(args, ['org-a', 'old-scope']);
      return [{ id: latestOriginVersion === 4 ? originScenarioId : 'newer-scenario', version: latestOriginVersion }];
    }
    if (sql.includes('SELECT s.id,s.version,i.id itemId')) return [];
    if (sql.includes('SELECT f.actionType FROM prevention_budget_item_sources')) return [{ actionType }];
    if (sql.includes('FROM prevention_findings f')) {
      if ((origin as any).originMissionId) {
        assert.match(sql, /f\.missionId=\?/);
        assert.equal(args.at(-1), (origin as any).originMissionId);
        return [{ id: 'finding-1', reportId: 'report-1', sourceGroupId: 'group-1', normalizedKey: 'finding-1', content, actionType, client: 'EDF', categoryKey: 'EPI' }];
      }
      return [
      { id: 'finding-1', reportId: 'report-1', sourceGroupId: 'group-1', normalizedKey: 'finding-1', content, actionType, client: 'EDF', categoryKey: 'EPI' },
      { id: 'finding-2', reportId: 'report-2', sourceGroupId: 'group-2', normalizedKey: 'finding-2', content, actionType, client: 'EDF', categoryKey: 'EPI' },
      { id: 'finding-3', reportId: 'report-3', sourceGroupId: 'group-3', normalizedKey: 'finding-3', content, actionType, client: 'ENGIE', categoryKey: 'EPI' },
      ];
    }
    if (sql.startsWith('INSERT INTO')) { writes.push({ sql, args }); return []; }
    throw new Error(`unexpected query ${sql}`);
  } };
  const service: any = new PreventionBudgetApiService({ transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) } as any, {} as any);
  let targeted: any;
  service.recalculateItem = async (_user: unknown, scenarioId: string, itemId: string, dto: unknown) => {
    targeted = { scenarioId, itemId, dto }; return { job: { id: 'target-job' } };
  };
  const result = await service.recalculateMaterializedItem(user, originScenarioId, originItemId,
    { expectedVersion: 4, adminPrompt: 'Deux casques au maximum par rapport.' });
  assert.equal(result.job.id, 'target-job');
  assert.equal(targeted.dto.expectedVersion, 1);
  assert.equal(targeted.dto.adminPrompt, 'Deux casques au maximum par rapport.');
  assert.equal(writes.length, 4);
  assert.match(writes[0].sql, /periodMode,status,executionStatus/);
  assert.equal((writes[0].sql.match(/\?/g) ?? []).length, writes[0].args.length);
  assert.match(writes[0].sql, /VALUES \(\?,\?,\?,1,'action-bootstrap-v1',NULL,NULL,'ALL','CALCULATED','COMPLETED',0,\?,\?,\?,0,\?,\?,\?\)/);
  assert.match(writes[2].sql, /prevention_budget_item_sources/);
  await assert.rejects(() => service.recalculateMaterializedItem(user, originScenarioId, originItemId,
    { expectedVersion: 4, adminPrompt: '  ' }), BadRequestException);
  (origin as any).originMissionId = '30000000-0000-4000-8000-000000000001';
  writes.length = 0;
  await service.recalculateMaterializedItem(user, originScenarioId, originItemId,
    { expectedVersion: 4, adminPrompt: 'Recalculer uniquement ce chantier.' });
  assert.equal(writes[0].args[2], materializedActionScopeKey('org-a', itemKey, (origin as any).originMissionId));
  assert.equal(writes[0].args.at(-1), (origin as any).originMissionId);
  assert.equal(writes.length, 3);
  latestOriginVersion = 5;
  await assert.rejects(() => service.recalculateMaterializedItem(user, originScenarioId, originItemId,
    { expectedVersion: 4, adminPrompt: 'Même action après publication concurrente.' }), ConflictException);
  assert.equal(writes.length, 3);
});

test('filtered budget detail returns filtered lines and recomputed totals', async () => {
  const clientKey = budgetClientIdentity('EDF').key;
  const scenario = { id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioKey: 'budget-2026', version: 2, status: 'CALCULATED', contingencyRatePercent: '10.00' };
  const item = { id: '20000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioId: scenario.id, clientKey,
    quantity: '1.0000', unit: 'FORFAIT', unitCostHt: '100.00', totalHt: '100.00', status: 'ESTIME', lockedManual: 0, aiEstimateDetails: null };
  const db = { query: async (sql: string, args?: unknown[]) => {
    if (sql.includes('SELECT client FROM missions')) return [{ client: 'EDF' }];
    if (sql.includes('SELECT version,status FROM prevention_budget_scenarios')) return [scenario];
    if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return [scenario];
    if (sql.includes('FROM prevention_budget_items i')) { assert.match(sql, /i\.clientKey IN \(\?\)/); assert.deepEqual(args?.slice(-1)[0], [clientKey]); return [item]; }
    if (sql.includes('FROM prevention_budget_item_sources')) return [];
    return [];
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const result = await service.detail({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, scenario.id, [clientKey]);
  assert.equal(result.items.length, 1);
  assert.equal(result.scenario.retainedBudgetHt, '100.00');
  assert.equal(result.scenario.totalBudgetHt, '100.00');
  assert.deepEqual(result.scenario.filteredClientKeys, [clientKey]);
});

test('per-item recalculation rejects foreign, stale and locked items before cloning', async () => {
  const user = { id: 'admin-1', role: UserRole.ADMIN, organizationId: 'org-a' } as any;
  const base = { id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioKey: 'key', version: 2, status: 'CALCULATED' };
  const run = async (scenarioResult: any, itemResult: any) => {
    const manager = { query: async (sql: string) => {
      if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return scenarioResult;
      if (/ORDER BY version DESC LIMIT 1\s+FOR UPDATE/.test(sql)) return scenarioResult;
      if (sql.includes('FROM prevention_budget_items')) return itemResult;
      throw new Error(`unexpected query ${sql}`);
    } };
    const db = { transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) };
    const service = new PreventionBudgetApiService(db as any, {} as any);
    return service.recalculateItem(user, base.id, '20000000-0000-4000-8000-000000000001', { expectedVersion: 2 } as any);
  };
  await assert.rejects(() => run([], []), NotFoundException);
  await assert.rejects(() => run([{ ...base, version: 3 }], [{ id: 'item' }]), ConflictException);
  await assert.rejects(() => run([base], [{ id: 'item', lockedManual: 1, status: 'ESTIME' }]), ConflictException);
});

test('per-item recalculation of an ALL result clones the version and persists only the line prompt', async () => {
  const base = { id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioKey: 'key', version: 2, sourceVersion: 'source', status: 'CALCULATED', periodMode: 'ALL', periodStart: null, periodEnd: null, contingencyRatePercent: '0.00' };
  const target = { id: '20000000-0000-4000-8000-000000000001', scenarioId: base.id, itemKey: 'a'.repeat(64), title: 'Action', categoryKey: 'Hauteur', quantity: '1', unit: 'ACTION', unitCostHt: null, totalHt: '0.00', status: 'A_CHIFFRER', lockedManual: 0 };
  const updated = { ...target, id: '30000000-0000-4000-8000-000000000001', scenarioId: 'new-scenario', adminPrompt: 'Prioriser une location locale.' };
  const updates: unknown[][] = []; let enqueued: any;
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1')) return [base];
    if (sql.includes('ORDER BY version DESC LIMIT 1 FOR UPDATE')) return [base];
    if (sql.includes('SELECT version FROM prevention_budget_scenarios')) return [{ version: 2 }];
    if (sql.startsWith('SELECT * FROM prevention_budget_items WHERE organizationId=? AND scenarioId=?')) return [target];
    if (sql.startsWith('INSERT INTO prevention_budget_items')) return [];
    if (sql.startsWith('SELECT * FROM prevention_budget_item_sources')) return [];
    if (sql.startsWith('SELECT id FROM prevention_budget_items')) return [{ id: updated.id }];
    if (sql.startsWith('UPDATE prevention_budget_items SET adminPrompt')) { updates.push(args); return []; }
    if (sql.startsWith('SELECT * FROM prevention_budget_items WHERE id=?')) return [updated];
    return [];
  } };
  const db = { transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) };
  const budget = { enqueueRecalculateItem: async (payload: any) => { enqueued = payload; return { id: 'job' }; } };
  const service = new PreventionBudgetApiService(db as any, budget as any);
  const result = await service.recalculateItem({ id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any, base.id, target.id, { expectedVersion: 2, adminPrompt: 'Prioriser une location locale.' });
  assert.equal(updates[0][0], 'Prioriser une location locale.');
  assert.equal(enqueued.itemId, updated.id);
  assert.equal(result.scenario.pending, true);
});

test('a failed targeted draft retries from the prior calculated version and clones the next version', async () => {
  const completed = {
    id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioKey: 'key', version: 2,
    sourceVersion: 'source-v2', status: 'CALCULATED', periodStart: '2026-01-01', periodEnd: '2026-01-31',
    contingencyRatePercent: '0.00', retainedBudgetHt: '0.00', estimatedBudgetHt: '0.00', validatedBudgetHt: '0.00',
    contingencyAmountHt: '0.00', totalBudgetHt: '0.00', missionId: null, categoryId: null, severity: null,
  };
  const failed = { ...completed, id: '10000000-0000-4000-8000-000000000002', version: 3, status: 'DRAFT', failedAt: '2026-10-05 12:00:00' };
  const failedItem = { id: '20000000-0000-4000-8000-000000000001', scenarioId: failed.id, itemKey: 'a'.repeat(64), adminPrompt: 'Reprendre le chiffrage' };
  const completedItem = { ...failedItem, id: '20000000-0000-4000-8000-000000000002', scenarioId: completed.id, lockedManual: 0, status: 'A_CHIFFRER', adminPrompt: null };
  const copiedItem = { ...completedItem, id: '20000000-0000-4000-8000-000000000003', scenarioId: '10000000-0000-4000-8000-000000000003', adminPrompt: 'Reprendre le chiffrage' };
  const cloned = { ...completed, id: copiedItem.scenarioId, version: 4, sourceVersion: 'source-v4', status: 'DRAFT' };
  let cloneBase: any = null;
  const manager = { query: async (sql: string, args: unknown[] = []) => {
    if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1') && sql.includes('prevention_budget_scenarios')) return [failed];
    if (sql.includes('ORDER BY version DESC LIMIT 1') && sql.includes('FOR UPDATE')) return [completed];
    if (sql.includes('FROM prevention_budget_items WHERE id=?') && args[0] === failedItem.id && args[2] === failed.id) return [failedItem];
    if (sql.includes('FROM prevention_budget_items WHERE id=?') && args[0] === failedItem.id && args[2] === completed.id) return [];
    if (sql.includes('FROM prevention_budget_items WHERE itemKey=?')) return [completedItem];
    if (sql.startsWith('SELECT id FROM prevention_budget_items')) return [{ id: copiedItem.id }];
    if (sql.startsWith('UPDATE prevention_budget_items SET adminPrompt')) return [];
    if (sql.startsWith('SELECT * FROM prevention_budget_items WHERE id=?')) return [copiedItem];
    return [];
  } };
  const db = { transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) };
  const budget = { enqueueRecalculateItem: async (payload: any) => ({ id: 'job-retry', payload }) };
  const service: any = new PreventionBudgetApiService(db as any, budget as any);
  service.cloneScenario = async (_manager: any, _organizationId: string, base: any) => { cloneBase = base; return cloned; };
  const result = await service.recalculateItem(
    { id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any,
    failed.id, failedItem.id, { expectedVersion: 3 } as any,
  );
  assert.equal(cloneBase.id, completed.id);
  assert.equal(cloneBase.version, 2);
  assert.equal(result.scenario.id, cloned.id);
  assert.equal(result.scenario.version, 4);
  assert.equal(result.item.id, copiedItem.id);
});

test('an active targeted draft still blocks a duplicate recalculation', async () => {
  const completed = { id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioKey: 'key', version: 2, status: 'CALCULATED' };
  const active = { ...completed, id: '10000000-0000-4000-8000-000000000002', version: 3, status: 'DRAFT', failedAt: null };
  const manager = { query: async (sql: string) => {
    if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1') && sql.includes('prevention_budget_scenarios')) return [completed];
    if (sql.includes('ORDER BY version DESC') && sql.includes('FOR UPDATE')) return [active];
    throw new Error(`unexpected query ${sql}`);
  } };
  const db = { transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  await assert.rejects(
    () => service.recalculateItem(
      { id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any,
      completed.id, '20000000-0000-4000-8000-000000000001', { expectedVersion: 2 } as any,
    ),
    ConflictException,
  );
});

test('a stale failed targeted draft cannot bypass a newer calculated version', async () => {
  const failed = { id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a', scenarioKey: 'key', version: 3, status: 'DRAFT', failedAt: '2026-10-05 12:00:00' };
  const newer = { ...failed, id: '10000000-0000-4000-8000-000000000002', version: 4, status: 'CALCULATED', failedAt: null };
  const manager = { query: async (sql: string) => {
    if (sql.includes('WHERE id=? AND organizationId=? LIMIT 1') && sql.includes('prevention_budget_scenarios')) return [failed];
    if (sql.includes('ORDER BY version DESC') && sql.includes('FOR UPDATE')) return [newer];
    throw new Error(`unexpected query ${sql}`);
  } };
  const db = { transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  await assert.rejects(
    () => service.recalculateItem(
      { id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any,
      failed.id, '20000000-0000-4000-8000-000000000001', { expectedVersion: 3 } as any,
    ),
    ConflictException,
  );
});

test('manual budget item edit rejects a category from another tenant before cloning', async () => {
  const scenario = { id: '10000000-0000-4000-8000-000000000001', organizationId: 'org-a',
    scenarioKey: 'scope', version: 2, status: 'CALCULATED' };
  const item = { id: '20000000-0000-4000-8000-000000000001', scenarioId: scenario.id };
  const calls: string[] = [];
  const manager = { query: async (sql: string, args?: unknown[]) => {
    calls.push(sql);
    if (sql.includes('FROM prevention_budget_scenarios')) return [scenario];
    if (sql.includes('FROM prevention_budget_items')) return [item];
    if (sql.includes('FROM prevention_categories')) {
      assert.deepEqual(args, ['30000000-0000-4000-8000-000000000001', 'org-a']);
      return [];
    }
    throw new Error('unexpected write');
  } };
  const db = { transaction: async (callback: (tx: typeof manager) => Promise<unknown>) => callback(manager) };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  await assert.rejects(() => service.patchItem(
    { id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any,
    scenario.id, item.id,
    { expectedVersion: 2, categoryId: '30000000-0000-4000-8000-000000000001' } as any,
  ), BadRequestException);
  assert.ok(calls.every((sql) => !sql.startsWith('INSERT') && !sql.startsWith('UPDATE')));
});

test('human validation of an ALL budget line updates exact totals without full AI recalculation', async () => {
  const base = { id: 'scenario-old', organizationId: 'org-a', scenarioKey: 'scope', version: 2,
    status: 'CALCULATED', periodMode: 'ALL', contingencyRatePercent: '10.00',
    retainedBudgetHt: '150.00', estimatedBudgetHt: '150.00', validatedBudgetHt: '0.00',
    contingencyAmountHt: '15.00', totalBudgetHt: '165.00' };
  const target = { id: 'item-old', scenarioId: base.id, itemKey: 'a'.repeat(64), title: 'Casques',
    categoryId: null, categoryKey: 'EPI', quantity: '1.0000', unit: 'UNITE', unitCostHt: '100.00',
    totalHt: '100.00', priceSource: 'Estimation IA', status: 'ESTIME', priority: 'HIGH',
    justification: null, lockedManual: 0 };
  const writes: Array<{ sql: string; args?: unknown[] }> = [];
  const manager = { query: async (sql: string, args?: unknown[]) => {
    if (sql.includes('FROM prevention_budget_scenarios')) return [base];
    if (sql.includes('FROM prevention_budget_items') && sql.includes('WHERE id=?') && args?.[0] === 'item-old') return [target];
    if (sql.startsWith('SELECT id,totalHt,status FROM prevention_budget_items')) return [
      { id: target.id, totalHt: target.totalHt, status: target.status },
      { id: 'item-other', totalHt: '50.00', status: 'ESTIME' },
    ];
    if (sql.includes('FROM prevention_budget_items') && sql.includes('itemKey=?')) return [{ ...target, id: 'item-new', scenarioId: 'scenario-new' }];
    if (sql.includes('FROM prevention_budget_items') && args?.[0] === 'item-new') return [{ ...target, id: 'item-new', scenarioId: 'scenario-new', totalHt: '200.00', status: 'VALIDE' }];
    writes.push({ sql, args });
    return [];
  } };
  const service: any = new PreventionBudgetApiService({ transaction: async (callback: (tx: any) => Promise<unknown>) => callback(manager) } as any,
    { enqueueRecalculate: async () => { throw new Error('unexpected AI enqueue'); } } as any);
  let cloneOptions: any;
  service.cloneScenario = async (_tx: any, _org: string, _base: any, _actor: string, options: any) => {
    cloneOptions = options;
    return { ...base, ...options.totals, id: 'scenario-new', version: 3, status: options.status };
  };
  const result = await service.patchItem({ id: 'admin', role: UserRole.ADMIN, organizationId: 'org-a' } as any,
    base.id, target.id, { expectedVersion: 2, quantity: '2', unitCostHt: '100.00',
      priceSource: 'Devis fournisseur', status: 'VALIDE', lockedManual: true } as any);
  assert.equal(cloneOptions.status, 'CALCULATED');
  assert.deepEqual(cloneOptions.totals, { retainedBudgetHt: '250.00', estimatedBudgetHt: '50.00',
    validatedBudgetHt: '200.00', contingencyAmountHt: '0.00', totalBudgetHt: '250.00' });
  assert.equal(result.job, null);
  assert.equal(result.scenario.totalBudgetHt, '250.00');
  const itemUpdate = writes.find((entry) => entry.sql.startsWith('UPDATE prevention_budget_items SET title='));
  assert.equal(itemUpdate?.args?.[6], '200.00');
});

test('ALL has a stable unbounded identity and cannot reuse a bounded key', () => {
  const all = resolveBudgetPeriod({ preset: 'ALL' } as any, new Date('2026-01-02T00:00:00Z'));
  const allLater = resolveBudgetPeriod({ preset: 'ALL' } as any, new Date('2036-01-02T00:00:00Z'));
  assert.deepEqual(all, { start: null, end: null, periodMode: 'ALL' });
  assert.deepEqual(allLater, all);
  const key = preventionBudgetScopeKey('org-a', 'ALL', all, null, null, []);
  const boundedKey = preventionBudgetScopeKey('org-a', 'BOUNDED', { start: '2026-01-01', end: '2026-12-31' }, null, null, []);
  assert.notEqual(key, boundedKey);
  assert.notEqual(key, preventionBudgetScopeKey('org-a', 'ALL', all, null, null, [], '10000000-0000-4000-8000-000000000001'));
  assert.deepEqual(resolveBudgetPeriod({ mode: 'FILTERED', preset: 'CUSTOM', from: '2026-02-01', to: '2026-02-10' } as any), {
    start: '2026-02-01', end: '2026-02-10', periodMode: 'BOUNDED',
  });
  assert.throws(() => resolveBudgetPeriod({ mode: 'GLOBAL_YEARLY', preset: 'CURRENT_YEAR' } as any), BadRequestException);
  assert.throws(() => resolveBudgetPeriod({ mode: 'FILTERED', preset: 'ALL' } as any), BadRequestException);
  assert.notEqual(
    preventionBudgetAnnualScenarioKey('44444444-4444-4444-8444-444444444444', key, 2026),
    preventionBudgetAnnualScenarioKey('55555555-5555-4555-8555-555555555555', key, 2026),
  );
});

test('global preview is tenant scoped, unbounded and exposes volume thresholds without a date predicate', async () => {
  const sqls: string[] = [];
  const db = { query: async (sql: string) => {
    sqls.push(sql);
    if (sql.startsWith('SELECT client FROM missions')) return [{ client: 'EDF' }];
    if (sql.includes('FROM prevention_findings f')) return [{ year: 2024, reportCount: 2, recommendationCount: 5, estimationWorkloadCount: 2 }];
    return [];
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const result = await service.preview({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, {
    mode: PreventionBudgetExecutionModeDto.GLOBAL_YEARLY,
  } as PreventionBudgetPreviewDto);
  assert.equal(result.periodMode, 'ALL');
  assert.deepEqual(result.period, { start: null, end: null });
  assert.equal(result.totals.recommendationCount, 5);
  assert.equal(result.threshold.decision, 'IMMEDIATE');
  assert.match(result.confirmationToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(sqls.every((sql) => !sql.includes('f.businessDate BETWEEN')));
  assert.ok(sqls.some((sql) => sql.includes("f.organizationId=?") && sql.includes("f.findingType='RECOMMENDATION'")));
});

test('filtered preview keeps bounded dates and selected client/category/severity predicates', async () => {
  const sqls: string[] = [];
  const selected = budgetClientIdentity('EDF').key;
  const db = { query: async (sql: string) => {
    sqls.push(sql);
    if (sql.startsWith('SELECT client FROM missions')) return [{ client: 'EDF' }];
    if (sql.includes('FROM prevention_categories')) return [{ id: '30000000-0000-4000-8000-300000000001' }];
    if (sql.includes('FROM prevention_findings f')) return [{ year: 2026, reportCount: 1, recommendationCount: 2, estimationWorkloadCount: 1 }];
    return [];
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const result = await service.preview({ role: UserRole.ADMIN, organizationId: 'org-a' } as any, {
    mode: PreventionBudgetExecutionModeDto.FILTERED, preset: 'CUSTOM', from: '2026-02-01', to: '2026-02-28',
    clientKeys: [selected], categoryId: '30000000-0000-4000-8000-300000000001', severity: 'critique',
  } as any);
  assert.equal(result.periodMode, 'BOUNDED');
  assert.deepEqual(result.period, { start: '2026-02-01', end: '2026-02-28' });
  const findingSql = sqls.find((sql) => sql.includes('FROM prevention_findings f')) ?? '';
  assert.match(findingSql, /f\.businessDate>=\?/);
  assert.match(findingSql, /f\.categoryId=\?/);
  assert.match(findingSql, /LOWER\(TRIM\(m\.client\)\)/);
  assert.match(findingSql, /riskLevel='eleve'/);
});

test('GLOBAL_YEARLY command reuses one active run and persists a durable deferred job', async () => {
  const organizationId = 'org-a';
  const queryCalls: string[] = [];
  let activeRun: any = null;
  let runInsertCount = 0;
  const sourceRow = { reportCount: 1, reportUpdatedAt: '2026-01-01', findingCount: 2, findingCreatedAt: '2026-01-02', catalogVersion: 1 };
  const db: any = {
    query: async (sql: string, args?: unknown[]) => {
      queryCalls.push(sql);
      if (sql.startsWith('SELECT client FROM missions')) return [];
      if (sql.includes('FROM prevention_findings f')) return [{ year: 2026, reportCount: 1, recommendationCount: 2, estimationWorkloadCount: 1 }];
      if (sql.includes('catalogVersion')) return [sourceRow];
      if (sql.includes('FROM prevention_budget_global_runs') && sql.includes("status IN ('PENDING','PROCESSING','SUSPENDED')")) return activeRun ? [activeRun] : [];
      if (sql.includes('FROM prevention_budget_global_runs') && sql.includes('status=\'PUBLISHED\'')) return [];
      if (sql.includes('SELECT * FROM prevention_budget_global_runs')) return [{ id: activeRun?.id, status: activeRun?.status ?? 'PENDING', executionMode: 'IMMEDIATE', scenarioKey: 'scope', sourceVersion: activeRun?.sourceVersion }];
      if (sql.includes('SELECT y.year,s.id scenarioId')) return [{ year: 2026, scenarioId: '55555555-5555-4555-8555-555555555555', version: 1 }];
      return [];
    },
    transaction: async (callback: (manager: any) => Promise<void>) => callback({ query: async (sql: string, args?: unknown[]) => {
      queryCalls.push(sql);
      if (sql.includes('SELECT id,status FROM prevention_budget_global_runs')) return activeRun ? [activeRun] : [];
      if (sql.startsWith('INSERT INTO prevention_budget_global_runs')) {
        runInsertCount += 1;
        activeRun = { id: String(args?.[0]), status: 'PENDING', sourceVersion: await loadPreventionBudgetSourceVersion(db, organizationId) };
      }
      return [];
    } }),
  };
  const budget: any = {
    enqueueGlobalYear: async (payload: any) => ({ id: 'prevention-budget-annual-1', name: 'prevention.budget.global-year', status: 'QUEUED', scenarioId: payload.scenarioId, scenarioVersion: payload.scenarioVersion }),
    globalRunStatus: async (_org: string, id: string) => ({ id, status: 'PENDING', completedYears: 0, totalYears: 1 }),
  };
  const admission = { admit: async () => ({ admitted: false, availableAt: new Date(Date.now() + 60_000).toISOString(), reason: 'OUTSIDE_WINDOW' }) };
  const service = new PreventionBudgetApiService(db, budget, undefined, undefined, admission as any);
  const user = { role: UserRole.ADMIN, organizationId } as any;
  const confirmation = await service.preview(user, { mode: PreventionBudgetExecutionModeDto.GLOBAL_YEARLY } as any);
  const dto = { mode: PreventionBudgetExecutionModeDto.GLOBAL_YEARLY, confirmationToken: confirmation.confirmationToken } as any;
  const first = await service.command(user, dto);
  activeRun.status = 'SUSPENDED';
  const second = await service.command(user, dto);
  assert.equal(first.status, 'DEFERRED');
  assert.equal(first.job.id, first.runId);
  assert.equal(first.queueJobId, 'prevention-budget-annual-1');
  assert.equal(second.runId, first.runId);
  assert.equal(runInsertCount, 1);
  assert.ok(queryCalls.some((sql) => sql.includes('INSERT IGNORE INTO prevention_budget_global_years')));
});

test('budget confirmation rejects a changed measured volume before any calculation', async () => {
  let reports = 1;
  const db = { query: async (sql: string) => {
    if (sql.startsWith('SELECT client FROM missions')) return [];
    if (sql.includes('FROM prevention_findings f')) return [{ year: 2026, reportCount: reports,
      recommendationCount: reports, estimationWorkloadCount: reports }];
    return [];
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const user = { role: UserRole.ADMIN, organizationId: 'org-a' } as any;
  const request = { mode: PreventionBudgetExecutionModeDto.CURRENT_YEAR } as any;
  const measured = await service.preview(user, request);
  assert.equal(measured.threshold.decision, 'IMMEDIATE');
  reports = 251;
  await assert.rejects(() => service.command(user, { ...request, confirmationToken: measured.confirmationToken }),
    (error: unknown) => error instanceof ConflictException &&
      (error.getResponse() as any).preview.threshold.decision === 'NIGHT_ONLY');
});

test('budget confirmation token cannot be replayed by another organization or after a window change', async () => {
  const db = { query: async (sql: string) => {
    if (sql.startsWith('SELECT client FROM missions')) return [];
    if (sql.includes('FROM prevention_findings f')) return [{ year: 2026, reportCount: 1,
      recommendationCount: 1, estimationWorkloadCount: 1 }];
    return [];
  } };
  const service = new PreventionBudgetApiService(db as any, {} as any);
  const firstAdmin = { role: UserRole.ADMIN, organizationId: 'org-a' } as any;
  const secondAdmin = { role: UserRole.ADMIN, organizationId: 'org-b' } as any;
  const request = { mode: PreventionBudgetExecutionModeDto.CURRENT_YEAR } as any;
  const measured = await service.preview(firstAdmin, request);
  await assert.rejects(() => service.command(secondAdmin, { ...request, confirmationToken: measured.confirmationToken }), ConflictException);
  const originalPreview = service.preview.bind(service);
  (service as any).preview = async (...args: any[]) => {
    const fresh = await originalPreview(args[0], args[1]);
    return { ...fresh, windowKey: 'different-window', confirmationDigest: 'different-digest' };
  };
  await assert.rejects(() => service.command(firstAdmin, { ...request, confirmationToken: measured.confirmationToken }), ConflictException);
});
