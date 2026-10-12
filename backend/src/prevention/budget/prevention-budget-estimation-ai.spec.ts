import assert from 'node:assert/strict';
import test from 'node:test';
import { PreventionBudgetEstimationAiService } from './prevention-budget-estimation-ai.service';

const input = {
  itemKey: 'a'.repeat(64), title: 'Installer des protections collectives', actionType: 'height-protection', categoryKey: 'HAUTEUR', priority: 'HIGH' as const,
  occurrenceCount: 2, reportCount: 1, recommendations: ['Installer un garde-corps'], observations: ['Trémie ouverte sans protection'],
};

function responseFor(estimate: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ estimates: [estimate] }) } }] }), { status: 200 });
}

function estimate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index: 0, actionKey: input.itemKey, quantity: '1', unit: 'FORFAIT', unitCostHt: '360', totalHt: '360',
    rangeLowHt: '300', rangeHighHt: '450', confidence: 72,
    rationale: 'Forfait indicatif pour fournir et installer une protection collective adaptée, dimensions à confirmer.',
    assumptions: ['Accès standard au chantier'],
    components: [
      { label: 'Fourniture', amountHt: '240', explanation: 'Location ou fourniture des éléments.' },
      { label: 'Pose', amountHt: '120', explanation: 'Temps de mise en place.' },
    ],
    ...overrides,
  };
}

function service(): PreventionBudgetEstimationAiService {
  return new PreventionBudgetEstimationAiService({ get: (key: string, fallback?: string) => ({ OPENAI_API_KEY: 'test-key', PREVENTION_BUDGET_LLM_MODEL: 'test-model' } as Record<string, string>)[key] ?? fallback } as any);
}

test('budget LLM estimates are schema-checked and return a transparent indicative breakdown', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    assert.equal(request.response_format.type, 'json_schema');
    assert.equal(request.response_format.json_schema.strict, true);
    const schema = request.response_format.json_schema.schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['estimates']);
    const estimateSchema = schema.properties.estimates.items;
    assert.equal(estimateSchema.additionalProperties, false);
    assert.deepEqual(estimateSchema.required.sort(), Object.keys(estimate()).sort());
    const componentSchema = estimateSchema.properties.components.items;
    assert.equal(componentSchema.additionalProperties, false);
    assert.deepEqual(componentSchema.required.sort(), ['label', 'amountHt', 'explanation'].sort());
    return responseFor(estimate());
  };
  try {
    const result = await service().estimate([input]);
    const value = result.get(input.itemKey)!;
    assert.equal(value.quantity, '1');
    assert.equal(value.totalHt, '360.00');
    assert.equal(value.details.rangeLowHt, '300.00');
    assert.equal(value.details.model, 'test-model');
    assert.equal(value.details.components.length, 2);
    assert.ok(value.details.inputsToConfirm.includes('Durée réelle du chantier'));
  } finally { global.fetch = originalFetch; }
});

test('budget LLM cannot turn report occurrences into an invented measured quantity', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => responseFor(estimate({ quantity: '150', unit: 'ml', unitCostHt: '35', totalHt: '5250',
    components: [{ label: 'Balisage', amountHt: '5250', explanation: '150 ml non vérifiés' }] }));
  try { await assert.rejects(() => service().estimate([input]), /unsupported measured quantity/); }
  finally { global.fetch = originalFetch; }
});

test('report-level estimation receives optional indicative metrics and bounded admin guidance', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    const message = String(request.messages[1].content);
    const items = JSON.parse(message.slice(message.indexOf(' : ') + 3));
    assert.equal(items[0].reportId, 'report-1');
    assert.equal(items[0].client, 'EDF');
    assert.deepEqual(items[0].indicativeMetrics, [{ quantity: '2', unit: 'UNITE', basis: 'Deux personnes visibles sans casque.', confidence: 55 }]);
    assert.equal(items[0].adminCostGuidance, 'Tenir compte du stock existant.');
    assert.equal(items[0].pricingCohortKey, 'same-client-ppe');
    assert.match(String(request.messages[0].content), /prix unitaire cohérente/);
    return responseFor(estimate());
  };
  try {
    const result = await service().estimate([{ ...input, reportId: 'report-1', clientLabel: 'EDF',
      metricEvidence: [{ quantity: '2', unit: 'UNITE', basis: 'Deux personnes visibles sans casque.', confidence: 55 }],
      pricingCohortKey: 'same-client-ppe',
      adminPrompt: 'Tenir compte du stock existant.' }]);
    assert.equal(result.get(input.itemKey)?.totalHt, '360.00');
  } finally { global.fetch = originalFetch; }
});

test('cost scopes keep sorting and dust separate from disposal and water works', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    const message = String(request.messages[1].content);
    const items = JSON.parse(message.slice(message.indexOf(' : ') + 3));
    assert.match(items[0].costScope.excluded, /transport.*évacuation/);
    assert.match(items[1].costScope.excluded, /rigoles.*bassins/);
    assert.match(items[2].costScope.excluded, /arrosage/);
    assert.match(items[3].costScope.included, /tri.*collecte.*transport/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ estimates: items.map((item: any, index: number) => estimate({ index, actionKey: item.actionKey })) }) } }] }), { status: 200 });
  };
  try {
    const types = ['waste-management', 'dust-control', 'site-water', 'waste-complete'];
    const result = await service().estimate(types.map((actionType, index) => ({ ...input, actionType,
      itemKey: String(index).padStart(64, '0') })));
    assert.equal(result.size, 4);
  } finally { global.fetch = originalFetch; }
});

