import assert from 'node:assert/strict';
import test from 'node:test';
import { AiService } from './ai.service';

function service(): AiService {
  return new AiService(
    { get: (_key: string, fallback?: string) => fallback ?? 'test-api-key' } as any,
    {} as any,
  );
}

const spsResponse = {
  nonConformities: ['Tableau électrique ouvert'],
  observations: [],
  recommendations: ['Fermer et sécuriser le tableau'],
  references: ['NF C 18-510'],
  riskLevel: 'eleve',
  confidence: 90,
  photoConformity: false,
  unreadableSections: [],
};

test('SPS parsing keeps the V3 result without requiring Prevention metadata', () => {
  const result = (service() as any).parseAIResponse(JSON.stringify(spsResponse));
  assert.deepEqual(result.nonConformities, spsResponse.nonConformities);
  assert.deepEqual(result.recommendations, spsResponse.recommendations);
  assert.equal(result.riskLevel, 'eleve');
  assert.equal(result.prevention, undefined);
  assert.equal(result.preventionPhase, undefined);
});

test('an extraneous Prevention block cannot alter the SPS result', () => {
  const result = (service() as any).parseAIResponse(JSON.stringify({
    ...spsResponse,
    prevention: {
      phase: 'INSTALLATION_ELECTRIQUE',
      observations: [{ index: 0, riskLevel: 'faible' }],
    },
  }));
  assert.deepEqual(result.nonConformities, spsResponse.nonConformities);
  assert.equal(result.riskLevel, 'eleve');
  assert.equal(result.prevention, undefined);
});

test('directive-only AI rejects whitespace directives even with a custom prompt', async () => {
  await assert.rejects(
    () => service().analyzeDirectives(' \n\t ', undefined, undefined, { customPromptText: 'Inspecter les accès' }),
    /Directives text is required/,
  );
});
