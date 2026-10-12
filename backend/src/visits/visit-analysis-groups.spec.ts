import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { VisitService } from './visit.service';
import { UserRole } from '../user/user.entity';

const user = { id: 'user-1', role: UserRole.USER, organizationId: '10000000-0000-4000-8000-000000000001' } as any;
const visitId = '20000000-0000-4000-8000-000000000001';

const photoUrl = (id: string) => `https://${process.env.AWS_S3_BUCKET || 'bucket'}.s3.${process.env.AWS_REGION || 'eu-west-3'}.amazonaws.com/visits/photos/${id}.jpg`;

function fixture(options: { ai?: any; request?: any; photos?: any[]; failVisitPersistOnce?: boolean; uploadService?: any; photoAssets?: any; promptContent?: string; onResolvePrompts?: (ids: string[]) => void } = {}) {
  const requests = new Map<string, any>();
  if (options.request) requests.set(options.request.requestId, options.request);
  let lastRequest = options.request || null;
  let photos = options.photos || [];
  let persisted = 0;
  let pdfInvalidations = 0;
  let failVisitPersist = options.failVisitPersistOnce === true;
  const staged: any[] = [];
  let notes = '';
  let customPromptIds: string[] = [];
  const visit = () => ({ id: visitId, organizationId: user.organizationId, userId: user.id, missionId: 'mission-1', photos, notes, customPromptIds, mission: { title: 'Chantier', client: 'Client', address: 'Adresse', type: 'CSPS' } });
  const manager = {
    query: async (sql: string, params: any[] = []) => {
      if (sql.startsWith('INSERT INTO visit_analysis_requests')) {
        if (requests.has(params[3])) return { affectedRows: 0 };
        lastRequest = {
          id: params[0],
          organizationId: params[1],
          visitId: params[2],
          requestId: params[3],
          userId: params[4],
          operation: params[5],
          groupId: params[6],
          inputHash: params[7],
          quotaUnits: params[8],
          status: 'PENDING',
          result: null,
        };
        requests.set(params[3], lastRequest);
        return { affectedRows: 1 };
      }
      if (sql.includes('FROM visit_analysis_requests')) {
        const request = requests.get(params[2]);
        if (request) lastRequest = request;
        return request ? [request] : [];
      }
      if (sql.includes('SELECT * FROM visits')) return [visit()];
      if (sql.startsWith('UPDATE visits SET photos')) {
        if (failVisitPersist) { failVisitPersist = false; throw new Error('forced visit persistence failure'); }
        photos = JSON.parse(params[0]); persisted += 1; return [];
      }
      if (sql.startsWith('UPDATE visits SET notes=')) {
        notes = params[0]; customPromptIds = JSON.parse(params[1]); return [];
      }
      if (sql.startsWith('UPDATE reports SET reportFileUrl=NULL')) {
        assert.match(sql, /organizationId=\? AND visitId=\?/);
        assert.deepEqual(params, [user.organizationId, visitId]);
        pdfInvalidations += 1;
        return [];
      }
      if (sql.startsWith("UPDATE visit_analysis_requests SET status='COMPLETED'")) {
        const request = requests.get(params[params.length - 1]);
        if (!request) return [];
        lastRequest = request;
        request.status = 'COMPLETED';
        if (sql.includes('groupId=?')) { request.groupId = params[0]; request.result = JSON.parse(params[1]); }
        else request.result = JSON.parse(params[0]);
        return [];
      }
      if (sql.startsWith("UPDATE visit_analysis_requests SET status='PENDING'")) {
        const request = [...requests.values()].find((item) => item.id === params[0]);
        if (request) { request.status = 'PENDING'; request.errorMessage = null; lastRequest = request; }
        return [];
      }
      return [];
    },
  };
  const db = {
    transaction: async (work: (manager: any) => Promise<any>) => work(manager),
    query: async (sql: string, params: any[] = []) => {
      const request = requests.get(params[3]);
      if (sql.startsWith('UPDATE visit_analysis_requests SET result')) { if (request) { request.result = JSON.parse(params[0]); lastRequest = request; } return []; }
      if (sql.startsWith("UPDATE visit_analysis_requests SET status='FAILED'")) { if (request) { request.status = 'FAILED'; request.errorMessage = params[0]; lastRequest = request; } return []; }
      return [];
    },
  };
  const repository = { findOne: async () => visit(), create: (value: any) => value, save: async (value: any) => value };
  const defaultResult = { nonConformities: ['Constat historique'], observations: ['Observation ignorée'], recommendations: ['Sécuriser'], references: ['NF X'], riskLevel: 'eleve', confidence: 91, photoConformity: false, photoConformityMessage: '', unreadableSections: [] };
  const ai = options.ai || {
    analyzeBatchPhotos: async () => defaultResult,
    analyzeDirectives: async () => defaultResult,
    analyzeBatchEnhanced: async () => defaultResult,
  };
  const prompts = { resolveForAnalysis: async (_user: any, ids: string[]) => { options.onResolvePrompts?.(ids); return { prompts: [{ id: 'p-1', name: 'Prompt', content: 'Contenu' }], combinedContent: options.promptContent || '', missionType: 'CSPS' }; } };
  const groupProcessing = { stageExplicitGroupInTransaction: async (_manager: any, ...args: any[]) => { staged.push(args); return { status: 'PENDING', changed: true }; }, enqueueDue: async () => 1 };
  const service = new VisitService(db as any, repository as any, {} as any, {} as any, ai as any, prompts as any, groupProcessing as any, options.uploadService, options.photoAssets);
  return { service, get photos() { return photos; }, staged, requests, get persisted() { return persisted; }, get pdfInvalidations() { return pdfInvalidations; }, get request() { return lastRequest; } };
}

