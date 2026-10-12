export interface AppliedPrompt {
  id: string;
  name: string;
  content: string;
}

export function groupPromptIdsFromEntries(entries: Array<{ customPromptIds?: unknown }>): string[] {
  return [...new Set(entries.flatMap((entry) =>
    Array.isArray(entry.customPromptIds)
      ? entry.customPromptIds.filter((id: unknown): id is string => typeof id === 'string')
      : []))];
}

export function splitAppliedPrompts(prompts: AppliedPrompt[], groupPromptIds: string[]) {
  const groupIds = new Set(groupPromptIds);
  return {
    groupPrompts: prompts.filter((prompt) => groupIds.has(prompt.id)),
    additionalPrompts: prompts.filter((prompt) => !groupIds.has(prompt.id)),
  };
}
