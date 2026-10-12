import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPreventionGroupAudit,
  inventoryPreventionGroupPage,
  parsePreventionGroupBackfillOptions,
  runPreventionGroupBackfill,
} from './backfill-prevention-groups';

test('audit is private, size-limited and refuses an existing unsafe file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prevention-group-audit-'));
  try {
    const file = join(directory, 'audit.jsonl');
    const audit = createPreventionGroupAudit(file, 'run-1', 200);
    await audit({ event: 'RUN_STARTED' });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    assert.equal(JSON.parse(lines[0]).event, 'RUN_STARTED');
    await assert.rejects(() => audit({ event: 'X'.repeat(200) }), /size limit/);
    await chmod(file, 0o644);
    await assert.rejects(() => audit({ event: 'RUN_COMPLETED' }), /private regular file/);
    const link = join(directory, 'link.jsonl');
    await symlink(file, link);
    await assert.rejects(() => createPreventionGroupAudit(link, 'run-2')({ event: 'RUN_STARTED' }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const photos = [
  { id: 'photo-1', groupId: 'group-a', analysis: { observation: ['Finding'] } },
  { id: 'photo-2', groupId: 'group-a' },
  { id: 'photo-3', groupId: 'group-b', analysis: { observation: ['Other'] } },
  { id: 'photo-4', groupId: 'group-c', analysis: null },
];

test('apply requires an explicit tenant or an explicit all-enabled selection', () => {
  assert.deepEqual(parsePreventionGroupBackfillOptions({}), { apply: false, allEnabled: false, organizationId: undefined });
  assert.throws(() => parsePreventionGroupBackfillOptions({ PREVENTION_GROUP_BACKFILL_APPLY: 'true' }));
  assert.throws(() => parsePreventionGroupBackfillOptions({ PREVENTION_GROUP_BACKFILL_APPLY: 'true',
    PREVENTION_GROUP_BACKFILL_ALL_ENABLED: 'true', PREVENTION_GROUP_BACKFILL_ORGANIZATION_ID: '49f872f3-3584-432c-9818-7b271b5ee6e7' }));
  assert.deepEqual(parsePreventionGroupBackfillOptions({ PREVENTION_GROUP_BACKFILL_APPLY: 'true',
    PREVENTION_GROUP_BACKFILL_ORGANIZATION_ID: '49f872f3-3584-432c-9818-7b271b5ee6e7' }), {
    apply: true, allEnabled: false, organizationId: '49f872f3-3584-432c-9818-7b271b5ee6e7',
  });
});

test('inventory counts unique analyzed groups per visit without disclosing source text', async () => {
  const db = { query: async () => [{ visitId: 'visit-a', sourceGroupId: 'group-a' }] };
  const result = await inventoryPreventionGroupPage(db, 'org-a', [
    { id: 'visit-a', photos: JSON.stringify(photos) },
    { id: 'visit-b', photos: [{ id: 'legacy-photo', analysis: { recommendation: ['Repair'] } }] },
  ]);
  assert.deepEqual(result, { analyzedGroups: 3, missingGroups: 2, existingGroups: 1 });
});

function fakeDatabase(jobs: Set<string>) {
  const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
  const db = { query: async (sql: string, parameters?: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.includes('SELECT isActive,preventionEnabled FROM organizations')) {
      return [{ isActive: 1, preventionEnabled: 1 }];
    }
    if (sql.includes('FROM organizations')) return [
      { id: 'org-disabled', isActive: 1, preventionEnabled: 0 },
      { id: 'org-enabled', isActive: 1, preventionEnabled: 1 },
    ];
    if (sql.includes('SELECT id,photos FROM visits')) {
      if (parameters?.[1] !== null) return [];
      if (parameters?.[0] === 'org-enabled') return [{ id: 'visit-a', photos }];
      if (parameters?.[0] === 'org-disabled') return [{ id: 'visit-disabled', photos: [
        { id: 'photo-disabled', groupId: 'group-disabled', analysis: { observation: ['Historical'] } },
      ] }];
      return [];
    }
    if (sql.includes('SELECT visitId,sourceGroupId')) return [...jobs].map((sourceGroupId) => ({ visitId: 'visit-a', sourceGroupId }));
    if (sql.includes('SELECT processingStatus,COUNT(*)')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  return { db, calls };
}

test('dry-run audits all tenants but never stages a group', async () => {
  const { db, calls } = fakeDatabase(new Set(['group-a']));
  const events: Array<Record<string, unknown>> = [];
  const summary = await runPreventionGroupBackfill(db, undefined, { apply: false, allEnabled: false },
    async (event) => { events.push(event); });
  assert.deepEqual(summary, { organizations: 2, eligibleOrganizations: 1, visits: 2, missingBefore: 2, staged: 0 });
  assert.ok(events.some((event) => event.event === 'ORGANIZATION_INELIGIBLE' && event.organizationId === 'org-disabled'));
  assert.ok(events.some((event) => event.event === 'PAGE_COMPLETED' && event.missingBefore === 1 && event.dryRun === true));
  assert.ok(calls.every(({ sql }) => sql.trimStart().startsWith('SELECT')));
});

test('apply stages only missing groups of enabled tenants and audits the result', async () => {
  const jobs = new Set(['group-a']);
  const { db } = fakeDatabase(jobs);
  const events: Array<Record<string, unknown>> = [];
  const calls: string[] = [];
  const backfill = { backfillOrganization: async (organizationId: string, limit: number, cursor?: string) => {
    calls.push(organizationId);
    assert.equal(limit, 100);
    assert.equal(cursor, undefined);
    jobs.add('group-b');
    return { visits: 1, queued: 1, nextCursor: 'visit-a' };
  } };
  const summary = await runPreventionGroupBackfill(db, backfill, { apply: true, allEnabled: true },
    async (event) => { events.push(event); });
  assert.deepEqual(calls, ['org-enabled']);
  assert.equal(summary.staged, 1);
  assert.ok(events.some((event) => event.event === 'PAGE_COMPLETED' && event.staged === 1 && event.dryRun === false));
});

test('apply refuses an explicitly selected disabled tenant', async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM organizations')) return [{ id: 'org-disabled', isActive: 1, preventionEnabled: 0 }];
    throw new Error('No visit or job query is allowed for a disabled tenant');
  } };
  await assert.rejects(() => runPreventionGroupBackfill(db,
    { backfillOrganization: async () => { throw new Error('Must not stage'); } },
    { apply: true, allEnabled: false, organizationId: 'org-disabled' }, async () => undefined));
});

test('an oversized historical group is audited with visit and entry before any staging', async () => {
  const events: Array<Record<string, unknown>> = [];
  const db = { query: async (sql: string) => {
    if (sql.includes('FROM organizations')) return [{ id: 'org-enabled', isActive: 1, preventionEnabled: 1 }];
    if (sql.includes('SELECT id,photos FROM visits')) return [{ id: 'visit-bad', photos: [
      { groupId: 'x'.repeat(101), analysis: { observation: ['Sensitive source'] } },
    ] }];
    throw new Error('No job query expected');
  } };
  await assert.rejects(() => runPreventionGroupBackfill(db,
    { backfillOrganization: async () => { throw new Error('Must not stage malformed data'); } },
    { apply: true, allEnabled: true }, async (event) => { events.push(event); }),
  (error: Error & { code?: string }) => error.code === 'INVALID_HISTORICAL_GROUP_ID');
  assert.ok(events.some((event) => event.event === 'PAGE_REJECTED' && event.visitId === 'visit-bad' &&
    event.entryNo === 1 && event.reason === 'GROUP_ID_TOO_LONG'));
  assert.equal(JSON.stringify(events).includes('Sensitive source'), false);
});

test('deactivation during an applied page audits interruption rather than completion', async () => {
  const events: Array<Record<string, unknown>> = [];
  let active = true;
  const db = { query: async (sql: string, parameters?: unknown[]) => {
    if (sql.includes('SELECT isActive,preventionEnabled FROM organizations')) {
      return [{ isActive: active ? 1 : 0, preventionEnabled: 1 }];
    }
    if (sql.includes('FROM organizations')) return [{ id: 'org-enabled', isActive: 1, preventionEnabled: 1 }];
    if (sql.includes('SELECT id,photos FROM visits')) {
      return parameters?.[1] === null ? [{ id: 'visit-a', photos }] : [];
    }
    if (sql.includes('SELECT visitId,sourceGroupId')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(() => runPreventionGroupBackfill(db,
    { backfillOrganization: async () => { active = false; return { visits: 1, queued: 0, nextCursor: 'visit-a' }; } },
    { apply: true, allEnabled: true }, async (event) => { events.push(event); }),
  (error: Error & { code?: string }) => error.code === 'ORGANIZATION_DISABLED_DURING_BACKFILL');
  assert.ok(events.some((event) => event.event === 'ORGANIZATION_INTERRUPTED'));
  assert.equal(events.some((event) => event.event === 'ORGANIZATION_COMPLETED'), false);
});