test('editing analysis groups invalidates the current PDF in the same tenant transaction', async () => {
  const groupId = 'group-a';
  const f = fixture({ photos: [{ id: 'photo-a', groupId, analysis: { observation: ['Avant'], recommendation: ['Avant'], references: ['Avant'] } }] });
  await f.service.patchGroups(user, visitId, { groups: [{
    groupId, observations: ['Après'], recommendations: ['Sécuriser'], references: ['Référence vérifiée'],
  }] });
  assert.deepEqual(f.photos[0].analysis.observation, ['Après']);
  assert.deepEqual(f.photos[0].analysis.recommendation, ['Sécuriser']);
  assert.deepEqual(f.photos[0].analysis.references, ['Référence vérifiée']);
  assert.equal(f.pdfInvalidations, 1);
});

test('backend creates a UUID group and persists the historical SPS photo shape', async () => {
  const f = fixture();
  const result = await f.service.createAnalysisGroup(user, visitId, { requestId: 'create-1', imageUrls: [photoUrl('30000000-0000-4000-8000-000000000001')] });
  assert.match(result.groupId, /^[0-9a-f-]{36}$/i);
  assert.equal(f.photos.length, 1);
  assert.equal(f.photos[0].groupId, result.groupId);
  assert.deepEqual(f.photos[0].analysis.observation, ['Constat historique']);
  assert.equal(f.photos[0].analysis.riskLevel, 'eleve');
  assert.equal(f.photos[0].analysis.confidence, 91);
  assert.deepEqual(f.photos[0].appliedCustomPrompts, [{ id: 'p-1', name: 'Prompt', content: 'Contenu' }]);
  assert.equal(f.staged.length, 1);
});

