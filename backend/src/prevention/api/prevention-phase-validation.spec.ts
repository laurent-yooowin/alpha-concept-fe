import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../user/user.entity';
import { PreventionPhaseValidationService } from './prevention-phase-validation.service';

const user = { id: 'user-a', role: UserRole.USER, organizationId: 'org-a' } as any;

const analyzedPhotos = [{
  id: 'photo-a', groupId: 'g-a',
  analysis: { observation: ['Structure visible'], recommendation: ['Sécuriser'] },
}];

function serviceFor(
  group: any = { id: 'group-a', proposedPhase: 'GROS_OEUVRE', effectivePhase: 'GROS_OEUVRE', status: 'PROPOSED', confidence: '85', justification: 'Structure visible', source: 'PHOTO', modelVersion: null },
  visit: any = { id: 'visit-a', organizationId: 'org-a', missionId: 'mission-a', userId: 'user-a', photos: analyzedPhotos },
  processing: any = { sourceHash: 'a'.repeat(64), processingStatus: 'READY', proposedPhase: 'GROS_OEUVRE', confidence: '85', justification: 'Structure visible', riskAssessments: [] },
  customPhases: Array<{ code: string; label: string; labelKey: string }> = [],
  createdToday = 0,
) {
  const calls: any[] = [];
  const manager = {
    query: async (sql: string, args: unknown[]) => {
      calls.push({ sql, args });
      if (sql.includes('FROM users WHERE')) return [{ id: user.id }];
      if (sql.includes('FROM visits v')) return visit ? [visit] : [];
      if (sql.includes('FROM prevention_group_processing_jobs')) return processing ? [processing] : [];
      if (sql.startsWith('SELECT g.id')) return group ? [group] : [];
      if (sql.startsWith('INSERT INTO prevention_phase_catalog')) {
        if (!customPhases.some((row) => row.labelKey === args[2])) customPhases.push({
          code: String(args[0]), label: String(args[1]), labelKey: String(args[2]),
        });
        return [];
      }
      if (sql.includes('FROM prevention_phase_catalog WHERE labelKey=')) return customPhases.filter((row) => row.labelKey === args[0]);
      if (sql.includes('FROM prevention_phase_catalog WHERE code=')) return customPhases.filter((row) => row.code === args[0]);
      if (sql.includes('COUNT(*) AS count FROM prevention_phase_catalog')) return [{ count: createdToday }];
      return [];
    },
  };
  const db = { transaction: async (work: (manager: any) => Promise<unknown>) => work(manager),
    query: async (sql: string) => sql.includes('FROM prevention_phase_catalog') ? customPhases : [] };
  return { service: new PreventionPhaseValidationService(db as any, { assertEnabled: async () => undefined } as any,
    { matchesCurrentSource: () => false, markValidated: async () => undefined } as any), calls };
}

test('phase validation is tenant scoped and preserves report content', async () => {
  const { service, calls } = serviceFor();
  const result = await service.validate(user, 'visit-a', 'g-a', { phase: 'FINITIONS_EXTERIEURES' } as any);
  assert.equal(result.status, 'VALIDATED');
  assert.equal(result.effectivePhase, 'FINITIONS_EXTERIEURES');
  assert.ok(calls.some((call) => call.sql.includes('organizationId=?')));
  assert.ok(!calls.some((call) => call.sql.includes('UPDATE reports')));
});

test('phase validation rejects a user who does not own the visit', async () => {
  const { service } = serviceFor(undefined, { id: 'visit-a', organizationId: 'org-a', missionId: 'mission-a', userId: 'other-user', photos: analyzedPhotos });
  await assert.rejects(() => service.validate(user, 'visit-a', 'g-a', { phase: 'GROS_OEUVRE' } as any), ForbiddenException);
});

test('an organization admin can revise an already validated phase', async () => {
  const { service, calls } = serviceFor({ id: 'group-a', proposedPhase: 'GROS_OEUVRE', status: 'VALIDATED', confidence: '85', justification: 'Structure visible', source: 'PHOTO' });
  const result = await service.validate({ ...user, role: UserRole.ADMIN } as any, 'visit-a', 'g-a', { phase: 'SECOND_OEUVRE' } as any);
  assert.equal(result.status, 'VALIDATED');
  assert.ok(calls.some((call) => call.sql.includes('UPDATE prevention_analysis_groups')));
});

