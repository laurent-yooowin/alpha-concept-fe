import { AppliedPrompt, splitAppliedPrompts } from './appliedCustomPrompts';

export default function AppliedCustomPromptsReadOnly({ prompts, groupPromptIds }: { prompts?: AppliedPrompt[]; groupPromptIds: string[] }) {
  if (!prompts?.length) return null;
  const { groupPrompts, additionalPrompts } = splitAppliedPrompts(prompts, groupPromptIds);
  const sections = [
    { label: 'Prompts propres au groupe', items: groupPrompts },
    { label: 'Prompts supplémentaires appliqués (consignes globales)', items: additionalPrompts },
  ];
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-700">
      <p className="mb-2 font-semibold text-indigo-900">Prompts utilisés lors de la dernière analyse</p>
      {sections.filter((section) => section.items.length > 0).map((section) => (
        <div key={section.label} className="mb-2 last:mb-0">
          <p className="mb-1 text-xs font-semibold text-indigo-800">{section.label}</p>
          <div className="space-y-2">
            {section.items.map((prompt) => (
              <details key={prompt.id} className="rounded-md border border-indigo-100 bg-white px-3 py-2">
                <summary className="cursor-pointer font-medium text-slate-800">• {prompt.name}</summary>
                <textarea value={prompt.content} readOnly rows={6}
                  className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" />
              </details>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