test('backend persistence keeps the historical Web SPS normalization contract', async () => {
  const f = fixture({ ai: { analyzeBatchPhotos: async () => ({
    nonConformities: [],
    observations: ['Observation de secours'],
    photoConformityMessage: 'Zone conforme • Garde-corps visible',
    recommendations: '1. Maintenir le balisage 2. Contrôler les accès',
    references: 'Code du travail',
    riskLevel: 'valeur-inconnue',
    confidence: '91%',
    unreadableSections: 'Angle nord',
  }) } });
  await f.service.createAnalysisGroup(user, visitId, {
    requestId: 'legacy-normalization',
    imageUrls: [photoUrl('30000000-0000-4000-8000-000000000015')],
  });
  assert.deepEqual(f.photos[0].analysis.observation, ['Zone conforme', 'Garde-corps visible']);
  assert.deepEqual(f.photos[0].analysis.recommendation, ['Maintenir le balisage', 'Contrôler les accès']);
  assert.equal(f.photos[0].analysis.riskLevel, 'eleve');
  assert.equal(f.photos[0].analysis.confidence, 91);
  assert.deepEqual(f.photos[0].analysis.unreadableSections, ['Angle nord']);
});

test('SPS error does not mutate the visit or stage Prevention', async () => {
  const f = fixture({ ai: { analyzeBatchPhotos: async () => { throw new Error('SPS unavailable'); } } });
  await assert.rejects(() => f.service.createAnalysisGroup(user, visitId, { requestId: 'create-error', imageUrls: [photoUrl('30000000-0000-4000-8000-000000000002')] }));
  assert.equal(f.photos.length, 0);
  assert.equal(f.persisted, 0);
  assert.equal(f.staged.length, 0);
});

test('completed request replay returns the current visit without a second LLM call', async () => {
  let calls = 0;
  const first = fixture({ ai: { analyzeBatchPhotos: async () => { calls += 1; return { nonConformities: [], observations: ['OK'], recommendations: [], references: [], riskLevel: 'faible', confidence: 80, photoConformity: true, photoConformityMessage: '', unreadableSections: [] }; } } });
  const url = photoUrl('30000000-0000-4000-8000-000000000003');
  const created = await first.service.createAnalysisGroup(user, visitId, { requestId: 'create-replay', imageUrls: [url] });
  const replay = await first.service.createAnalysisGroup(user, visitId, { requestId: 'create-replay', imageUrls: [url] });
  assert.equal(calls, 1);
  assert.equal(replay.groupId, created.groupId);
});

test('a retry after visit persistence failure reuses the durable SPS result', async () => {
  let calls = 0;
  const f = fixture({
    failVisitPersistOnce: true,
    ai: { analyzeBatchPhotos: async () => { calls += 1; return { nonConformities: ['Défaut'], observations: [], recommendations: ['Corriger'], references: [], riskLevel: 'moyen', confidence: 75, unreadableSections: [] }; } },
  });
  const payload = { requestId: 'persist-retry', imageUrls: [photoUrl('30000000-0000-4000-8000-000000000004')] };
  await assert.rejects(() => f.service.createAnalysisGroup(user, visitId, payload), /forced visit persistence failure/);
  assert.equal(f.photos.length, 0);
  assert.equal(f.staged.length, 0);
  assert.equal(f.request.status, 'PENDING');
  assert.ok(f.request.result?.result);
  const retried = await f.service.createAnalysisGroup(user, visitId, payload);
  assert.equal(calls, 1);
  assert.equal(f.photos[0].groupId, retried.groupId);
  assert.equal(f.staged.length, 1);
});

test('the same request id cannot be reused with different analysis input', async () => {
  const f = fixture();
  await f.service.createAnalysisGroup(user, visitId, { requestId: 'same-request', imageUrls: [photoUrl('30000000-0000-4000-8000-000000000005')] });
  await assert.rejects(
    () => f.service.createAnalysisGroup(user, visitId, { requestId: 'same-request', imageUrls: [photoUrl('30000000-0000-4000-8000-000000000006')] }),
    ConflictException,
  );
});

