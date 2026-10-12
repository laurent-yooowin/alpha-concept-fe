'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, chmodSync, utimesSync, symlinkSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('opt-in outage affects only a short-lived Prevention group request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prevention-ai-fault-'));
  const marker = join(directory, 'outage.flag');
  const originalFetch = globalThis.fetch;
  const priorMarker = process.env.PREVENTION_AI_FAULT_MARKER;
  const priorTarget = process.env.PREVENTION_AI_FAULT_ORGANIZATION_ID;
  const priorUrl = process.env.OPENAI_API_URL;
  const requests = [];
  const organizationSymbol = Symbol.for('prevention.group.organizationId');
  const targetOrg = '49f872f3-3584-432c-9818-7b271b5ee6e7';
  try {
    globalThis.fetch = async (url, init) => { requests.push({ url, leakedOrganization: init?.[organizationSymbol] }); return { ok: true }; };
    process.env.PREVENTION_AI_FAULT_MARKER = marker;
    process.env.PREVENTION_AI_FAULT_ORGANIZATION_ID = targetOrg;
    process.env.OPENAI_API_URL = 'https://example.invalid/v1/chat/completions';
    require('./prevention-ai-outage-hook.cjs');
    const group = { method: 'POST', body: JSON.stringify({ model: 'gpt-5.1', messages: [
      { role: 'system', content: 'Tu es le moteur Prévention du module CSPS. Test.' },
    ] }), [organizationSymbol]: targetOrg };
    const otherOrgGroup = { ...group, [organizationSymbol]: '00000000-0000-4000-8000-000000000001' };
    writeFileSync(marker, '', { mode: 0o600 });
    chmodSync(marker, 0o600);
    await globalThis.fetch(process.env.OPENAI_API_URL, otherOrgGroup);
    assert.equal(requests.length, 1);
    await assert.rejects(globalThis.fetch(process.env.OPENAI_API_URL, group), TypeError);
    assert.equal(requests.length, 1);
    await globalThis.fetch(process.env.OPENAI_API_URL, group);
    assert.equal(requests.length, 2);
    await globalThis.fetch('https://example.invalid/other', group);
    await globalThis.fetch(process.env.OPENAI_API_URL, { method: 'POST', body: '{}' });
    assert.equal(requests.length, 4);
    assert.ok(requests.every((request) => request.leakedOrganization === undefined));
    writeFileSync(marker, '', { mode: 0o600 });
    chmodSync(marker, 0o644);
    await globalThis.fetch(process.env.OPENAI_API_URL, group);
    assert.equal(requests.length, 5);
    rmSync(marker);
    writeFileSync(marker, '', { mode: 0o600 });
    const expired = new Date(Date.now() - 121_000);
    utimesSync(marker, expired, expired);
    await globalThis.fetch(process.env.OPENAI_API_URL, group);
    assert.equal(requests.length, 6);
    rmSync(marker);
    const target = join(directory, 'target.flag');
    writeFileSync(target, '', { mode: 0o600 });
    symlinkSync(target, marker);
    await globalThis.fetch(process.env.OPENAI_API_URL, group);
    assert.equal(requests.length, 7);
    rmSync(marker);
    await globalThis.fetch(process.env.OPENAI_API_URL, group);
    assert.equal(requests.length, 8);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorMarker === undefined) delete process.env.PREVENTION_AI_FAULT_MARKER;
    else process.env.PREVENTION_AI_FAULT_MARKER = priorMarker;
    if (priorTarget === undefined) delete process.env.PREVENTION_AI_FAULT_ORGANIZATION_ID;
    else process.env.PREVENTION_AI_FAULT_ORGANIZATION_ID = priorTarget;
    if (priorUrl === undefined) delete process.env.OPENAI_API_URL;
    else process.env.OPENAI_API_URL = priorUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normal startup leaves fetch unpatched and the worker hook is opt-in', () => {
  const hook = join(__dirname, 'prevention-ai-outage-hook.cjs');
  const result = spawnSync(process.execPath, ['-e', 'const before=global.fetch;require(process.argv[1]);if(global.fetch!==before)process.exit(1)', hook], {
    env: { ...process.env, PREVENTION_AI_FAULT_MARKER: '' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const startup = readFileSync(join(__dirname, 'start-web.sh'), 'utf8');
  assert.match(startup, /if \[\[ "\$\{WEB_PREVENTION_AI_OUTAGE_TEST:-0\}" == "1" \]\]; then\s+worker_command=\(env /);
  assert.match(startup, /PREVENTION_AI_FAULT_ORGANIZATION_ID=\$WEB_PREVENTION_AI_FAULT_ORGANIZATION_ID/);
});
