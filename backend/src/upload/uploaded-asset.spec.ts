import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { UploadedAssetGeneration, UploadedAssetType } from './uploaded-asset.entity';
import { UploadedAssetService } from './uploaded-asset.service';
import { LegacyAssetBackfillService } from './legacy-asset-backfill.service';

const user = { id: 'user-a', organizationId: 'org-a' } as any;
const key = 'uploads/asset-a.pdf';

function config(mode = 'OBSERVE') {
  return new ConfigService({
    ASSET_SECURITY_MODE: mode,
    AWS_S3_BUCKET: 'bucket',
    AWS_REGION: 'eu-west-3',
  });
}

test('OBSERVE preserves access for unresolved historical objects and emits no raw key contract', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [];
    if (sql.includes('FROM visits')) return [];
    if (sql.includes('FROM reports')) return [];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  const observed: any[] = [];
  (service as any).logger = { log: (entry: any) => observed.push(entry) };
  await assert.doesNotReject(service.assertAccess(user, key, 'DOWNLOAD'));
  assert.equal(observed[0]?.message, 'ASSET_ACCESS_OBSERVED');
  assert.equal(observed[0]?.event, 'ASSET_ACCESS_OBSERVED');
  assert.equal(observed[0]?.keyHash?.length, 16);
  assert.ok(!JSON.stringify(observed).includes(key));
});

test('AI access remains fail-closed in OBSERVE for a foreign verified photo', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-b', uploaderId: 'user-b', status: 'ACTIVE',
      generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO,
    }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertAiAccess(user, key), ForbiddenException);
});

test('AI access allows the uploader to analyze a new photo before visit attachment', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'ACTIVE',
      generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO,
      visitId: null,
    }];
    if (sql.includes('FROM visit_photo_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'UPLOADED', visitId: null,
    }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertAiAccess(user, key));
});

test('AI access requires an owned visit when visitId is supplied', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', userId: 'user-b' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertAiAccess(user, key, { visitId: 'visit-a' }), ForbiddenException);
});

test('AI access preserves an authorized legacy photo referenced by the user visit', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [];
    if (sql.includes('FROM visit_photo_assets')) return [];
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', userId: 'user-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertAiAccess(user, key, { visitId: 'visit-a' }));
});

test('AI access does not treat a stale registry visit binding as photo provenance', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'ACTIVE',
      generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO,
      visitId: 'visit-a',
    }];
    if (sql.includes('FROM visits') && !sql.includes('JSON_SEARCH')) return [{ id: 'visit-a', userId: 'user-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertAiAccess(user, key, { visitId: 'visit-a' }), ForbiddenException);
});

test('AI access rejects a verified key whose registry row is detached or not a photo', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'DETACHED',
      generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.GENERIC,
    }];
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', userId: 'user-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertAiAccess(user, key, { visitId: 'visit-a' }), ForbiddenException);
});

test('AI access rejects a verified photo bound to a different requested visit', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM visits')) return [{ id: 'visit-b', userId: 'user-a' }];
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'ACTIVE',
      generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO,
      visitId: 'visit-a',
    }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertAiAccess(user, key, { visitId: 'visit-b' }), ForbiddenException);
});

test('AI access accepts a verified photo with matching active attachment provenance', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', userId: 'user-a' }];
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'ACTIVE',
      generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO,
      visitId: 'visit-a',
    }];
    if (sql.includes('FROM visit_photo_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'ATTACHED', visitId: 'visit-a',
    }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertAiAccess(user, key, { visitId: 'visit-a' }));
});

test('user download rejects a foreign verified photo even in OBSERVE', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-b', status: 'ACTIVE', generation: UploadedAssetGeneration.VERIFIED_V1,
      objectType: UploadedAssetType.PHOTO,
    }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertDownloadAccess(user, key), ForbiddenException);
});

test('user download rejects an unregistered or unrelated key', async () => {
  const db = { query: async () => [] } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertDownloadAccess(user, key), ForbiddenException);
});

test('user download allows an attached photo on an owned visit', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', userId: 'user-a' }];
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', status: 'ACTIVE', generation: UploadedAssetGeneration.VERIFIED_V1,
      objectType: UploadedAssetType.PHOTO, visitId: 'visit-a',
    }];
    if (sql.includes('FROM visit_photo_assets')) return [{ uploaderId: 'user-a', status: 'ATTACHED', visitId: 'visit-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertDownloadAccess(user, key, { visitId: 'visit-a' }));
});

test('user download preserves an authorized legacy visit photo relation', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [];
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', userId: 'user-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertDownloadAccess(user, key, { visitId: 'visit-a' }));
});