test('budget LLM still rejects unexpected fields if a provider does not honor the schema', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => responseFor(estimate({ unsolicited: 'extra' }));
  try { await assert.rejects(() => service().estimate([input]), /unexpected JSON shape/); }
  finally { global.fetch = originalFetch; }
});

test('budget LLM rejects inconsistent totals and component sums', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => responseFor(estimate({ totalHt: '361' }));
  try { await assert.rejects(() => service().estimate([input]), /inconsistent amounts/); }
  finally { global.fetch = originalFetch; }
});

test('budget LLM rejects a component decomposition that does not add up', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return responseFor(estimate({ components: [
    { label: 'Fourniture', amountHt: '240', explanation: 'Éléments.' },
    { label: 'Pose', amountHt: '119', explanation: 'Installation.' },
  ] })); };
  try { await assert.rejects(() => service().estimate([input]), /component amounts do not match total/); assert.equal(calls, 2); }
  finally { global.fetch = originalFetch; }
});

test('budget LLM retries one arithmetic mismatch and keeps only a valid breakdown', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return responseFor(estimate(calls === 1 ? { components: [
      { label: 'Fourniture', amountHt: '240', explanation: 'Éléments.' },
      { label: 'Pose', amountHt: '119', explanation: 'Installation.' },
    ] } : {}));
  };
  try {
    const result = await service().estimate([input]);
    assert.equal(calls, 2);
    assert.equal(result.get(input.itemKey)?.totalHt, '360.00');
  } finally { global.fetch = originalFetch; }
});

test('an incomplete multi-item LLM response is retried in smaller complete batches', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(String(options?.body));
    const content = String(request.messages[1].content);
    const items = JSON.parse(content.slice(content.indexOf(' : ') + 3));
    const estimates = calls === 1 ? [] : items.map((item: { actionKey: string }, index: number) => estimate({ index, actionKey: item.actionKey }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ estimates }) } }] }), { status: 200 });
  };
  try {
    const second = { ...input, itemKey: 'b'.repeat(64) };
    const result = await service().estimate([input, second]);
    assert.equal(calls, 3);
    assert.equal(result.size, 2);
    assert.equal(result.get(second.itemKey)?.totalHt, '360.00');
  } finally { global.fetch = originalFetch; }
});

test('a truncated multi-item JSON response is retried in smaller complete batches', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: '{"estimates":[' } }] }), { status: 200 });
    const request = JSON.parse(String(options?.body));
    const content = String(request.messages[1].content);
    const items = JSON.parse(content.slice(content.indexOf(' : ') + 3));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ estimates: items.map((item: { actionKey: string }, index: number) => estimate({ index, actionKey: item.actionKey })) }) } }] }), { status: 200 });
  };
  try {
    const result = await service().estimate([input, { ...input, itemKey: 'b'.repeat(64) }]);
    assert.equal(calls, 3);
    assert.equal(result.size, 2);
  } finally { global.fetch = originalFetch; }
});

test('wrong model keys and invalid price ranges never pass validation', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return responseFor(estimate(calls === 1 ? { actionKey: 'wrong-key' } : { rangeHighHt: 'not-a-price' }));
  };
  try {
    await assert.rejects(() => service().estimate([input]), /invalid high range/);
    assert.equal(calls, 2);
  } finally { global.fetch = originalFetch; }
});

test('provider HTTP failures are not recursively retried', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response('', { status: 429 }); };
  try {
    await assert.rejects(() => service().estimate([input, { ...input, itemKey: 'b'.repeat(64) }]), /request failed \(429\)/);
    assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; }
});

test('budget LLM processes a pilot scenario with more than 120 lines in bounded batches', async () => {
  const originalFetch = global.fetch;
  let batchCount = 0;
  global.fetch = async (_url, options) => {
    batchCount += 1;
    const request = JSON.parse(String(options?.body));
    const userMessage = String(request.messages[1].content);
    const items: Array<{ actionKey: string }> = JSON.parse(userMessage.slice(userMessage.indexOf(' : ') + 3));
    assert.ok(items.length <= 6);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      estimates: items.map((item, index) => estimate({ index, actionKey: item.actionKey })),
    }) } }] }), { status: 200 });
  };
  try {
    const inputs = Array.from({ length: 137 }, (_, index) => ({ ...input, itemKey: String(index).padStart(64, '0') }));
    const result = await service().estimate(inputs);
    assert.equal(result.size, 137);
    assert.equal(batchCount, 23);
    await assert.rejects(() => service().estimate(Array.from({ length: 501 }, (_, index) => ({
      ...input, itemKey: String(index).padStart(64, '0'),
    }))), /bounded item limit/);
    assert.equal(batchCount, 23);
  } finally { global.fetch = originalFetch; }
});