test('directive-only analysis is persisted as one backend-owned group and stages Prevention', async () => {
  let directiveCalls = 0;
  const f = fixture({ ai: { analyzeDirectives: async () => { directiveCalls += 1; return { nonConformities: [], observations: ['Directive analysée'], recommendations: ['Action'], references: ['R'], riskLevel: 'faible', confidence: 88, unreadableSections: [] }; } } });
  const result = await f.service.createAnalysisGroup(user, visitId, { requestId: 'directive-create', userDirectives: 'Contrôler la circulation' });
  assert.equal(directiveCalls, 1);
  assert.equal(f.photos.length, 1);
  assert.equal(f.photos[0].groupId, result.groupId);
  assert.equal(f.photos[0].isDirectiveOnly, true);
  assert.deepEqual(f.photos[0].analysis.observation, ['Directive analysée']);
  assert.equal(f.staged.length, 1);
});

test('visit photo commands reject non-S3 or non-visit object URLs before the LLM', async () => {
  const f = fixture();
  await assert.rejects(
    () => f.service.createAnalysisGroup(user, visitId, { requestId: 'invalid-url', imageUrls: ['https://example.com/visits/photos/30000000-0000-4000-8000-000000000007.jpg'] }),
    BadRequestException,
  );
  assert.equal(f.photos.length, 0);
  assert.equal(f.request, null);
});

test('attaching a photo changes only the persisted group and never calls either LLM or Prevention staging', async () => {
  const originalUrl = photoUrl('30000000-0000-4000-8000-000000000008');
  const attachedUrl = photoUrl('30000000-0000-4000-8000-000000000009');
  const original = { id: 'photo-original', groupId: 'legacy-group', uri: originalUrl, s3Url: originalUrl, analysis: { observation: ['Existant'] } };
  const f = fixture({
    photos: [original],
    ai: new Proxy({}, { get: () => () => { throw new Error('LLM must not be called'); } }),
  });
  const result = await f.service.attachPhotos(user, visitId, 'legacy-group', { imageUrls: [attachedUrl], imageReceipts: [] });
  assert.equal(result.groupId, 'legacy-group');
  assert.equal(f.photos.length, 2);
  assert.equal(f.photos[0].analysis.observation[0], 'Existant');
  assert.equal(f.photos[1].s3Url, attachedUrl);
  assert.equal(f.photos[1].analysis, undefined);
  assert.equal(f.staged.length, 0);
});

test('removing the analyzed photo preserves the group report on a remaining attachment', async () => {
  const analyzedUrl = photoUrl('30000000-0000-4000-8000-000000000016');
  const attachmentUrl = photoUrl('30000000-0000-4000-8000-000000000017');
  const analysis = { observation: ['Constat conservé'], recommendation: ['Action conservée'], references: ['R'], riskLevel: 'moyen', confidence: 82 };
  const f = fixture({ photos: [
    { id: 'analyzed-photo', groupId: 'legacy-group', uri: analyzedUrl, s3Url: analyzedUrl, analysis, userDirectives: 'Directive conservée' },
    { id: 'attachment', groupId: 'legacy-group', uri: attachmentUrl, s3Url: attachmentUrl, isDetailPhoto: true },
  ] });
  await f.service.deleteGroupPhoto(user, visitId, 'legacy-group', 'analyzed-photo');
  assert.equal(f.photos.length, 1);
  assert.equal(f.photos[0].id, 'attachment');
  assert.deepEqual(f.photos[0].analysis, analysis);
  assert.equal(f.photos[0].userDirectives, 'Directive conservée');
  assert.equal(f.staged.length, 0);
});

test('removing a legacy photo never deletes its S3 object', async () => {
  const url = photoUrl('30000000-0000-4000-8000-000000000018');
  let deletes = 0;
  const f = fixture({
    photos: [{ id: 'legacy-photo', groupId: 'legacy-group', uri: url, s3Url: url }],
    photoAssets: {
      assertAttachedAsset: async () => undefined,
      detachInTransaction: async () => undefined,
      canPhysicallyDelete: async () => false,
    },
    uploadService: { deleteDetachedVisitPhoto: async () => { deletes += 1; } },
  });
  await f.service.deleteGroupPhoto(user, visitId, 'legacy-group', 'legacy-photo');
  assert.equal(deletes, 0);
});

