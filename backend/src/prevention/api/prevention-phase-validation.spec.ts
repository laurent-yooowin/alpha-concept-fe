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
) {
  const calls: any[] = [];
  const manager = {
    query: async (sql: string, args: unknown[]) => {
      calls.push({ sql, args });
      if (sql.includes('FROM visits v')) return visit ? [visit] : [];
      if (sql.includes('FROM prevention_group_processing_jobs')) return processing ? [processing] : [];
      if (sql.startsWith('SELECT g.id')) return group ? [group] : [];
      return [];
    },
  };
  const db = { transaction: async (work: (manager: any) => Promise<unknown>) => work(manager) };
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
    const { service } = serviceFor(undefined, undefined, processing);
    await assert.rejects(() => service.validate(user, 'visit-a', 'g-a', { phase: 'GROS_OEUVRE' } as any), BadRequestException);
  }
});
