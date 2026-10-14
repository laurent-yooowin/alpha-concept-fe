import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';
import { VisitService } from '../visits/visit.service';
import { UserRole } from '../user/user.entity';
import {
  ReportService,
  reportAnalyticalFingerprint,
  resolveReportOrganizationId,
} from './report.service';
import { UpdateReportDto } from './report.dto';

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

test('report lookup rejects a stale tenant match when the linked visit belongs to another tenant', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  (service as any).reportRepository = {
    findOne: async () => ({
      id: 'report-a', organizationId: 'org-a', userId: 'user-a',
      visit: { id: 'visit-b', organizationId: 'org-b', userId: 'user-b' },
      mission: { organizationId: 'org-b' },
    }),
  };
  await assert.rejects(
    service.findOne('report-a', { id: 'user-a', organizationId: 'org-a', role: UserRole.ADMIN } as any),
    NotFoundException,
  );
});

test('report lookup permits an authorized visit despite stale report tenant metadata', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const linkedReport = {
    id: 'report-a', organizationId: 'stale-org', userId: 'stale-user',
    visit: { id: 'visit-a', organizationId: 'org-a', userId: 'user-a' },
    mission: { organizationId: 'org-a' },
  };
  (service as any).reportRepository = { findOne: async (options: any) =>
    options.where.organizationId ? null : linkedReport };
  const result = await service.findOne('report-a', { id: 'user-a', organizationId: 'org-a', role: UserRole.USER } as any);
  assert.equal(result, linkedReport);
});

test('report status summaries use the authorized visit even with stale report tenant metadata', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const calls: Array<{ method: string; args: any[] }> = [];
  const query = {
    innerJoin: (...args: any[]) => { calls.push({ method: 'innerJoin', args }); return query; },
    where: (...args: any[]) => { calls.push({ method: 'where', args }); return query; },
    select: (...args: any[]) => { calls.push({ method: 'select', args }); return query; },
    getMany: async () => [{ id: 'report-a', visitId: 'visit-a', status: 'envoye_au_client', organizationId: null }],
  };
  (service as any).reportRepository = { createQueryBuilder: (alias: string) => {
    assert.equal(alias, 'report');
    return query;
  } };
  const reports = await service.findStatusSummariesForVisits([
    { id: 'visit-a', organizationId: 'org-a', userId: 'user-a' },
    { id: 'visit-other-user', organizationId: 'org-a', userId: 'user-b' },
    { id: 'visit-other-tenant', organizationId: 'org-b', userId: 'user-a' },
  ] as Visit[], { id: 'user-a', organizationId: 'org-a', role: UserRole.USER } as any);

  assert.equal(reports[0].status, 'envoye_au_client');
  assert.equal(calls[0].method, 'innerJoin');
  assert.equal(calls[0].args[0], Visit);
  assert.match(calls[0].args[2], /linkedVisit\.organizationId = :organizationId/);
  assert.deepEqual(calls[0].args[3], { organizationId: 'org-a' });
  assert.equal(calls[1].method, 'where');
  assert.deepEqual(calls[1].args[1], { visitIds: ['visit-a'] });
  assert.deepEqual(calls[2].args[0], ['report.id', 'report.visitId', 'report.status', 'report.createdAt']);
});

test('report status summaries do not query without an authorized visit', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  (service as any).reportRepository = { createQueryBuilder: () => { throw new Error('Unexpected report read'); } };
  const reports = await service.findStatusSummariesForVisits([
    { id: 'visit-other-user', organizationId: 'org-a', userId: 'user-b' },
  ] as Visit[], { id: 'user-a', organizationId: 'org-a', role: UserRole.USER } as any);
  assert.deepEqual(reports, []);
});

test('report list retains the visit business date for Web report details', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  (service as any).reportRepository = { find: async () => [{
    id: 'report-a', missionId: 'mission-a',
    visit: { photos: [], photoCount: 0, createdAt: new Date('2026-09-29T08:00:00Z'), visitDate: new Date('2026-09-30T08:00:00Z') },
  }] };
  const reports = await service.findAll({ organizationId: 'org-a', role: UserRole.ADMIN } as any);
  assert.equal(reports[0].visit.visitDate.toISOString(), '2026-09-30T08:00:00.000Z');
});

