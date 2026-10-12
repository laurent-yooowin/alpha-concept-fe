import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PreventionReportConsumerService } from './prevention-report-consumer.service';

test('group queue failure distinguishes retry from terminal attempt', () => {
  const consumer = Object.create(PreventionReportConsumerService.prototype) as PreventionReportConsumerService;
  const base = { id: 'job-1', name: 'prevention.group', opts: { attempts: 3 }, data: {}, failedReason: 'provider secret' };
  const retry = (consumer as any).jobLog('PREVENTION_GROUP_JOB_FAILED', { ...base, attemptsMade: 1 });
  const terminal = (consumer as any).jobLog('PREVENTION_GROUP_JOB_FAILED', { ...base, attemptsMade: 3 });
  assert.equal(retry.maxAttempts, 3);
  assert.equal(retry.terminal, false);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.attemptsMade, 3);
  assert.doesNotMatch(JSON.stringify(terminal), /provider secret/);
});
