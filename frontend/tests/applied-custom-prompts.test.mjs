import assert from 'node:assert/strict';
import test from 'node:test';
import { groupPromptIdsFromEntries, splitAppliedPrompts } from '../src/components/appliedCustomPrompts.ts';

test('global prompts remain additional to a multi-photo group selection', () => {
  const entries = [
    { customPromptIds: ['group-a'] },
    { customPromptIds: ['group-a', 'group-b'] },
    { customPromptIds: ['group-a'] },
  ];
  const prompts = [
    { id: 'group-a', name: 'Groupe A', content: 'A' },
    { id: 'group-b', name: 'Groupe B', content: 'B' },
    { id: 'global', name: 'Global', content: 'G' },
  ];
  const ownIds = groupPromptIdsFromEntries(entries);
  assert.deepEqual(ownIds, ['group-a', 'group-b']);
  const split = splitAppliedPrompts(prompts, ownIds);
  assert.deepEqual(split.groupPrompts.map((prompt) => prompt.id), ['group-a', 'group-b']);
  assert.deepEqual(split.additionalPrompts.map((prompt) => prompt.id), ['global']);
});

test('a group without its own prompts does not inherit the visit selection', () => {
  const ownIds = groupPromptIdsFromEntries([{ customPromptIds: [] }, {}]);
  assert.deepEqual(ownIds, []);
  const split = splitAppliedPrompts([{ id: 'global', name: 'Global', content: 'G' }], ownIds);
  assert.deepEqual(split.groupPrompts, []);
  assert.deepEqual(split.additionalPrompts.map((prompt) => prompt.id), ['global']);
});
