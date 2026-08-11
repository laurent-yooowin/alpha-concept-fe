import { Loader2, RotateCcw, X } from 'lucide-react';
import CustomPromptSelector from './CustomPromptSelector';

interface Props {
  title: string;
  missionType?: string;
  selectedIds: string[];
  directives: string;
  loading?: boolean;
  directiveRequired?: boolean;
  onSelectedIdsChange: (ids: string[]) => void;
  onDirectivesChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ReanalysisConfigModal({
  title, missionType, selectedIds, directives, loading = false,
  directiveRequired = false, onSelectedIdsChange, onDirectivesChange, onCancel, onConfirm,
}: Props) {
  const disabled = loading || (directiveRequired && !directives.trim() && selectedIds.length === 0);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onMouseDown={onCancel}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <CustomPromptSelector missionType={missionType} selectedIds={selectedIds} onChange={onSelectedIdsChange} />
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Directives {directiveRequired ? '(requises si aucun prompt)' : '(optionnel)'}</label>
            <textarea value={directives} onChange={(event) => onDirectivesChange(event.target.value)} rows={5}
              className="w-full resize-y rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              placeholder="Saisissez les directives à appliquer à la réanalyse..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium hover:bg-slate-50 disabled:opacity-50">Annuler</button>
          <button type="button" onClick={onConfirm} disabled={disabled} className="flex items-center gap-2 rounded-lg bg-amber-600 px-5 py-2.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {loading ? 'Analyse...' : 'Réanalyser'}
          </button>
        </div>
      </div>
    </div>
  );
}