test('user download allows a report PDF only through an owned visit report relation', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', status: 'ACTIVE', generation: UploadedAssetGeneration.VERIFIED_V1,
      objectType: UploadedAssetType.REPORT_PDF, reportId: null,
    }];
    if (sql.includes('FROM reports')) return [{ id: 'report-a', visitId: 'visit-a', userId: 'user-a', organizationId: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertDownloadAccess(user, key));
});

test('user download preserves an authorized legacy report PDF relation', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [];
    if (sql.includes('FROM reports')) return [{ id: 'report-a', visitId: 'visit-a', userId: 'user-a', organizationId: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertDownloadAccess(user, key));
});

test('user download rejects a report relation belonging to another visit owner', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [];
    if (sql.includes('FROM reports')) return [{ id: 'report-a', visitId: 'visit-a', userId: 'user-b', organizationId: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertDownloadAccess(user, key), ForbiddenException);
});

test('user download rejects a detached object despite a stale business relation', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', status: 'DETACHED', generation: UploadedAssetGeneration.VERIFIED_V1,
      objectType: UploadedAssetType.REPORT_PDF,
    }];
    if (sql.includes('FROM reports')) return [{ id: 'report-a', visitId: 'visit-a', userId: 'user-a', organizationId: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertDownloadAccess(user, key), ForbiddenException);
});

test('user download allows an organization-owned logo relation', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', status: 'ACTIVE', generation: UploadedAssetGeneration.VERIFIED_V1,
      objectType: UploadedAssetType.ORGANIZATION_LOGO,
    }];
    if (sql.includes('FROM organizations')) return [{ id: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.doesNotReject(service.assertDownloadAccess(user, key));
});

test('user delete rejects an unregistered or foreign object in OBSERVE', async () => {
  const unregistered = new UploadedAssetService({ query: async () => [] } as any, config('OBSERVE'));
  await assert.rejects(unregistered.assertDeleteAccess(user, key), ForbiddenException);

  const foreign = new UploadedAssetService({ query: async (sql: string) => sql.includes('FROM uploaded_assets') ? [{
    organizationId: 'org-b', uploaderId: 'user-b', status: 'ACTIVE',
    generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.GENERIC,
  }] : [] } as any, config('OBSERVE'));
  await assert.rejects(foreign.assertDeleteAccess(user, key), ForbiddenException);
});

test('user delete requires uploader ownership for a generic registered upload', async () => {
  const rows = [{ organizationId: 'org-a', uploaderId: 'user-a', status: 'ACTIVE', objectType: UploadedAssetType.GENERIC }];
  const service = new UploadedAssetService({ query: async (sql: string) => sql.includes('FROM uploaded_assets') ? rows : [] } as any, config('OBSERVE'));
  await assert.doesNotReject(service.assertDeleteAccess(user, key));
  rows[0].uploaderId = 'user-b';
  await assert.rejects(service.assertDeleteAccess(user, key), ForbiddenException);
});

test('user delete allows an unbound owned photo but rejects an attached photo on the generic route', async () => {
  let photoStatus = 'UPLOADED';
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'ACTIVE', objectType: UploadedAssetType.PHOTO,
    }];
    if (sql.includes('FROM visit_photo_assets')) return [{ uploaderId: 'user-a', status: photoStatus, visitId: photoStatus === 'ATTACHED' ? 'visit-a' : null }];
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', userId: 'user-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db as any, config('OBSERVE'));
  await assert.doesNotReject(service.assertDeleteAccess(user, key));
  photoStatus = 'ATTACHED';
  await assert.rejects(service.assertDeleteAccess(user, key), ForbiddenException);
});

test('user delete allows a report file through an owned report relation', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-b', status: 'ACTIVE', objectType: UploadedAssetType.REPORT_PDF,
    }];
    if (sql.includes('FROM reports')) return [{ id: 'report-a', visitId: 'visit-a', userId: 'user-a', organizationId: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db as any, config('OBSERVE'));
  await assert.doesNotReject(service.assertDeleteAccess(user, key));
});

test('user delete cannot remove an uploaded PDF linked to another user report', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'ACTIVE', objectType: UploadedAssetType.REPORT_PDF,
    }];
    if (sql.includes('FROM reports')) return [{ id: 'report-b', visitId: 'visit-b', userId: 'user-b', organizationId: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db as any, config('OBSERVE'));
  await assert.rejects(service.assertDeleteAccess(user, key), ForbiddenException);
});

test('user delete rejects detached report files despite an old report relation', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-a', uploaderId: 'user-a', status: 'DETACHED', objectType: UploadedAssetType.REPORT_PDF,
    }];
    if (sql.includes('FROM reports')) return [{ id: 'report-a', visitId: 'visit-a', userId: 'user-a', organizationId: 'org-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db as any, config('OBSERVE'));
  await assert.rejects(service.assertDeleteAccess(user, key), ForbiddenException);
});