test('removing a verified photo may delete only after the tenant proof succeeds', async () => {
  const url = photoUrl('30000000-0000-4000-8000-000000000019');
  let deletes = 0;
  const f = fixture({
    photos: [{ id: 'verified-photo', groupId: 'legacy-group', uri: url, s3Url: url }],
    photoAssets: {
      assertAttachedAsset: async () => undefined,
      detachInTransaction: async () => undefined,
      canPhysicallyDelete: async () => true,
    },
    uploadService: { deleteDetachedVisitPhoto: async () => { deletes += 1; } },
  });
  await f.service.deleteGroupPhoto(user, visitId, 'legacy-group', 'verified-photo');
  assert.equal(deletes, 1);
});

test('a failed explicit reanalysis preserves the prior group and does not stage Prevention', async () => {
  const url = photoUrl('30000000-0000-4000-8000-000000000010');
  const before = [{ id: 'photo-existing', groupId: 'legacy-group', uri: url, s3Url: url, userDirectives: 'Avant', analysis: { observation: ['Ancien constat'], recommendation: ['Ancienne action'], references: [], riskLevel: 'faible', confidence: 80 } }];
  const f = fixture({ photos: before, ai: { analyzeBatchPhotos: async () => { throw new Error('provider timeout'); } } });
  await assert.rejects(
    () => f.service.reanalyzeGroup(user, visitId, 'legacy-group', { requestId: 'reanalyze-error', userDirectives: 'Après' }),
    /provider timeout/,
  );
  assert.deepEqual(f.photos, before);
  assert.equal(f.persisted, 0);
  assert.equal(f.staged.length, 0);
  assert.equal(f.request.status, 'FAILED');
});

test('photo, directive-only and global reanalysis reject missing directives and custom prompts', async () => {
  const url = photoUrl('30000000-0000-4000-8000-000000000020');
  const f = fixture({ photos: [
    { id: 'photo', groupId: 'photo-group', uri: url, s3Url: url, analysis: { observation: ['Photo'] } },
    { id: 'directive', groupId: 'directive-group', uri: '', isDirectiveOnly: true, analysis: { observation: ['Directive'] } },
  ], ai: new Proxy({}, { get: () => () => { throw new Error('LLM must not be called'); } }) });
  for (const groupId of ['photo-group', 'directive-group']) {
    await assert.rejects(
      () => f.service.reanalyzeGroup(user, visitId, groupId, { requestId: `empty-${groupId}`, userDirectives: '  ', customPromptIds: [] }),
      BadRequestException,
    );
  }
  await assert.rejects(
    () => f.service.reanalyzeGroup(user, visitId, 'directive-group', { requestId: 'blank-directive-with-prompt', userDirectives: ' \n\t ', customPromptIds: ['p-1'] }),
    (error: any) => error instanceof BadRequestException && /fondé sur les directives/.test(error.message),
  );
  await assert.rejects(
    () => f.service.reanalyzeAll(user, visitId, { requestId: 'empty-global', userDirectives: '', customPromptIds: [] }),
    BadRequestException,
  );
  assert.equal(f.request, null);
  assert.equal(f.persisted, 0);
  assert.equal(f.staged.length, 0);
});

