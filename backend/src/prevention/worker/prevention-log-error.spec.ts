import assert from 'node:assert/strict';
import test from 'node:test';
import { preventionFailureDiagnostic } from './prevention-log-error';

test('known group failures produce a useful safe code without copying the raw message', () => {
  const diagnostic = preventionFailureDiagnostic(new Error('Prevention LLM returned an invalid recommendation risk vector'));
  assert.equal(diagnostic.errorCode, 'AI_INVALID_RECOMMENDATION_RISK_VECTOR');
  assert.equal(diagnostic.errorName, 'Error');
  assert.match(String(diagnostic.errorFingerprint), /^[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /recommendation risk vector/i);
});

test('risk-vector failures expose only bounded structural diagnostics', () => {
  const diagnostic = preventionFailureDiagnostic({
    message: 'Prevention LLM returned an invalid recommendation risk vector',
    name: 'BadRequestException', vectorReason: 'COUNT_MISMATCH', vectorExpectedCount: 4,
    vectorActualCount: 3, response: 'private recommendation text',
  });
  assert.equal(diagnostic.errorCode, 'AI_INVALID_RECOMMENDATION_RISK_VECTOR');
  assert.equal(diagnostic.vectorReason, 'COUNT_MISMATCH');
  assert.equal(diagnostic.vectorExpectedCount, 4);
  assert.equal(diagnostic.vectorActualCount, 3);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private recommendation text/);
});

test('unrecognized provider text is fingerprinted, not persisted in a log field', () => {
  const diagnostic = preventionFailureDiagnostic(new Error('private prompt with Bearer secret-value'));
  assert.equal(diagnostic.errorCode, 'UNCLASSIFIED_WORKER_ERROR');
  assert.doesNotMatch(JSON.stringify(diagnostic), /private prompt|secret-value/);
});

test('persisted recovery codes and safe provider status remain identifiable', () => {
  assert.equal(preventionFailureDiagnostic('PREVENTION_GROUP_PROCESSING_FAILED').errorCode, 'PREVENTION_GROUP_PROCESSING_FAILED');
  assert.deepEqual(preventionFailureDiagnostic({ message: 'This operation was aborted', name: 'AbortError', status: 504 }).errorCode,
    'UPSTREAM_REQUEST_ABORTED');
});

test('photo failures retain only bounded diagnostics and a provider status', () => {
  const diagnostic = preventionFailureDiagnostic({
    name: 'NoSuchKey', message: 'The specified key does not exist: private.jpg',
    $metadata: { httpStatusCode: 404 }, requestId: 'private-request',
  });
  assert.equal(diagnostic.errorCode, 'PHOTO_NOT_FOUND');
  assert.equal(diagnostic.upstreamStatus, 404);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private|requestId/);
});

test('photo download timeout is classified before the generic upstream timeout', () => {
  assert.equal(preventionFailureDiagnostic(new Error('Prevention group photo download timed out')).errorCode,
    'PHOTO_DOWNLOAD_TIMEOUT');
});