test('phase validation before report extraction persists the choice only in Prevention', async () => {
  const { service, calls } = serviceFor(null);
  const result = await service.validate(user, 'visit-a', 'g-a', { phase: 'INSTALLATION_ELECTRIQUE' } as any);
  assert.equal(result.id, null);
  assert.ok(!calls.some((call) => call.sql.includes('UPDATE visits')));
  assert.ok(!calls.some((call) => call.sql.includes('UPDATE reports')));
});

test('a later photo edit does not block confirmation of a completed phase', async () => {
  const { service } = serviceFor();
  const result = await service.validate(user, 'visit-a', 'g-a', { phase: 'SECOND_OEUVRE' } as any);
  assert.equal(result.effectivePhase, 'SECOND_OEUVRE');
});

test('phase validation rejects a missing or unfinished durable Prevention assessment', async () => {
  for (const processing of [null, { sourceHash: 'a'.repeat(64), processingStatus: 'PENDING', proposedPhase: 'GROS_OEUVRE' }]) {
    const { service, calls } = serviceFor(undefined, undefined, processing);
    await assert.rejects(() => service.validate(user, 'visit-a', 'g-a', { phase: 'GROS_OEUVRE' } as any), BadRequestException);
    await assert.rejects(() => service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: 'Phase annexe' } as any), BadRequestException);
    assert.ok(!calls.some((call) => call.sql.includes('INSERT INTO prevention_phase_catalog')));
  }
});

test('a coordinator can add a global custom phase and validate only the owned group', async () => {
  const customPhases: Array<{ code: string; label: string; labelKey: string }> = [];
  const { service, calls } = serviceFor(undefined, undefined, undefined, customPhases);
  const result = await service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: '  Préparation   de site ' } as any);
  assert.match(result.effectivePhase, /^CUSTOM_[0-9a-f-]{36}$/);
  assert.equal(result.effectivePhaseLabel, 'Préparation de site');
  assert.equal(customPhases.length, 1);
  assert.equal(customPhases[0].labelKey, 'preparation de site');
  assert.ok(calls.some((call) => call.sql.includes('UPDATE prevention_analysis_groups') && call.args[0] === result.effectivePhase));
  assert.ok(!calls.some((call) => call.sql.includes('UPDATE reports')));
  const catalog = await service.catalog(user);
  assert.ok(catalog.some((option) => option.value === result.effectivePhase && option.label === result.effectivePhaseLabel));
  const otherOrganizationCatalog = await service.catalog({ ...user, organizationId: 'org-b' } as any);
  assert.ok(otherOrganizationCatalog.some((option) => option.value === result.effectivePhase));
});

test('duplicate normalized labels reuse one global catalog entry', async () => {
  const customPhases: Array<{ code: string; label: string; labelKey: string }> = [];
  const { service } = serviceFor(undefined, undefined, undefined, customPhases);
  const first = await service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: 'Préparation de site' } as any);
  const second = await service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: 'preparation de SITE' } as any);
  assert.equal(second.effectivePhase, first.effectivePhase);
  assert.equal(customPhases.length, 1);
});

test('invalid custom labels and unauthorized visits cannot create a global phase', async () => {
  const { service, calls } = serviceFor();
  for (const input of [
    { customPhaseLabel: 'Gros oeuvre' },
    { customPhaseLabel: '<script>' },
    { phase: 'SECOND_OEUVRE', customPhaseLabel: 'Phase annexe' },
    { phase: 'CUSTOM_00000000-0000-0000-0000-000000000000' },
  ]) {
    await assert.rejects(() => service.validate(user, 'visit-a', 'g-a', input as any), BadRequestException);
  }
  assert.ok(!calls.some((call) => call.sql.includes('INSERT INTO prevention_phase_catalog')));
  const unauthorized = serviceFor(undefined, { id: 'visit-a', organizationId: 'org-a', missionId: 'mission-a', userId: 'other-user', photos: analyzedPhotos });
  await assert.rejects(() => unauthorized.service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: 'Phase annexe' } as any), ForbiddenException);
  assert.ok(!unauthorized.calls.some((call) => call.sql.includes('INSERT INTO prevention_phase_catalog')));
});