test('a directive-only group accepts edited directives together with a custom prompt', async () => {
  let analyzed = 0;
  const f = fixture({
    promptContent: 'Inspecter les accès au chantier',
    photos: [{ id: 'directive', groupId: 'directive-group', uri: '', isDirectiveOnly: true, userDirectives: 'Ancienne directive', analysis: { observation: ['Avant'] } }],
    ai: { analyzeDirectives: async (directives: string, _mission: any, _previous: any, context: any) => {
      analyzed += 1;
      assert.equal(directives, 'Nouvelle directive');
      assert.equal(context.customPromptText, 'Inspecter les accès au chantier');
      return { nonConformities: [], observations: ['Après'], recommendations: [], references: [], riskLevel: 'faible', confidence: 90, unreadableSections: [] };
    } },
  });
  await f.service.reanalyzeGroup(user, visitId, 'directive-group', { requestId: 'directive-and-prompt', userDirectives: 'Nouvelle directive', customPromptIds: ['p-1'] });
  assert.equal(analyzed, 1);
  assert.equal(f.photos[0].analysis.observation[0], 'Après');
  assert.equal(f.photos[0].userDirectives, 'Nouvelle directive');
  assert.equal(f.staged.length, 1);
});

test('global reanalysis accepts a custom prompt without a global directive', async () => {
  let analyzed = 0;
  let resolvedPromptIds: string[] = [];
  const f = fixture({
    promptContent: 'Vérifier le balisage',
    onResolvePrompts: (ids) => { resolvedPromptIds = ids; },
    photos: [{ id: 'directive', groupId: 'directive-group', uri: '', isDirectiveOnly: true, userDirectives: 'Ancienne directive', customPromptIds: ['group-prompt'], analysis: { observation: ['Avant'] } }],
    ai: { analyzeDirectives: async (directives: string, _mission: any, _previous: any, context: any) => {
      analyzed += 1;
      assert.equal(directives, 'Ancienne directive');
      assert.equal(context.customPromptText, 'Vérifier le balisage');
      return { nonConformities: [], observations: ['Après'], recommendations: [], references: [], riskLevel: 'faible', confidence: 90, unreadableSections: [] };
    } },
  });
  const result = await f.service.reanalyzeAll(user, visitId, { requestId: 'global-prompt-only', userDirectives: '', customPromptIds: ['global-prompt'] });
  assert.deepEqual(result.succeeded, ['directive-group']);
  assert.deepEqual(result.failed, []);
  assert.equal(analyzed, 1);
  assert.equal(f.photos[0].userDirectives, 'Ancienne directive');
  assert.deepEqual(resolvedPromptIds, ['group-prompt', 'global-prompt']);
  assert.deepEqual(f.photos[0].customPromptIds, ['group-prompt']);
});

