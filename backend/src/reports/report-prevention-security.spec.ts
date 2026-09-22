import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';
import {
  ReportService,
  reportAnalyticalFingerprint,
  resolveReportOrganizationId,
} from './report.service';

test('report relation validation rejects a cross-tenant visit', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const manager = {
    getRepository(entity: unknown) {
      if (entity === Mission) {
        return { findOneBy: async () => ({ id: 'mission-a', organizationId: 'org-a' }) };
      }
      if (entity === Visit) {
        return { findOneBy: async () => null };
      }
      throw new Error('Unexpected repository');
    },
  };

  await assert.rejects(
    () => (service as any).assertReportRelationsInOrganization(
      manager,
      'org-a',
      'mission-a',
      'visit-from-org-b',
    ),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test('legacy report events use the authorized visit tenant', () => {
  assert.equal(
    resolveReportOrganizationId({
      organizationId: 'stale-org-b',
      visit: { organizationId: 'authorized-org-a' },
    }),
    'authorized-org-a',
  );
});

test('technical or identical updates keep the analytical fingerprint', () => {
  const report = {
    missionId: 'mission-a', visitId: 'visit-a', title: 'Report', content: 'Finding',
    status: 'brouillon' as any, conformityPercentage: 50, observations: 'Observation',
    remarquesAdmin: 'Review', reportFileUrl: 'old.pdf', recipientEmail: 'old@example.test',
  };
  const before = reportAnalyticalFingerprint(report);
  assert.equal(
    reportAnalyticalFingerprint({
      ...report,
      reportFileUrl: 'new.pdf',
      recipientEmail: 'new@example.test',
      updatedAt: new Date(),
    }),
    before,
  );
});

test('a meaningful report change creates a new analytical fingerprint', () => {
  const report = { missionId: 'm', visitId: 'v', title: 'R', content: 'Before' };
  assert.notEqual(
    reportAnalyticalFingerprint(report),
    reportAnalyticalFingerprint({ ...report, content: 'After' }),
  );
});

test('outbox upsert is skipped for an unchanged analytical version', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  let enqueued = 0;
  (service as any).enqueueReportUpsert = async () => { enqueued += 1; };
  const report = { id: 'r', organizationId: 'o', content: 'Stable', title: 'Report' };
  const fingerprint = reportAnalyticalFingerprint(report);
  await (service as any).enqueueReportUpsertIfChanged({}, report, fingerprint);
  assert.equal(enqueued, 0);
  await (service as any).enqueueReportUpsertIfChanged(
    {},
    { ...report, content: 'Changed' },
    fingerprint,
  );
  assert.equal(enqueued, 1);
});
