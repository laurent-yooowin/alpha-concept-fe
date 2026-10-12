import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sanitizePersistentLog } from './persistent-log-sanitizer';

test('retains bounded recovery diagnostics without free-form data', () => {
    const result = sanitizePersistentLog({
        level: 'error', message: 'PREVENTION_RECOVERY_FAILED', event: 'PREVENTION_RECOVERY_FAILED',
        organizationId: '49f872f3-3584-432c-9818-7b271b5ee6e7',
        recoveryRunId: '71ecf6fe-568e-4a3c-b009-30fe4e7351ed',
        failedStage: 'GROUPS', errorCode: 'AI_INVALID_JSON', attempts: 2,
        stack: 'prompt secret', lastError: 'customer report content', arbitrary: { token: 'secret' },
    });
    assert.equal(result.message, 'PREVENTION_RECOVERY_FAILED');
    assert.equal(result.organizationId, '49f872f3-3584-432c-9818-7b271b5ee6e7');
    assert.equal(result.failedStage, 'GROUPS');
    assert.equal(result.errorCode, 'AI_INVALID_JSON');
    assert.equal(result.attempts, 2);
    assert.doesNotMatch(JSON.stringify(result), /prompt secret|customer report|token|stack/);
});

test('retains only safe risk-vector shape fields', () => {
    const result = sanitizePersistentLog({
        event: 'PREVENTION_GROUP_EVALUATION_FAILED', vectorReason: 'COUNT_MISMATCH',
        vectorExpectedCount: 4, vectorActualCount: 3,
        response: 'private SPS recommendation',
    });
    assert.equal(result.vectorReason, 'COUNT_MISMATCH');
    assert.equal(result.vectorExpectedCount, 4);
    assert.equal(result.vectorActualCount, 3);
    assert.doesNotMatch(JSON.stringify(result), /private SPS recommendation/);
});

test('retains bounded asset-access decisions and fingerprints, never raw keys', () => {
    const result = sanitizePersistentLog({
        event: 'ASSET_ACCESS_OBSERVED', decision: 'DENY', keyHash: '0123456789abcdef',
        s3Key: 'visits/photos/private.jpg', url: 'https://example.invalid/private.jpg',
    });
    assert.equal(result.decision, 'DENY');
    assert.equal(result.keyHash, '0123456789abcdef');
    assert.doesNotMatch(JSON.stringify(result), /private|example\.invalid/);
    const rejected = sanitizePersistentLog({ event: 'ASSET_ACCESS_OBSERVED', decision: 'DENY secret', keyHash: 'raw-key' });
    assert.equal(rejected.decision, undefined);
    assert.equal(rejected.keyHash, undefined);
});

test('replaces unstructured messages and URL/IP/user data with fingerprints', () => {
    const result = sanitizePersistentLog({
        level: 'info', message: 'user alice@example.com sent secret', requestId: 'caller-id',
        http: {
            phase: 'response', method: 'GET', url: '/api/report/alice@example.com?token=secret',
            statusCode: 500, durationMs: 34, ip: '192.0.2.2', userId: 'private-user',
            error: { message: 'private error' },
        },
    });
    assert.equal(result.message, 'UNSTRUCTURED_LOG_MESSAGE');
    assert.match(String(result.messageFingerprint), /^[0-9a-f]{16}$/);
    assert.match(String(result.requestId), /^[0-9a-f]{16}$/);
    assert.equal((result.http as any).statusCode, 500);
    assert.match(String((result.http as any).pathFingerprint), /^[0-9a-f]{16}$/);
    assert.doesNotMatch(JSON.stringify(result), /alice|secret|token|192\.0\.2\.2|private-user|caller-id/);
});

test('classifies known Nest startup messages without persisting raw routes', () => {
    const route = sanitizePersistentLog({
        level: 'info', context: 'RouterExplorer', message: 'Mapped {/api/auth/login, POST} route',
    });
    assert.equal(route.message, 'NEST_ROUTE_MAPPED');
    assert.equal(route.routeMethod, 'POST');
    assert.match(String(route.routePathFingerprint), /^[0-9a-f]{16}$/);
    assert.doesNotMatch(JSON.stringify(route), /\/api\/auth\/login/);

    const controller = sanitizePersistentLog({
        level: 'info', context: 'RoutesResolver', message: 'AuthController {/api/auth}:',
    });
    assert.equal(controller.message, 'NEST_CONTROLLER_DISCOVERED');
    assert.equal(controller.controllerName, 'AuthController');
    assert.doesNotMatch(JSON.stringify(controller), /\/api\/auth/);

    const worker = sanitizePersistentLog({ context: 'PreventionWorkerRuntimeService', message: 'Prevention worker runtime ready' });
    assert.equal(worker.message, 'PREVENTION_WORKER_READY');
    const http = sanitizePersistentLog({ context: 'HTTP', message: 'GET /private?token=secret', http: { phase: 'response', method: 'GET', statusCode: 200 } });
    assert.equal(http.message, 'HTTP_RESPONSE');
    assert.doesNotMatch(JSON.stringify(http), /secret/);

    const unexpected = sanitizePersistentLog({ context: 'RouterExplorer', message: 'Mapped {/api/private?token=secret, GET} route' });
    assert.equal(unexpected.message, 'UNSTRUCTURED_LOG_MESSAGE');
    assert.doesNotMatch(JSON.stringify(unexpected), /secret/);
});
