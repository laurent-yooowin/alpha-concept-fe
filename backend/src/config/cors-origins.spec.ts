import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { corsOrigins } from './cors-origins';

test('production CORS allows the two explicit ReportBTP HTTPS origins', () => {
  assert.deepEqual(
    corsOrigins('https://reportbtp.com, https://www.reportbtp.com', 'production'),
    ['https://reportbtp.com', 'https://www.reportbtp.com'],
  );
});

test('production CORS rejects missing, wildcard and non-HTTPS origins', () => {
  for (const value of [undefined, '', '*', 'http://reportbtp.com', 'https://reportbtp.com/path']) {
    assert.throws(() => corsOrigins(value, 'production'), /CORS_ORIGIN/);
  }
});

test('development retains the existing permissive fallback', () => {
  assert.equal(corsOrigins(undefined, 'development'), '*');
});