test('sending an existing PDF checks its report tenant relation before download', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const user = { organizationId: 'org-a' } as any;
  const report = { id: 'report-a', visitId: 'visit-a', organizationId: 'org-a', reportFileUrl: 'https://example.test/report.pdf' };
  const calls: string[] = [];
  (service as any).findOne = async () => report;
  (service as any).uploadedAssets = {
    assertReportAccess: async (_user: unknown, url: string, reportId: string) => {
      assert.equal(url, report.reportFileUrl);
      assert.equal(reportId, report.id);
      calls.push('authorized');
    },
  };
  (service as any).reportPdfTemplateService = {
    generate: async () => {
      calls.push('downloaded');
      return { url: report.reportFileUrl, key: 'report.pdf', size: 4,
        fileName: 'report.pdf', pdf: Buffer.from('%PDF'), cached: true };
    },
  };
  (service as any).dataSource = pdfTransactionFixture(report);

  await (service as any).generateAndStorePdfArtifact(report.id, user, 'report.pdf', false, true);
  assert.deepEqual(calls, ['authorized', 'downloaded']);
});

test('read-only user resolves an existing PDF without regenerating or updating the report', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const user = { organizationId: 'org-a', permissions: { reports: 'read' } } as any;
  const report = { id: 'report-a', visitId: 'visit-a', organizationId: 'org-a', reportFileUrl: 'https://example.test/current.pdf' };
  const calls: string[] = [];
  (service as any).findOne = async () => report;
  (service as any).uploadedAssets = { assertReportAccess: async () => { calls.push('authorized'); } };
  (service as any).reportPdfTemplateService = {
    generate: async (_report: unknown, _name: string, force: boolean, preferExisting: boolean) => {
      assert.equal(force, false);
      assert.equal(preferExisting, true);
      calls.push('reused');
      return { url: report.reportFileUrl, key: 'current.pdf', size: 4, fileName: 'rapport.pdf', pdf: Buffer.from('%PDF'), cached: true };
    },
  };
  (service as any).reportRepository = { update: async () => { throw new Error('must not update'); } };
  (service as any).dataSource = pdfTransactionFixture(report);

  const result = await service.resolveCurrentPdf(report.id, user, 'rapport.pdf');
  assert.equal(result.base64, Buffer.from('%PDF').toString('base64'));
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(result.cached, true);
  assert.deepEqual(calls, ['authorized', 'reused']);
});

test('read-only user cannot trigger PDF generation when no current artifact exists', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  (service as any).findOne = async () => ({ id: 'report-a', reportFileUrl: null });
  (service as any).reportPdfTemplateService = { generate: async () => { throw new Error('must not render'); } };

  await assert.rejects(
    service.resolveCurrentPdf('report-a', { organizationId: 'org-a', permissions: { reports: 'read' } } as any),
    /Permission insuffisante pour générer le PDF/,
  );
});

test('user with report write permission generates only when the current artifact is absent', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const user = { organizationId: 'org-a', permissions: { reports: 'write' } } as any;
  const generatedUrl = 'https://example.test/new.pdf';
  const report = { id: 'report-a', visitId: 'visit-a', organizationId: 'org-a', reportFileUrl: null };
  (service as any).findOne = async () => report;
  (service as any).reportPdfTemplateService = {
    generate: async () => ({ url: generatedUrl, key: 'new.pdf', size: 4, fileName: 'rapport.pdf', pdf: Buffer.from('%PDF'), cached: false }),
  };
  let savedUrl: string | undefined;
  (service as any).dataSource = pdfTransactionFixture(report, (url) => { savedUrl = url; });

  const result = await service.resolveCurrentPdf('report-a', user, 'rapport.pdf');
  assert.equal(result.base64, Buffer.from('%PDF').toString('base64'));
  assert.equal(result.cached, false);
  assert.equal(savedUrl, generatedUrl);
});