test('ENFORCE_NEW_ONLY allows legacy assets and enforces only verified assets', async () => {
  let verified = true;
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return verified ? [{ organizationId: 'org-a', generation: UploadedAssetGeneration.VERIFIED_V1, status: 'ACTIVE' }] : [];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('ENFORCE_NEW_ONLY'));
  await assert.doesNotReject(service.assertAccess(user, key, 'DOWNLOAD'));
  verified = false;
  await assert.doesNotReject(service.assertAccess(user, key, 'DOWNLOAD'));
});

test('ENFORCE_NEW_ONLY denies a verified asset from another tenant or a detached verified asset', async () => {
  let rows: any[] = [{ organizationId: 'org-b', generation: UploadedAssetGeneration.VERIFIED_V1, status: 'ACTIVE' }];
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return rows;
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('ENFORCE_NEW_ONLY'));
  await assert.rejects(service.assertAccess(user, key, 'DOWNLOAD'), ForbiddenException);
  rows = [{ organizationId: 'org-a', generation: UploadedAssetGeneration.VERIFIED_V1, status: 'DETACHED' }];
  await assert.rejects(service.assertAccess(user, key, 'DOWNLOAD'), ForbiddenException);
});

test('worker access uses the explicit tenant and preserves authorized legacy access', async () => {
  let rows: any[] = [{ organizationId: 'org-b', generation: UploadedAssetGeneration.VERIFIED_V1, status: 'ACTIVE' }];
  let legacy = false;
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return rows;
    if (legacy && sql.includes('FROM visits')) return [{ id: 'visit-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('ENFORCE_NEW_ONLY'));
  await assert.rejects(service.assertWorkerAccess('org-a', key, 'PREVENTION_WORKER_PHOTO_DOWNLOAD'), ForbiddenException);
  rows = [];
  await assert.rejects(service.assertWorkerAccess('org-a', key, 'PREVENTION_WORKER_PHOTO_DOWNLOAD'), ForbiddenException);
  legacy = true;
  await assert.doesNotReject(service.assertWorkerAccess('org-a', key, 'PREVENTION_WORKER_PHOTO_DOWNLOAD'));
});

test('worker access rejects every incompatible verified photo in OBSERVE without legacy fallback', async () => {
  const incompatibleRows = [
    { organizationId: 'org-b', status: 'ACTIVE', generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO },
    { organizationId: 'org-a', status: 'DETACHED', generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO },
    { organizationId: 'org-a', status: 'ACTIVE', generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.REPORT_PDF },
    { organizationId: 'org-a', status: 'ACTIVE', generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO, visitId: 'visit-other' },
  ];
  for (const row of incompatibleRows) {
    const db = { query: async (sql: string) => {
      if (sql.includes('FROM uploaded_assets')) return [row];
      if (sql.includes('FROM visits')) return [{ id: 'visit-a' }];
      throw new Error('legacy lookup must not rescue a verified mismatch');
    } } as any;
    const service = new UploadedAssetService(db, config('OBSERVE'));
    await assert.rejects(service.assertWorkerAccess('org-a', key, 'PREVENTION_WORKER_PHOTO_DOWNLOAD', {
      visitId: 'visit-a',
      objectType: UploadedAssetType.PHOTO,
    }), ForbiddenException);
  }
});

test('mail report access accepts a tenant report relation but never a foreign verified object', async () => {
  let rows: any[] = [];
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return rows;
    if (sql.includes('FROM reports')) return [{ id: 'report-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('ENFORCE_NEW_ONLY'));
  await assert.doesNotReject(service.assertReportAccess(user, key, 'report-a'));
  rows = [{ organizationId: 'org-b', generation: UploadedAssetGeneration.VERIFIED_V1, status: 'ACTIVE', objectType: UploadedAssetType.REPORT_PDF }];
  await assert.rejects(service.assertReportAccess(user, key, 'report-a'), ForbiddenException);
});

test('OBSERVE rejects a foreign verified PDF during report reuse', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      organizationId: 'org-b', generation: UploadedAssetGeneration.VERIFIED_V1,
      status: 'ACTIVE', objectType: UploadedAssetType.REPORT_PDF,
    }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertReportAccess(user, key, 'report-a'), ForbiddenException);
});

test('OBSERVE requires a tenant report relation before reusing a legacy PDF', async () => {
  let linked = false;
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [];
    if (sql.includes('FROM reports')) return linked ? [{ id: 'report-a' }] : [];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('OBSERVE'));
  await assert.rejects(service.assertReportAccess(user, key, 'report-a'), ForbiddenException);
  linked = true;
  await assert.doesNotReject(service.assertReportAccess(user, key, 'report-a'));
});

