import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VisitPhotoAssetService } from './visit-photo-asset.service';
import { UploadedAssetGeneration, UploadedAssetStatus, UploadedAssetType } from './uploaded-asset.entity';
import { UploadedAssetService } from './uploaded-asset.service';

const user = { id: 'user-1', organizationId: 'org-1' } as any;
const key = 'visits/photos/10000000-0000-4000-8000-000000000001.jpg';
const url = `https://bucket.s3.eu-west-3.amazonaws.com/${key}`;

function makeService() {
  const queries: Array<{ sql: string; params: any[] }> = [];
  const db = {
    query: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT id,organizationId,uploaderId')) return [{ id: 'asset-1', organizationId: 'org-1', uploaderId: 'user-1', visitId: null, groupId: null, status: 'UPLOADED' }];
      return [];
    },
  } as any;
  const config = new ConfigService({ AWS_S3_BUCKET: 'bucket', AWS_REGION: 'eu-west-3', JWT_SECRET: 'a-secure-random-secret-with-32-characters' });
  return { service: new VisitPhotoAssetService(db, config, { assertAiAccess: async () => undefined } as any), queries };
}

test('photo receipt is bound to its key, user and organization', () => {
  const { service } = makeService();
  const receipt = service.issueReceipt(user, key);
  assert.equal(service.verifyReceipt(user, key, receipt).key, key);
  assert.throws(() => service.verifyReceipt({ ...user, id: 'other-user' }, key, receipt), ForbiddenException);
  assert.throws(() => service.verifyReceipt(user, `${key.replace('.jpg', '.png')}`, receipt), ForbiddenException);
});

test('attach validation requires one receipt per uploaded photo', async () => {
  const { service } = makeService();
  const receipt = service.issueReceipt(user, key);
  await assert.rejects(
    service.assertReceiptsForAttach({ query: async () => [] }, user, 'visit-1', 'group-1', [url], []),
    /reçu signé/,
  );
  const result = await service.assertReceiptsForAttach({ query: async () => [{ id: 'asset-1', uploaderId: 'user-1', status: 'UPLOADED', visitId: null, groupId: null }] }, user, 'visit-1', 'group-1', [url], [receipt]);
  assert.deepEqual(result, [key]);
});

test('group reanalysis rejects a verified foreign photo even when a legacy visit still references it', async () => {
  const config = new ConfigService({ AWS_S3_BUCKET: 'bucket', AWS_REGION: 'eu-west-3' });
  let legacyLookup = false;
  const service = new VisitPhotoAssetService({ query: async () => [] } as any, config, {
    assertAiAccess: async () => { throw new ForbiddenException('foreign verified photo'); },
  } as any);
  await assert.rejects(service.assertGroupAssets({ query: async () => { legacyLookup = true; return [{ id: 'legacy' }]; } }, user, 'visit-1', 'group-1', [url]), ForbiddenException);
  assert.equal(legacyLookup, false);
});

test('attachment rejects a foreign verified photo before consulting the local photo row', async () => {
  const config = new ConfigService({ AWS_S3_BUCKET: 'bucket', AWS_REGION: 'eu-west-3', JWT_SECRET: 'a-secure-random-secret-with-32-characters' });
  const service = new VisitPhotoAssetService({ query: async () => [] } as any, config, {
    assertAiAccess: async () => { throw new ForbiddenException('foreign verified photo'); },
  } as any);
  const receipt = service.issueReceipt(user, key);
  await assert.rejects(service.assertReceiptsForAttach({ query: async () => [{ uploaderId: user.id, status: 'UPLOADED' }] }, user, 'visit-1', 'group-1', [url], [receipt]), ForbiddenException);
});