test('catalog creation is rate limited without blocking reuse of an existing phase', async () => {
  const custom = [{ code: 'CUSTOM_00000000-0000-4000-8000-000000000001', label: 'Préparation de site', labelKey: 'preparation de site' }];
  const { service } = serviceFor(undefined, undefined, undefined, custom, 20);
  await assert.rejects(() => service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: 'Autre étape' } as any),
    (error: any) => error.getStatus?.() === 429);
  const result = await service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: 'preparation de SITE' } as any);
  assert.equal(result.effectivePhase, custom[0].code);
});

test('concurrent custom phases from one user cannot exceed the daily quota', async () => {
  const phases: Array<{ code: string; label: string; labelKey: string }> = [];
  let releasePrevious: Promise<void> = Promise.resolve();
  const db = { transaction: async (work: (manager: any) => Promise<unknown>) => {
    let unlock: (() => void) | undefined;
    const manager = { query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('FROM users WHERE')) {
        const prior = releasePrevious;
        releasePrevious = new Promise<void>((resolve) => { unlock = resolve; });
        await prior;
        return [{ id: user.id }];
      }
      if (sql.includes('FROM visits v')) return [{ userId: user.id, photos: [
        { groupId: 'g-a', analysis: {} }, { groupId: 'g-b', analysis: {} },
      ] }];
      if (sql.includes('FROM prevention_group_processing_jobs')) return [{
        processingStatus: 'READY', proposedPhase: 'GROS_OEUVRE', confidence: '85',
      }];
      if (sql.includes('FROM prevention_phase_catalog WHERE labelKey=')) {
        return phases.filter((phase) => phase.labelKey === args[0]);
      }
      if (sql.includes('COUNT(*) AS count FROM prevention_phase_catalog')) return [{ count: 19 + phases.length }];
      if (sql.startsWith('INSERT INTO prevention_phase_catalog')) {
        phases.push({ code: String(args[0]), label: String(args[1]), labelKey: String(args[2]) });
      }
      return [];
    } };
    try { return await work(manager); } finally { unlock?.(); }
  } };
  const service = new PreventionPhaseValidationService(db as any,
    { assertEnabled: async () => undefined } as any,
    { markValidated: async () => undefined } as any);
  const results = await Promise.allSettled([
    service.validate(user, 'visit-a', 'g-a', { customPhaseLabel: 'Phase préparatoire' } as any),
    service.validate(user, 'visit-b', 'g-b', { customPhaseLabel: 'Phase de démontage' } as any),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(phases.length, 1);
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.getStatus?.(), 429);
});

test('group status resolves a global custom label without exposing catalog provenance', async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const code = 'CUSTOM_00000000-0000-4000-8000-000000000001';
  const db = { query: async (sql: string, args: unknown[]) => {
    calls.push({ sql, args });
    if (sql.includes('FROM visits WHERE')) return [{ userId: 'user-a' }];
    if (sql.includes('FROM prevention_group_processing_jobs j')) return [{
      sourceGroupId: 'g-a', processingStatus: 'READY', phaseStatus: 'VALIDATED',
      proposedPhase: 'GROS_OEUVRE', effectivePhase: code, customPhaseLabel: 'Préparation de site',
      confidence: '85', justification: 'Choix humain', attempts: 1,
    }];
    return [];
  } };
  const service = new PreventionPhaseValidationService(db as any, { assertEnabled: async () => undefined } as any);
  const status = await service.status(user, 'visit-a', 'g-a');
  assert.equal(status.effectivePhaseLabel, 'Préparation de site');
  assert.equal(status.proposedPhaseLabel, 'Gros œuvre');
  assert.ok(!('customPhaseLabel' in status));
  assert.deepEqual(calls[calls.length - 1]?.args, ['org-a', 'visit-a', 'g-a']);
});
