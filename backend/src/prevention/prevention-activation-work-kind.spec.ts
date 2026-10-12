import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PreventionActivationWorkKind1830000034000 } from '../migrations/1830000034000-prevention-activation-work-kind';

test('P12 activation work kind is persisted and safely downgraded', async () => {
  const sql: string[] = [];
  const runner = { query: async (statement: string) => { sql.push(statement); } };
  const migration = new PreventionActivationWorkKind1830000034000();
  await migration.up(runner as any);
  assert.match(sql[0], /MODIFY workKind enum\('AUTOMATIC','ACTIVATION','ADMIN_RECONSTRUCTION','BUDGET'\)/);
  await migration.down(runner as any);
  assert.match(sql[1], /SET workKind='AUTOMATIC' WHERE workKind='ACTIVATION'/);
  assert.match(sql[2], /MODIFY workKind enum\('AUTOMATIC','ADMIN_RECONSTRUCTION','BUDGET'\)/);
});