test('verified registry photo is bound to the visit before attachment completes', async () => {
  const config = new ConfigService({ AWS_S3_BUCKET: 'bucket', AWS_REGION: 'eu-west-3', ASSET_SECURITY_MODE: 'OBSERVE' });
  const registryRow: any = {
    id: 'uploaded-asset-1',
    organizationId: 'org-1',
    status: UploadedAssetStatus.ACTIVE,
    generation: UploadedAssetGeneration.VERIFIED_V1,
    objectType: UploadedAssetType.PHOTO,
    visitId: null,
  };
  const executor = {
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM visit_photo_assets')) return [{ id: 'asset-1', visitId: null, groupId: null, status: 'UPLOADED' }];
      if (sql.includes('FROM uploaded_assets')) return [registryRow];
      if (sql.startsWith('UPDATE uploaded_assets')) {
        registryRow.visitId = params[0];
        return { affectedRows: 1 };
      }
      return { affectedRows: 1 };
    },
  } as any;
  const service = new VisitPhotoAssetService({ query: async () => [] } as any, config, { mode: () => 'OBSERVE' } as any);
  await service.attachInTransaction(executor, 'org-1', 'visit-1', 'group-1', [key]);
  assert.equal(registryRow.visitId, 'visit-1');

  const registry = new UploadedAssetService({ query: async (sql: string) => sql.includes('FROM uploaded_assets') ? [registryRow] : [] } as any, config);
  await assert.doesNotReject(registry.assertWorkerAccess('org-1', key, 'PREVENTION_WORKER_PHOTO_DOWNLOAD', {
    visitId: 'visit-1',
    objectType: UploadedAssetType.PHOTO,
  }));
});

test('attachment rejects a verified photo already bound to another visit', async () => {
  const config = new ConfigService({ AWS_S3_BUCKET: 'bucket', AWS_REGION: 'eu-west-3', ASSET_SECURITY_MODE: 'ENFORCE_NEW_ONLY' });
  let visitUpdates = 0;
  const executor = {
    query: async (sql: string) => {
      if (sql.includes('FROM visit_photo_assets')) return [{ id: 'asset-1', visitId: null, groupId: null, status: 'UPLOADED' }];
      if (sql.includes('FROM uploaded_assets')) return [{
        id: 'uploaded-asset-1', organizationId: 'org-1', status: UploadedAssetStatus.ACTIVE,
        generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO, visitId: 'visit-other',
      }];
      if (sql.startsWith('UPDATE visit_photo_assets')) visitUpdates += 1;
      return { affectedRows: 1 };
    },
  } as any;
  const service = new VisitPhotoAssetService({ query: async () => [] } as any, config, { mode: () => 'ENFORCE_NEW_ONLY' } as any);
  await assert.rejects(
    service.attachInTransaction(executor, 'org-1', 'visit-1', 'group-1', [key]),
    ConflictException,
  );
  assert.equal(visitUpdates, 0);
});

test('OBSERVE allows the visit attachment when the verified registry row is incompatible', async () => {
  const config = new ConfigService({ AWS_S3_BUCKET: 'bucket', AWS_REGION: 'eu-west-3', ASSET_SECURITY_MODE: 'OBSERVE' });
  let visitUpdates = 0;
  const executor = {
    query: async (sql: string) => {
      if (sql.includes('FROM visit_photo_assets')) return [{ id: 'asset-1', visitId: null, groupId: null, status: 'UPLOADED' }];
      if (sql.includes('FROM uploaded_assets')) return [{
        id: 'uploaded-asset-1', organizationId: 'org-1', status: UploadedAssetStatus.DETACHED,
        generation: UploadedAssetGeneration.VERIFIED_V1, objectType: UploadedAssetType.PHOTO, visitId: 'visit-other',
      }];
      if (sql.startsWith('UPDATE visit_photo_assets')) visitUpdates += 1;
      return { affectedRows: 1 };
    },
  } as any;
  const service = new VisitPhotoAssetService({ query: async () => [] } as any, config, {} as any);
  await service.attachInTransaction(executor, 'org-1', 'visit-1', 'group-1', [key]);
  assert.equal(visitUpdates, 1);
});

test('OBSERVE allows the visit attachment when registry binding is unavailable', async () => {
  const config = new ConfigService({ AWS_S3_BUCKET: 'bucket', AWS_REGION: 'eu-west-3', ASSET_SECURITY_MODE: 'OBSERVE' });
  let visitUpdates = 0;
  const executor = {
    query: async (sql: string) => {
      if (sql.includes('FROM visit_photo_assets')) return [{ id: 'asset-1', visitId: null, groupId: null, status: 'UPLOADED' }];
      if (sql.includes('FROM uploaded_assets')) throw new Error('registry unavailable');
      if (sql.startsWith('UPDATE visit_photo_assets')) visitUpdates += 1;
      return { affectedRows: 1 };
    },
  } as any;
  const service = new VisitPhotoAssetService({ query: async () => [] } as any, config, {} as any);
  await service.attachInTransaction(executor, 'org-1', 'visit-1', 'group-1', [key]);
  assert.equal(visitUpdates, 1);
});
