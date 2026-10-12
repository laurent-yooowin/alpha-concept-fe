import assert from 'node:assert/strict';
import test from 'node:test';
import { AiService } from './ai.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AnalyzeBatchEnhancedDto, assertBoundedPreviousAnalysis } from './ai.controller';

function serviceWithFiles(files: Record<string, string>) {
  const downloads: string[] = [];
  const service = new AiService(
    { get: (_key: string, fallback?: string) => fallback ?? 'test-api-key' } as any,
    {
      downloadFile: async (url: string) => {
        downloads.push(url);
        return { data: files[url], contentType: 'image/jpeg' };
      },
    } as any,
  );
  return { service, downloads };
}

test('batch AI loads images sequentially and preserves their order', async () => {
  const { service, downloads } = serviceWithFiles({ first: 'abc', second: 'def' });
  const images = await (service as any).loadBoundedBatchImages(['first', 'second']);
  assert.deepEqual(downloads, ['first', 'second']);
  assert.deepEqual(images.map((image: any) => image.image_url.url), [
    'data:image/jpeg;base64,abc',
    'data:image/jpeg;base64,def',
  ]);
});

test('batch AI rejects an oversized image before downloading the next one', async () => {
  const { service, downloads } = serviceWithFiles({ huge: 'x'.repeat(16 * 1024 * 1024 + 1), next: 'ok' });
  await assert.rejects(() => (service as any).loadBoundedBatchImages(['huge', 'next']), /trop volumineux/);
  assert.deepEqual(downloads, ['huge']);
});

test('batch AI rejects a cumulative oversized payload', async () => {
  const chunk = 'x'.repeat(14 * 1024 * 1024);
  const { service, downloads } = serviceWithFiles({ first: chunk, second: chunk, third: chunk });
  await assert.rejects(() => (service as any).loadBoundedBatchImages(['first', 'second', 'third']), /trop volumineux/);
  assert.deepEqual(downloads, ['first', 'second', 'third']);
});

test('enhanced AI rejects oversized instructions and nested previous analysis before model use', () => {
  const dto = plainToInstance(AnalyzeBatchEnhancedDto, {
    imageUrls: ['https://example.test/photo.jpg'],
    userDirectives: 'x'.repeat(8_001),
    unreadableSections: ['x'.repeat(513)],
  });
  const errors = validateSync(dto);
  assert.ok(errors.some((error) => error.property === 'userDirectives'));
  assert.ok(errors.some((error) => error.property === 'unreadableSections'));
  assert.throws(() => assertBoundedPreviousAnalysis({ nested: { value: 'x'.repeat(16_001) } }), /volumineuse/);
  assert.throws(() => assertBoundedPreviousAnalysis({ a: { b: { c: { d: { e: { f: { g: true } } } } } } }), /profonde/);
});
