import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { ReportPdfTemplateService } from './report-pdf-template.service';
import { UploadedAssetType } from '../upload/uploaded-asset.entity';
import { formatReportDate, withoutLegacyGeneratedFooterDate, withoutLegacyGeneratedHeaderDate } from './report-date-presentation';

test('report dates keep chantier, visit and report creation distinct in the PDF', async () => {
  const service = new ReportPdfTemplateService({} as any, {} as any);
  const html = await service.render({
    title: 'Rapport test',
    createdAt: new Date('2026-09-29T08:00:00.000Z'),
    header: 'RAPPORT DE VISITE SPS\nCLIENT: Client\nLIEU: Paris\nNote conservée\nDATE: 01/10/2026\nAutre ligne',
    footer: 'CONCLUSION:\nÀ suivre\nDate: 01/10/2026',
    mission: { title: 'Chantier', date: '2026-09-28', client: 'Client' },
    visit: { visitDate: new Date('2026-09-30T08:00:00.000Z'), photos: [] },
  } as any);
  assert.match(html, /<div class="info-label">Chantier<\/div><div class="info-value">Chantier<\/div>/);
  assert.doesNotMatch(html, /<div class="info-label">Mission<\/div>/);
  assert.match(html, /<div class="info-label">Date<\/div><div class="info-value">29\/09\/2026<\/div>/);
  assert.match(html, /Date du chantier: 28\/09\/2026/);
  assert.match(html, /Date de la visite: 30\/09\/2026/);
  assert.ok(html.indexOf('LIEU: Paris') < html.indexOf('Date du chantier: 28/09/2026'));
  assert.ok(html.indexOf('Date du chantier: 28/09/2026') < html.indexOf('Date de la visite: 30/09/2026'));
  assert.ok(html.indexOf('Date de la visite: 30/09/2026') < html.indexOf('Note conservée'));
  assert.match(html, /Note conservée/);
  assert.doesNotMatch(html, /DATE: 01\/10\/2026|Date: 01\/10\/2026/);
});

test('legacy date cleanup preserves customized header and footer text', () => {
  assert.equal(formatReportDate('2026-09-29'), '29/09/2026');
  assert.equal(withoutLegacyGeneratedHeaderDate('En-tête personnalisé\nDATE: 01/10/2026'), 'En-tête personnalisé\nDATE: 01/10/2026');
  assert.equal(withoutLegacyGeneratedFooterDate('Conclusion personnalisée\nDate: 01/10/2026'), 'Conclusion personnalisée\nDate: 01/10/2026');
});

test('PDF rendering validates logo and photo provenance before reading S3 bytes', async () => {
  const reads: string[] = [];
  const validations: Array<{ url: string; context: any }> = [];
  const service = new ReportPdfTemplateService({
    downloadFile: async (url: string) => { reads.push(url); return { data: 'should-not-read', contentType: 'image/jpeg' }; },
  } as any, {} as any, {
    assertDownloadAccess: async (_user: any, url: string, context: any) => {
      validations.push({ url, context });
      throw new ForbiddenException('asset denied');
    },
  } as any);
  const user = { id: 'user-a', organizationId: 'org-a' } as any;
  const html = await service.render({
    organizationId: 'org-a',
    visitId: 'visit-a',
    organization: { id: 'org-a', logoS3Key: 'organizations/org-a/logo.jpg' },
    visit: {
      id: 'visit-a',
      photos: [{ groupId: 'group-a', s3Url: 'visits/photos/photo-a.jpg' }],
    },
    mission: {},
  } as any, user);
  assert.equal(reads.length, 0);
  assert.deepEqual(validations.map(({ url, context }) => [url, context.objectType, context.visitId]), [
    ['organizations/org-a/logo.jpg', UploadedAssetType.ORGANIZATION_LOGO, undefined],
    ['visits/photos/photo-a.jpg', UploadedAssetType.PHOTO, 'visit-a'],
  ]);
  assert.doesNotMatch(html, /should-not-read/);
});

test('cached PDF provenance is validated before metadata or body reads', async () => {
  let metadataReads = 0;
  let bodyReads = 0;
  const service = new ReportPdfTemplateService({
    getFileInfo: async () => { metadataReads += 1; return { metadata: {} }; },
    downloadFile: async () => { bodyReads += 1; return { data: Buffer.from('%PDF') }; },
  } as any, {} as any, {
    assertDownloadAccess: async () => { throw new ForbiddenException('cached asset denied'); },
  } as any);
  await assert.rejects(service.generate({
    id: 'report-a',
    reportFileUrl: 'reports/report-a.pdf',
    organizationId: 'org-a',
    mission: {},
    visit: {},
  } as any, 'report.pdf', false, false, { id: 'user-a', organizationId: 'org-a' } as any), ForbiddenException);
  assert.equal(metadataReads, 0);
  assert.equal(bodyReads, 0);
});

test('only a recognized older backend PDF template is considered outdated', async () => {
  const service = new ReportPdfTemplateService({
    getFileInfo: async (url: string) => ({ metadata: url.includes('old') ? { templateversion: 'backend-v4-first-page-margin' } : {} }),
  } as any, {} as any);
  assert.equal(await service.isOutdatedTemplate('https://example.test/old.pdf'), true);
  assert.equal(await service.isOutdatedTemplate('https://example.test/legacy.pdf'), false);
});

test('mail attachment reuses an existing legacy PDF without upload or rendering', async () => {
  let uploads = 0;
  let renders = 0;
  const authorizedUser = { organizationId: 'org-a' } as any;
  const existingPdf = Buffer.from('%PDF-existing-report');
  const uploadsService = {
    downloadFile: async (_url: string, _folder: string, _base64: boolean, user: unknown, context: any) => {
      assert.equal(user, authorizedUser);
      assert.equal(context.reportId, 'report-a');
      return { data: existingPdf, contentType: 'application/pdf' };
    },
    uploadBuffer: async () => { uploads += 1; throw new Error('must not upload'); },
  };
  const mailService = {
    generatePdfBuffer: async () => { renders += 1; return Buffer.from('%PDF-rendered-report'); },
  };
  const service = new ReportPdfTemplateService(uploadsService as any, mailService as any);
  const report = {
    id: 'report-a',
    title: 'Rapport existant',
    reportFileUrl: 'https://bucket.s3.eu-west-3.amazonaws.com/reports_files/client/existing.pdf',
    organizationId: 'org-a',
    userId: 'user-a',
    mission: {},
    visit: {},
  } as any;

  const result = await service.generate(report, 'rapport.pdf', false, true, authorizedUser);

  assert.equal(result.cached, true);
  assert.equal(result.url, report.reportFileUrl);
  assert.deepEqual(result.pdf, existingPdf);
  assert.equal(uploads, 0);
  assert.equal(renders, 0);
});

test('an unreadable legacy PDF is not replaced during mail send', async () => {
  let uploads = 0;
  const service = new ReportPdfTemplateService({
    downloadFile: async () => { throw new Error('S3 unavailable'); },
    uploadBuffer: async () => { uploads += 1; throw new Error('must not upload'); },
  } as any, {} as any);
  const report = {
    title: 'Rapport existant',
    reportFileUrl: 'https://bucket.s3.eu-west-3.amazonaws.com/reports_files/client/existing.pdf',
    mission: {}, visit: {},
  } as any;

  await assert.rejects(service.generate(report, 'rapport.pdf', false, true), /PDF existant est inaccessible/);
  assert.equal(uploads, 0);
});