test('global reanalysis preserves every photo entry configuration and keeps global prompts at visit level', async () => {
  const firstUrl = photoUrl('30000000-0000-4000-8000-000000000022');
  const secondUrl = photoUrl('30000000-0000-4000-8000-000000000023');
  let resolvedPromptIds: string[] = [];
  const before = [
    { id: 'photo-1', groupId: 'multi-photo', uri: firstUrl, s3Url: firstUrl, userDirectives: 'Directive A ', comment: 'Note A', customPromptIds: ['prompt-a'], analysis: { observation: ['Avant'] } },
    { id: 'photo-2', groupId: 'multi-photo', uri: secondUrl, s3Url: secondUrl, userDirectives: 'Directive B', comment: 'Note B', customPromptIds: ['prompt-b'], analysis: { observation: ['Avant'] } },
  ];
  const f = fixture({
    photos: before,
    onResolvePrompts: (ids) => { resolvedPromptIds = ids; },
    ai: { analyzeBatchPhotos: async (urls: string[], directives: string) => {
      assert.deepEqual(urls, [firstUrl, secondUrl]);
      assert.match(directives, /Directives du groupe :\nDirective A\n\nDirective B/);
      assert.match(directives, /Directives globales :\nDirective globale/);
      return { nonConformities: [], observations: ['Après'], recommendations: [], references: [], riskLevel: 'faible', confidence: 90, unreadableSections: [] };
    } },
  });
  const result = await f.service.reanalyzeAll(user, visitId, { requestId: 'global-preserve-entries', userDirectives: 'Directive globale', customPromptIds: ['prompt-global'] });
  assert.deepEqual(result.succeeded, ['multi-photo']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(resolvedPromptIds, ['prompt-a', 'prompt-b', 'prompt-global']);
  assert.deepEqual(f.photos.map((entry) => ({ directives: entry.userDirectives, note: entry.comment, prompts: entry.customPromptIds })),
    before.map((entry) => ({ directives: entry.userDirectives, note: entry.comment, prompts: entry.customPromptIds })));
  assert.equal(result.visit.notes, 'Directive globale');
  assert.deepEqual(result.visit.customPromptIds, ['prompt-global']);
});

test('global directives are added to a directive-only group without replacing its own directives', async () => {
  let analyzed = 0;
  const f = fixture({
    photos: [{ id: 'directive', groupId: 'directive-group', uri: '', isDirectiveOnly: true, userDirectives: 'Directive propre au groupe', analysis: { observation: ['Avant'] } }],
    ai: { analyzeDirectives: async (directives: string) => {
      analyzed += 1;
      assert.match(directives, /Directives du groupe :\nDirective propre au groupe/);
      assert.match(directives, /Directives globales :\nContrôler les accès/);
      return { nonConformities: [], observations: ['Après'], recommendations: [], references: [], riskLevel: 'faible', confidence: 90, unreadableSections: [] };
    } },
  });
  const result = await f.service.reanalyzeAll(user, visitId, { requestId: 'global-with-directive', userDirectives: 'Contrôler les accès', customPromptIds: [] });
  assert.deepEqual(result.succeeded, ['directive-group']);
  assert.equal(analyzed, 1);
  assert.equal(f.photos[0].userDirectives, 'Directive propre au groupe');
});

test('global directives are added to a photo group without replacing its own directives', async () => {
  const url = photoUrl('30000000-0000-4000-8000-000000000021');
  const f = fixture({
    photos: [{ id: 'photo', groupId: 'photo-group', uri: url, s3Url: url, userDirectives: 'Directive photo', analysis: { observation: ['Avant'] } }],
    ai: { analyzeBatchPhotos: async (_urls: string[], directives: string) => {
      assert.match(directives, /Directives du groupe :\nDirective photo/);
      assert.match(directives, /Directives globales :\nContrôler les accès/);
      return { nonConformities: [], observations: ['Après'], recommendations: [], references: [], riskLevel: 'faible', confidence: 90, unreadableSections: [] };
    } },
  });
  const result = await f.service.reanalyzeAll(user, visitId, { requestId: 'global-photo-directive', userDirectives: 'Contrôler les accès', customPromptIds: [] });
  assert.deepEqual(result.succeeded, ['photo-group']);
  assert.equal(f.photos[0].userDirectives, 'Directive photo');
});

test('global prompt-only reanalysis does not analyze a directive-only group without stored directive content', async () => {
  const f = fixture({
    photos: [{ id: 'directive', groupId: 'directive-group', uri: '', isDirectiveOnly: true, userDirectives: '\n\t ', analysis: { observation: ['Avant'] } }],
    ai: new Proxy({}, { get: () => () => { throw new Error('LLM must not be called'); } }),
  });
  const result = await f.service.reanalyzeAll(user, visitId, { requestId: 'global-no-directive-content', userDirectives: 'Directive globale valide', customPromptIds: ['p-1'] });
  assert.deepEqual(result.succeeded, []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].groupId, 'directive-group');
  assert.match(result.failed[0].reason, /fondé sur les directives/);
  assert.equal(f.persisted, 0);
});

