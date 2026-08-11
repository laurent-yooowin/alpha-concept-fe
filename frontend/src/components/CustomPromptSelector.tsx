import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { CustomPrompt, customPromptService } from '../services/customPromptService';

interface CustomPromptSelectorProps {
  missionType?: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export default function CustomPromptSelector({
  missionType,
  selectedIds,
  onChange,
  disabled = false,
  className = '',
}: CustomPromptSelectorProps) {
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: Event) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);
    document.addEventListener('click', handleOutsideClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
      document.removeEventListener('click', handleOutsideClick, true);
    };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (!missionType) {
      setPrompts([]);
      return;
    }
    setLoading(true);
    setError('');
    customPromptService.getAvailable(missionType)
      .then((data) => {
        if (cancelled) return;
        const available = Array.isArray(data) ? data : [];
        setPrompts(available);
        const availableIds = new Set(available.map((prompt) => prompt.id));
        const validSelection = selectedIds.filter((id) => availableIds.has(id));
        if (validSelection.length !== selectedIds.length) onChange(validSelection);
      })
      .catch((err) => {
        if (!cancelled) {
          setPrompts([]);
          setError(err instanceof Error ? err.message : 'Impossible de charger les prompts');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [missionType]);

  const selectedPrompts = useMemo(
    () => selectedIds
      .map((id) => prompts.find((prompt) => prompt.id === id))
      .filter(Boolean) as CustomPrompt[],
    [prompts, selectedIds],
  );
  const combinedContent = selectedPrompts.map((prompt) => prompt.content).join('\n\n');
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredPrompts = prompts.filter((prompt) => {
    if (!normalizedSearch) return true;
    return prompt.name.toLocaleLowerCase().includes(normalizedSearch);
  });

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id]);
  };

  const selectAll = () => {
    if (disabled) return;
    onChange(Array.from(new Set([...selectedIds, ...prompts.map((prompt) => prompt.id)])));
  };

  const unselectAll = () => {
    if (disabled) return;
    const promptIds = new Set(prompts.map((prompt) => prompt.id));
    onChange(selectedIds.filter((id) => !promptIds.has(id)));
  };

  return (
    <section className={'rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 ' + className}>
      <div className="mb-3 flex items-center gap-2">
        <CheckSquare className="h-4 w-4 text-indigo-600" />
        <h4 className="text-sm font-semibold text-slate-800">Prompts personnalisés</h4>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      {!loading && !error && prompts.length === 0 && (
        <p className="text-xs text-slate-500">Aucun prompt disponible pour le type {missionType || 'inconnu'}.</p>
      )}

      {prompts.length > 0 && (
        <>
          <div ref={selectorRef} className="relative mb-3">
            <button type="button" onClick={() => !disabled && setOpen(!open)} disabled={disabled} className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700">
              <span>{selectedPrompts.length ? selectedPrompts.length + " prompt(s) sélectionné(s)" : "Sélectionner des prompts"}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
            {open && !disabled && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-300 bg-white p-2 shadow-lg">
                <div className="mb-2 flex gap-2">
                  <button type="button" onClick={selectAll} className="flex-1 rounded border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">Tout sélectionner</button>
                  <button type="button" onClick={unselectAll} className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Tout désélectionner</button>
                </div>
                <div className="mb-2 flex items-center gap-2 rounded border border-slate-200 px-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input type="search" value={search} onChange={(event) => { event.stopPropagation(); setSearch(event.currentTarget.value); }} onKeyDown={(event) => event.stopPropagation()} placeholder="Rechercher un prompt..." className="w-full py-2 text-sm outline-none" autoFocus />
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {filteredPrompts.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-slate-500">Aucun résultat.</p>
                  ) : filteredPrompts.map((prompt) => (
                    <label key={prompt.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-indigo-50">
                      <input type="checkbox" checked={selectedIds.includes(prompt.id)} onChange={() => toggle(prompt.id)} className="mt-0.5" />
                      <span className="font-medium text-slate-800">{prompt.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {selectedPrompts.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {selectedPrompts.map((prompt) => (
                <span key={prompt.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-1 text-xs text-indigo-800">
                  {prompt.name}
                  <button type="button" onClick={() => toggle(prompt.id)} aria-label={"Retirer " + prompt.name}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}

          <label className="mb-1 block text-xs font-medium text-slate-600">
            Contenu injecté dans le prompt global — lecture seule
          </label>
          <textarea
            value={combinedContent}
            readOnly
            rows={Math.min(10, Math.max(3, combinedContent.split('\n').length))}
            placeholder="Sélectionnez un ou plusieurs prompts."
            className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          />
        </>
      )}
    </section>
  );
}