test('a draft PDF from an older backend template is regenerated while the report stays authorized', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const user = { organizationId: 'org-a', permissions: { reports: 'write' } } as any;
  const report = { id: 'report-a', visitId: 'visit-a', organizationId: 'org-a', status: 'brouillon', reportFileUrl: 'https://example.test/old.pdf' };
  const calls: string[] = [];
  (service as any).findOne = async () => report;
  (service as any).uploadedAssets = { assertReportAccess: async () => { calls.push('authorized'); } };
  (service as any).reportPdfTemplateService = {
    isOutdatedTemplate: async () => true,
    generate: async (_report: unknown, _name: string, _force: boolean, preferExisting: boolean) => {
      assert.equal(preferExisting, false);
      calls.push('regenerated');
      return { url: 'https://example.test/current.pdf', key: 'current.pdf', size: 4, fileName: 'rapport.pdf', pdf: Buffer.from('%PDF'), cached: false };
    },
  };
  (service as any).dataSource = pdfTransactionFixture(report);

  const result = await service.resolveCurrentPdf(report.id, user, 'rapport.pdf');
  assert.equal(result.cached, false);
  assert.deepEqual(calls, ['authorized', 'regenerated']);
});

test('a sent report keeps its existing PDF even when the template has changed', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const user = { organizationId: 'org-a', permissions: { reports: 'write' } } as any;
  const report = { id: 'report-a', visitId: 'visit-a', organizationId: 'org-a', status: 'envoye_au_client', reportFileUrl: 'https://example.test/sent.pdf' };
  (service as any).findOne = async () => report;
  (service as any).uploadedAssets = { assertReportAccess: async () => undefined };
  (service as any).reportPdfTemplateService = {
    isOutdatedTemplate: async () => { throw new Error('sent PDF metadata must not be checked for regeneration'); },
    generate: async (_report: unknown, _name: string, _force: boolean, preferExisting: boolean) => {
      assert.equal(preferExisting, true);
      return { url: report.reportFileUrl, key: 'sent.pdf', size: 4, fileName: 'rapport.pdf', pdf: Buffer.from('%PDF'), cached: true };
    },
  };
  (service as any).dataSource = pdfTransactionFixture(report);

  const result = await service.resolveCurrentPdf(report.id, user, 'rapport.pdf');
  assert.equal(result.cached, true);
});

function pdfTransactionFixture(report: Record<string, any>, onSave?: (url: string) => void) {
  return { transaction: async (work: (manager: any) => Promise<unknown>) => work({
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM visits')) return [{ id: report.visitId }];
      if (sql.includes('FROM reports')) return [{ ...report }];
      if (sql.startsWith('UPDATE reports SET reportFileUrl=')) { onSave?.(params[0]); return []; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }) };
}

test('PDF resolution refuses to publish an artifact rendered before a report edit', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const report = { id: 'report-a', visitId: 'visit-a', organizationId: 'org-a',
    content: 'Old', reportFileUrl: null };
  let saved = false;
  (service as any).findOne = async () => ({ ...report });
  (service as any).reportPdfTemplateService = { generate: async () => ({
    url: 'new.pdf', key: 'new.pdf', size: 4, fileName: 'r.pdf', pdf: Buffer.from('%PDF'), cached: false,
  }) };
  (service as any).dataSource = pdfTransactionFixture({ ...report, content: 'Changed' }, () => { saved = true; });
  await assert.rejects(() => service.generateAndStorePdf(report.id, { organizationId: 'org-a' } as any), ConflictException);
  assert.equal(saved, false);
});

test('mail send refuses a PDF made stale before SMTP and never sends it', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const report = { id: 'report-a', visitId: 'visit-a', organizationId: 'org-a',
    status: 'brouillon', content: 'Old', reportFileUrl: null };
  let sent = false;
  (service as any).findOne = async () => report;
  (service as any).generateAndStorePdfArtifact = async () => ({
    url: 'new.pdf', key: 'new.pdf', size: 4, fileName: 'r.pdf', pdf: Buffer.from('%PDF'), cached: false,
  });
  (service as any).dataSource = pdfTransactionFixture({ ...report, content: 'Changed', reportFileUrl: 'new.pdf' });
  (service as any).mailService = { sendPdfReport: async () => { sent = true; } };
  await assert.rejects(
    () => service.sendReportToClient(report.id, { organizationId: 'org-a' } as any,
      'client@example.test', 'Rapport', 'Veuillez trouver le rapport.'),
    ConflictException,
  );
  assert.equal(sent, false);
});