test('a failed ambiguity clarification preserves the previous analysis and does not attach detail photos', async () => {
  const url = photoUrl('30000000-0000-4000-8000-000000000011');
  const detailUrl = photoUrl('30000000-0000-4000-8000-000000000012');
  const before = [{ id: 'photo-existing', groupId: 'legacy-group', uri: url, s3Url: url, analysis: { observation: ['Zone ambiguë'], recommendation: [], references: [], riskLevel: 'moyen', confidence: 60, unreadableSections: ['angle droit'] } }];
  const f = fixture({ photos: before, ai: { analyzeBatchEnhanced: async () => { throw new Error('invalid SPS response'); } } });
  await assert.rejects(
    () => f.service.clarifyGroup(user, visitId, 'legacy-group', { requestId: 'clarify-error', detailImageUrls: [detailUrl], detailImageReceipts: [] }),
    /invalid SPS response/,
  );
  assert.deepEqual(f.photos, before);
  assert.equal(f.persisted, 0);
  assert.equal(f.staged.length, 0);
});

test('global reanalysis isolates a failed group and returns its bounded reason', async () => {
  const okUrl = photoUrl('30000000-0000-4000-8000-000000000013');
  const failedUrl = photoUrl('30000000-0000-4000-8000-000000000014');
  const photos = [
    { id: 'photo-ok', groupId: 'group-ok', uri: okUrl, s3Url: okUrl, analysis: { observation: ['Avant OK'], recommendation: [], references: [], riskLevel: 'faible', confidence: 70 } },
    { id: 'photo-ko', groupId: 'group-ko', uri: failedUrl, s3Url: failedUrl, analysis: { observation: ['Avant KO'], recommendation: [], references: [], riskLevel: 'moyen', confidence: 70 } },
  ];
  const f = fixture({
    photos,
    ai: { analyzeBatchPhotos: async (urls: string[]) => {
      if (urls.includes(failedUrl)) throw new Error(`provider failed\n${'x'.repeat(500)}`);
      return { nonConformities: ['Après OK'], observations: [], recommendations: ['Corriger'], references: [], riskLevel: 'eleve', confidence: 90, unreadableSections: [] };
    } },
  });
  const result = await f.service.reanalyzeAll(user, visitId, { requestId: 'global-partial', userDirectives: 'Directive globale' });
  assert.deepEqual(result.succeeded, ['group-ok']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].groupId, 'group-ko');
  assert.ok(result.failed[0].reason.startsWith('provider failed '));
  assert.ok(result.failed[0].reason.length <= 300);
  assert.equal(f.photos.find((entry: any) => entry.groupId === 'group-ok')?.analysis.observation[0], 'Après OK');
  assert.equal(f.photos.find((entry: any) => entry.groupId === 'group-ko')?.analysis.observation[0], 'Avant KO');
  assert.equal(f.staged.length, 1);
});

test('legacy PUT photos mutation is rejected', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.update(visitId, user, { photos: [] } as any), BadRequestException);
});

test('report generation consumes both historical and backend UUID group typologies unchanged', async () => {
  const photos = [
    { id: 'old-photo', groupId: 'group-legacy', uri: 'https://bucket/old.jpg', analysis: { observation: ['Ancien groupe'], recommendation: ['Action ancienne'], references: ['R1'], riskLevel: 'faible' } },
    { id: 'directive', groupId: 'directive-legacy', uri: '', isDirectiveOnly: true, analysis: { observation: ['Directive groupe'], recommendation: ['Action directive'], references: ['R2'], riskLevel: 'moyen' } },
    { id: 'new-photo', groupId: '550e8400-e29b-41d4-a716-446655440000', uri: 'https://bucket/new.jpg', analysis: { observation: ['Nouveau groupe'], recommendation: ['Action nouvelle'], references: ['R3'], riskLevel: 'eleve' } },
  ];
  const service = Object.create(VisitService.prototype) as VisitService;
  const generated = (service as any).buildGeneratedReportDto({
    id: visitId, organizationId: user.organizationId, userId: user.id,
    missionId: 'mission-1', photos, mission: { title: 'Chantier' },
  }, {});
  assert.match(generated.content, /Ancien groupe/);
  assert.match(generated.content, /Directive groupe/);
  assert.match(generated.content, /Nouveau groupe/);
  assert.ok(generated.content.indexOf('Ancien groupe') < generated.content.indexOf('Nouveau groupe'));
});
