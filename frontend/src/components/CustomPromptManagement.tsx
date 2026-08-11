import { FormEvent, useEffect, useState } from 'react';
import { Edit2, Loader2, Plus, Save, Trash2, Wand2, X } from 'lucide-react';
import Swal from 'sweetalert2';
import { useAuth } from '../contexts/AuthContext';
import {
  CustomPrompt,
  CustomPromptInput,
  MissionType,
  customPromptService,
} from '../services/customPromptService';

const TYPES: MissionType[] = ['CSPS', 'AEU', 'Divers'];
const EMPTY_FORM: CustomPromptInput = {
  name: '',
  missionType: 'CSPS',
  content: '',
  displayOrder: 0,
  isActive: true,
};

export default function CustomPromptManagement() {
  const { profile } = useAuth();
  const [type, setType] = useState<MissionType>('CSPS');
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CustomPromptInput>(EMPTY_FORM);

  const load = async () => {
    setLoading(true);
    try {
      const data = await customPromptService.getAllForAdmin(type);
      setPrompts(Array.isArray(data) ? data : []);
    } catch (error) {
      Swal.fire('Erreur', error instanceof Error ? error.message : 'Chargement impossible', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [type]);

  if (profile?.role !== 'ROLE_ADMIN') {
    return (
      <div className="rounded-xl border border-red-200 bg-white p-8 text-center">
        <h1 className="text-xl font-bold text-slate-900">Accès réservé aux administrateurs</h1>
      </div>
    );
  }

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, missionType: type });
    setShowForm(true);
  };

  const openEdit = (prompt: CustomPrompt) => {
    setEditingId(prompt.id);
    setForm({
      name: prompt.name,
      missionType: prompt.missionType,
      content: prompt.content,
      displayOrder: prompt.displayOrder,
      isActive: prompt.isActive,
    });
    setShowForm(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      if (editingId) await customPromptService.update(editingId, form);
      else await customPromptService.create(form);
      setShowForm(false);
      await load();
      Swal.fire({ icon: 'success', title: editingId ? 'Prompt modifié' : 'Prompt créé', timer: 1400, showConfirmButton: false });
    } catch (error) {
      Swal.fire('Erreur', error instanceof Error ? error.message : 'Enregistrement impossible', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (prompt: CustomPrompt) => {
    const result = await Swal.fire({
      icon: 'warning',
      title: 'Désactiver ce prompt ?',
      text: 'Il ne sera plus proposé lors des prochaines générations.',
      showCancelButton: true,
      confirmButtonText: 'Désactiver',
      cancelButtonText: 'Annuler',
    });
    if (!result.isConfirmed) return;
    try {
      await customPromptService.deactivate(prompt.id);
      await load();
    } catch (error) {
      Swal.fire('Erreur', error instanceof Error ? error.message : 'Désactivation impossible', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Wand2 className="h-6 w-6 text-indigo-600" /> Prompts personnalisés
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Instructions métier proposées selon le type de chantier.
          </p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">
          <Plus className="h-4 w-4" /> Nouveau prompt
        </button>
      </div>

      <div className="flex gap-2 rounded-lg bg-slate-100 p-1">
        {TYPES.map((item) => (
          <button
            key={item}
            onClick={() => setType(item)}
            className={'flex-1 rounded-md px-4 py-2 text-sm font-medium ' +
              (type === item ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600')}
          >
            {item}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" /></div>
      ) : prompts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          Aucun prompt pour {type}.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {prompts.map((prompt) => (
            <article key={prompt.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{prompt.name}</h2>
                  <p className="text-xs text-slate-500">Ordre {prompt.displayOrder} · {prompt.isActive ? 'Actif' : 'Inactif'}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(prompt)} className="rounded-md p-2 text-blue-600 hover:bg-blue-50" aria-label="Modifier">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  {prompt.isActive && (
                    <button onClick={() => deactivate(prompt)} className="rounded-md p-2 text-red-600 hover:bg-red-50" aria-label="Désactiver">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{prompt.content}</pre>
            </article>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={submit} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">{editingId ? 'Modifier le prompt' : 'Nouveau prompt'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-md p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-slate-700">Nom *</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150} required className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Type *</span>
                <select value={form.missionType} onChange={(e) => setForm({ ...form, missionType: e.target.value as MissionType })} className="w-full rounded-lg border border-slate-300 px-3 py-2">
                  {TYPES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-slate-700">Ordre</span>
                <input type="number" min={0} value={form.displayOrder || 0} onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Actif
              </label>
              <label className="sm:col-span-3">
                <span className="mb-1 block text-sm font-medium text-slate-700">Contenu injecté tel quel *</span>
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={14} maxLength={30000} required className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" />
                <span className="text-xs text-slate-400">{form.content.length}/30000 caractères</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2">Annuler</button>
              <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
