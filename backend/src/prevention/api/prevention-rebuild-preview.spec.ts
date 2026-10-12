import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PreventionApiService } from './prevention-api.service';
import { PreventionRebuildConfirmDto } from './prevention-rebuild.dto';
import { UserRole } from '../../user/user.entity';

const admin = { id: 'user-a', role: UserRole.ADMIN, organizationId: 'org-a' } as any;

test('reconstruction preview and admission keep the authenticated tenant and require confirmation', async () => {
  const calls: string[] = [];
  const rebuilds = {
    preview: async (organizationId: string) => { calls.push(`preview:${organizationId}`); return { reportCount: 4, findingCount: 8, previewToken: 'token' }; },
    admit: async (organizationId: string, token: string) => { calls.push(`admit:${organizationId}:${token}`); return { id: 'run-a', status: 'SCHEDULED' }; },
  };
  const service = new PreventionApiService({ query: async () => [] } as any, rebuilds as any);
  assert.equal((await service.rebuildPreview(admin)).previewToken, 'token');
  await assert.rejects(() => service.rebuild(admin, {} as any), BadRequestException);
  assert.deepEqual(await service.rebuild(admin, { previewToken: 'token' }), { id: 'run-a', status: 'SCHEDULED' });
  assert.deepEqual(calls, ['preview:org-a', 'admit:org-a:token']);
  await assert.rejects(() => service.rebuildPreview({ ...admin, organizationId: null }), ForbiddenException);
});

test('reconstruction confirmation token is required and size bounded at the HTTP boundary', () => {
  assert.ok(validateSync(plainToInstance(PreventionRebuildConfirmDto, {})).length > 0);
  assert.equal(validateSync(plainToInstance(PreventionRebuildConfirmDto, { previewToken: 'token' })).length, 0);
  assert.ok(validateSync(plainToInstance(PreventionRebuildConfirmDto, { previewToken: 'x'.repeat(1025) })).length > 0);
});
