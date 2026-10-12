import assert from 'node:assert/strict';
import test from 'node:test';
import { currentReportPdfData } from '../src/services/currentReportPdf.ts';

test('download asks the backend to resolve the current PDF, even after a local edit', async () => {
  let requested = [];
  const result = await currentReportPdfData('report-1', 'rapport.pdf', async (id, name) => {
    requested = [id, name];
    return { base64: 'JVBERg==', contentType: 'application/pdf', fileName: 'current.pdf' };
  });
  assert.equal(result.base64, 'JVBERg==');
  assert.equal(result.fileName, 'current.pdf');
  assert.deepEqual(requested, ['report-1', 'rapport.pdf']);
});

test('download rejects a backend response without PDF bytes', async () => {
  await assert.rejects(
    currentReportPdfData('report-1', 'rapport.pdf', async () => ({})),
    /Aucun PDF disponible/,
  );
});
