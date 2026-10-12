import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const organizations = readFileSync(new URL('../src/components/hyperAdmin/HyperAdminOrganizations.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const transition = readFileSync(new URL('../src/components/hyperAdmin/recoveryTransition.ts', import.meta.url), 'utf8');

test('saving an active organisation opens recovery choices even when it was already active', () => {
  assert.match(organizations, /const openRecoveryAfterSave = Boolean\(editing && form\.isActive\)/);
  assert.match(organizations, /if \(openRecoveryAfterSave\) \{[\s\S]*await openRecovery\(activatedOrg\);/);
  assert.match(organizations, /if \(org\.isActive\) \{[\s\S]*preventionRecoveryPreview/);
  assert.match(organizations, /activatedOrganization\(orgs\.find\(\(org\) => org\.id === targetId\) \|\| editing!, targetId\)/);
  const compiled = ts.transpileModule(transition, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports });
  const stale = { id: 'edf', name: 'EDF', isActive: false };
  const activated = module.exports.activatedOrganization(stale, 'edf');
  assert.equal(activated.isActive, true);
  assert.equal(stale.isActive, false);
});

test('status and preview reads do not trigger a calculation command', () => {
  assert.match(api, /preventionRecoveryStatuses: async \(\) =>\s*apiRequest\([^\n]*prevention-recovery\/statuses/);
  assert.match(api, /preventionRecoveryPreview: async \(id: string\) =>\s*apiRequest\([^\n]*prevention-recovery\/preview/);
  assert.match(api, /preventionRecoveryStatus: async \(id: string\) =>\s*apiRequest\([^\n]*prevention-recovery`\)/);
  const openRecovery = organizations.slice(organizations.indexOf('const openRecovery'), organizations.indexOf('const closeRecovery'));
  assert.doesNotMatch(openRecovery, /preventionRecoveryConfirm/);
});

test('confirmation sends only the opaque token and immediate flag', () => {
  assert.match(api, /preventionRecoveryConfirm: async \(id: string, confirmationToken: string, immediateRequested: boolean\)/);
  assert.match(api, /body: JSON\.stringify\(\{ confirmationToken, immediateRequested \}\)/);
});

test('organisation recovery badge opens the details modal', () => {
  assert.match(organizations, /onClick=\{\(\) => void openRecovery\(org\)\}/);
  assert.match(organizations, /État du rattrapage/);
  assert.match(organizations, /title="Ouvrir le suivi Prévention de cette organisation"/);
  assert.match(organizations, /Après Enregistrer, les choix de rattrapage Prévention s’ouvriront/);
});

test('hard rejected previews cannot be submitted', () => {
  assert.match(organizations, /recoveryPreview\.hardRejected &&/);
  assert.match(organizations, /disabled=\{recoverySubmitting \|\| recoveryPreview\.hardRejected\}/);
});

test('recovery details identify the shared worker instead of a per-organisation worker', () => {
  assert.match(organizations, /Worker partagé/);
  assert.match(organizations, /Les actions sont exécutées par le backend et le worker partagé/);
  assert.match(organizations, /function workerBadge\(status\?: RecoveryStatus\)/);
  assert.match(organizations, /function preventionBadge\(status\?: RecoveryStatus\)/);
  assert.match(organizations, /ok: 'Opérationnel'/);
});

test('automatic recovery choice is explicit and does not submit a command', () => {
  assert.match(organizations, /Conserver le rattrapage automatique/);
  assert.match(organizations, /<button onClick=\{closeRecovery\}[^>]*aria-label="Fermer"/);
});

test('skipped recovery stages are presented in French', () => {
  assert.match(organizations, /SKIPPED: 'Ignoré'/);
});