test('legacy linked references remain accessible during ENFORCE_NEW_ONLY', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [];
    if (sql.includes('FROM reports')) return [{ id: 'report-a' }];
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config('ENFORCE_NEW_ONLY'));
  await assert.doesNotReject(service.assertAccess(user, key, 'DOWNLOAD', { reportId: 'report-a' }));
});

test('verified upload registry insert binds exactly its nine dynamic columns', async () => {
  let inserts = 0;
  const db = { query: async (sql: string, params: unknown[]) => {
    assert.match(sql, /INSERT INTO uploaded_assets/);
    assert.equal((sql.match(/\?/g) || []).length, params.length);
    assert.equal(params.length, 9);
    assert.deepEqual(params.slice(1), [
      'org-a', 'user-a', 'visits/photos/photo-a.jpg', UploadedAssetType.PHOTO,
      null, null, 'UPLOAD', null,
    ]);
    inserts += 1;
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config());
  await service.registerVerified({
    user, organizationId: user.organizationId, objectType: UploadedAssetType.PHOTO,
  }, 'visits/photos/photo-a.jpg');
  assert.equal(inserts, 1);
});

test('legacy collision marks registry rows ambiguous without touching business data', async () => {
  const writes: string[] = [];
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{ id: 'a', organizationId: 'org-b', generation: 'LEGACY_LINKED' }];
    writes.push(sql);
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config());
  const result = await service.registerLegacy({ organizationId: 'org-a', s3Key: key, objectType: UploadedAssetType.GENERIC }, false);
  assert.equal(result, 'ambiguous');
  assert.ok(writes.every((sql) => sql.includes('uploaded_assets')));
  assert.equal(writes.some((sql) => sql.trimStart().startsWith('UPDATE')), false);
});

test('legacy backfill never mutates or reactivates a verified detached asset', async () => {
  const writes: string[] = [];
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM uploaded_assets')) return [{
      id: 'verified-a', organizationId: 'org-a',
      generation: UploadedAssetGeneration.VERIFIED_V1, status: 'DETACHED',
    }];
    writes.push(sql);
    return [];
  } } as any;
  const service = new UploadedAssetService(db, config());
  const result = await service.registerLegacy({
    organizationId: 'org-a', s3Key: key, objectType: UploadedAssetType.GENERIC,
    visitId: 'stale-visit', sourceRef: 'BACKFILL',
  }, false);
  assert.equal(result, 'skipped');
  assert.deepEqual(writes, []);
});

test('backfill dry-run reads bounded references and performs no registry writes', async () => {
  const organizationId = '10000000-0000-4000-8000-000000000001';
  const writes: string[] = [];
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', organizationId, photos: JSON.stringify([{ s3Url: `https://bucket.s3.eu-west-3.amazonaws.com/${key}` }]) }];
    if (sql.includes('FROM reports')) return [];
    if (sql.includes('FROM organizations')) return [];
    if (sql.includes('FROM uploaded_assets')) return [];
    writes.push(sql);
    return [];
  } } as any;
  const assets = new UploadedAssetService(db, config());
  const backfill = new LegacyAssetBackfillService(db, assets);
  const summary = await backfill.run({ organizationId, dryRun: true, limit: 1 });
  assert.equal(summary.visits, 1);
  assert.equal(summary.inserted, 1);
  assert.equal(summary.hasMore.visits, true);
  assert.equal(writes.length, 0);
});

test('backfill requires an explicit organization UUID', async () => {
  const db = { query: async () => [] } as any;
  const assets = new UploadedAssetService(db, config());
  const backfill = new LegacyAssetBackfillService(db, assets);
  await assert.rejects(() => backfill.run({ organizationId: 'org-a', dryRun: true }), /explicit UUID/);
});

test('backfill deduplicates the same organization key across sources', async () => {
  const organizationId = '10000000-0000-4000-8000-000000000001';
  let registryChecks = 0;
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM visits')) return [{ id: 'visit-a', organizationId, photos: JSON.stringify([{ s3Url: `https://bucket.s3.eu-west-3.amazonaws.com/${key}` }]) }];
    if (sql.includes('FROM reports')) return [{ id: 'report-a', organizationId, reportFileUrl: key }];
    if (sql.includes('FROM organizations')) return [{ id: organizationId, logoS3Key: key, backgroundImageS3Key: null }];
    if (sql.includes('FROM uploaded_assets')) { registryChecks += 1; return []; }
    return [];
  } } as any;
  const assets = new UploadedAssetService(db, config());
  const backfill = new LegacyAssetBackfillService(db, assets);
  const summary = await backfill.run({ organizationId, dryRun: true, limit: 10 });
  assert.equal(summary.inserted, 1);
  assert.equal(summary.skipped, 2);
  assert.equal(registryChecks, 1);
});
