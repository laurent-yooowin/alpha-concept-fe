interface AppliedPrompt {
  id: string;
  name: string;
  content: string;
}

export default function AppliedCustomPromptsReadOnly({ prompts }: { prompts?: AppliedPrompt[] }) {
  if (!prompts?.length) return null;
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-700">
      <p className="mb-2 font-semibold text-indigo-900">Prompts utilisés lors de la dernière analyse</p>
      <div className="space-y-2">
        {prompts.map((prompt) => (
          <details key={prompt.id} className="rounded-md border border-indigo-100 bg-white px-3 py-2">
            <summary className="cursor-pointer font-medium text-slate-800">• {prompt.name}</summary>
            <textarea value={prompt.content} readOnly rows={6}
              className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" />
          </details>
        ))}
      </div>
    </div>
  );
}