test('report update DTO rejects a client-supplied PDF reference', () => {
  const dto = plainToInstance(UpdateReportDto, { reportFileUrl: 'https://example.test/foreign.pdf' });
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  assert.ok(errors.some((error) => error.property === 'reportFileUrl'));
});

test('editing PDF source fields detaches the old artifact without deleting it', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const report = {
    id: 'report-a', organizationId: 'org-a', visitId: 'visit-a', missionId: 'mission-a',
    userId: 'user-a', title: 'Rapport', content: 'Contenu', header: 'Avant', footer: '',
    reportFileUrl: 'https://example.test/old.pdf',
  };
  let saved: any;
  (service as any).findOne = async () => report;
  (service as any).dataSource = { transaction: async (work: (manager: any) => Promise<unknown>) =>
    work({
      query: async (sql: string) => sql.includes('FROM visits') ? [{ id: 'visit-a' }] : [{ status: 'brouillon' }],
      getRepository: () => ({
        findOneByOrFail: async () => ({ ...report }),
        save: async (value: any) => { saved = value; return value; },
      }),
    }) };
  (service as any).notifyPreventionAfterCommit = () => undefined;

  await service.update(report.id, { organizationId: 'org-a' } as any, { header: 'Après' });
  assert.equal(saved.header, 'Après');
  assert.equal(saved.reportFileUrl, null);
  assert.equal(report.reportFileUrl, 'https://example.test/old.pdf');
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

test('SPS report deletion commits before any Prevention event is written', async () => {
  const service = Object.create(ReportService.prototype) as ReportService;
  const calls: string[] = [];
  (service as any).findOne = async () => ({ id: 'report-a', visitId: 'visit-a', organizationId: 'org-a', status: 'brouillon' });
  (service as any).dataSource = {
    manager: {},
    transaction: async (work: (manager: any) => Promise<unknown>) => {
      calls.push('transaction-start');
      await work({
        query: async (sql: string) => {
          if (sql.startsWith('INSERT INTO prevention_')) return [];
          if (sql.startsWith('UPDATE visits')) return [];
          return sql.includes('FROM visits') ? [{ id: 'visit-a' }] : [{ status: 'brouillon' }];
        },
        getRepository: () => ({ remove: async () => { calls.push('report-remove'); } }),
      });
      calls.push('transaction-commit');
    },
  };
  (service as any).preventionOutboxService = { enqueueReportEvent: async () => { calls.push('prevention-event'); } };
  await service.delete('report-a', { id: 'user-a' } as any);
  assert.deepEqual(calls, ['transaction-start', 'report-remove', 'transaction-commit', 'prevention-event']);
});

test('sent and archived reports reject edits and deletion before any write', async () => {
  for (const status of ['envoye_au_client', 'archive']) {
    const service = Object.create(ReportService.prototype) as ReportService;
    (service as any).findOne = async () => ({ id: 'report-a', status });
    (service as any).dataSource = { transaction: async () => { throw new Error('must not write'); } };
    await assert.rejects(() => service.update('report-a', { id: 'user-a' } as any, { content: 'Change' }), ConflictException);
    await assert.rejects(() => service.delete('report-a', { id: 'user-a' } as any), ConflictException);
  }
});

test('prevention phase metadata never enters the generated SPS report content', async () => {
  const service = Object.create(VisitService.prototype) as VisitService;
  const visit = {
    id: 'visit-a', missionId: 'mission-a',
    mission: { title: 'Chantier A', client: 'Client A', address: 'Paris' },
    photos: [{
      id: 'photo-a', groupId: 'group-a', uri: 'photo.jpg', validated: true,
      analysis: {
        observation: ['Garde-corps absent'], recommendation: ['Installer le garde-corps'],
        references: ['R.4323-59'], riskLevel: 'eleve', confidence: 90,
        preventionPhase: 'GROS_OEUVRE', preventionPhaseEffective: 'FINITIONS_EXTERIEURES',
        preventionPhaseJustification: 'Façade en finition', preventionPhaseStatus: 'VALIDATED',
      },
    }],
  };
  const createdReport = (service as any).buildGeneratedReportDto(visit);
  const serializedReport = JSON.stringify(createdReport);
  assert.doesNotMatch(serializedReport, /GROS_OEUVRE|FINITIONS_EXTERIEURES|Façade en finition|preventionPhase/);
});
