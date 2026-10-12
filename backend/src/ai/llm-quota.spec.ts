import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmQuotaService } from './llm-quota.service';

const user = { id: 'user-a', organizationId: 'org-a' } as any;

test('LLM quota reserves one unit per batch image', async () => {
  let insertParams: unknown[] | undefined;
  const db = {
    transaction: async (callback: (manager: any) => Promise<void>) => callback({
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('COALESCE(SUM(units)')) return [{ totalUser: 2, totalOrganization: 4 }];
        if (sql.includes('INSERT INTO llm_quota_events')) insertParams = params;
        return [];
      },
    }),
  } as any;
  const service = new LlmQuotaService(db, new ConfigService({
    LLM_USER_QUOTA_PER_HOUR: 20,
    LLM_ORGANIZATION_QUOTA_PER_HOUR: 200,
  }));

  await service.reserve(user, 'analyze-batch', 3);
  assert.deepEqual(insertParams?.slice(-1), [3]);
});

test('LLM quota rejects an unbounded reservation before touching the database', async () => {
  let transactions = 0;
  const db = { transaction: async () => { transactions += 1; } } as any;
  const service = new LlmQuotaService(db, new ConfigService());

  await assert.rejects(() => service.reserve(user, 'analyze-batch', 21), BadRequestException);
  assert.equal(transactions, 0);
});
