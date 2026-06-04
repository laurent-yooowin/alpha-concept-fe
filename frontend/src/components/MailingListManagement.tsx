import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Mail, Plus, Pencil, Trash2, Upload, Search, X, Loader2, FileSpreadsheet, ChevronDown, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { mailingListAPI } from '../lib/api';

interface MissionOption {
  id: string;
  title: string;
  client?: string | null;
}

interface Entry {
  id: string;
  email: string;
  name: string | null;
  missionId?: string | null;
  mission?: MissionOption | null;
  createdAt: string;
}

function getMissionOptionLabel(mission: MissionOption) {
  return mission.client ? `${mission.title} - ${mission.client}` : mission.title;
}

interface MissionSelectProps {
  value: string;
  onChange: (missionId: string) => void;
  missions: MissionOption[];
  loading: boolean;
}

function MissionSelect({ value, onChange, missions, loading }: MissionSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selectedMission = missions.find((mission) => mission.id === value);
  const q = search.trim().toLowerCase();
  const options = q
    ? missions.filter((mission) => getMissionOptionLabel(mission).toLowerCase().includes(q))
    : missions;

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div className="relative" onBlur={handleBlur}>
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-prosps-blue bg-white text-left flex items-center justify-between gap-2"
      >
        <span className={selectedMission ? 'text-slate-800 truncate' : 'text-slate-400'}>
          {selectedMission ? getMissionOptionLabel(selectedMission) : 'Sélectionner un chantier'}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un chantier..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue"
              />
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {loading && (
              <div className="px-3 py-2 text-sm text-slate-500">Chargement des chantiers...</div>
            )}
            {!loading && options.length === 0 && missions.length > 0 && (
              <div className="px-3 py-2 text-sm text-slate-500">Aucun chantier ne correspond à la recherche.</div>
            )}
            {!loading && missions.length === 0 && (
              <div className="px-3 py-2 text-sm text-amber-600">Aucun chantier disponible pour cette organisation.</div>
            )}
            {options.map((mission) => (
              <button
                key={mission.id}
                type="button"
                onClick={() => {
                  onChange(mission.id);
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="truncate">{getMissionOptionLabel(mission)}</span>
                {mission.id === value && <Check className="w-4 h-4 text-prosps-blue flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MailingListManagement() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ROLE_ADMIN' || profile?.role === 'ROLE_HYPER_ADMIN';
  const [entries, setEntries] = useState<Entry[]>([]);
  const [missions, setMissions] = useState<MissionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState('');
  const [importMissionId, setImportMissionId] = useState('');
  const [pendingImportEntries, setPendingImportEntries] = useState<Array<{ email: string; name?: string }>>([]);
  const [pendingImportFileName, setPendingImportFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const normalizeMissions = (data: any): MissionOption[] => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  };

  const loadMissions = async () => {
    setMissionsLoading(true);
    try {
      const missionData = await mailingListAPI.getMissionOptions();
      const nextMissions = normalizeMissions(missionData);
      setMissions(nextMissions);
      return nextMissions;
    } catch (e) {
      console.error(e);
      return [];
    } finally {
      setMissionsLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await mailingListAPI.getAll();
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadMissions();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const mission = getMissionLabel(e).toLowerCase();
      return e.email.toLowerCase().includes(q)
        || (e.name || '').toLowerCase().includes(q)
        || mission.includes(q);
    });
  }, [entries, filter, missions]);

  function getMissionLabel(entry: Entry) {
    const mission = entry.mission || missions.find((m) => m.id === entry.missionId);
    if (!mission) return 'Non associé';
    return mission.client ? `${mission.title} - ${mission.client}` : mission.title;
  }

  const openCreate = async () => {
    setEditing(null);
    setFormEmail('');
    setFormName('');
    const availableMissions = missions.length ? missions : await loadMissions();
    setSelectedMissionId(availableMissions[0]?.id || '');
    setShowModal(true);
  };

  const openEdit = async (entry: Entry) => {
    setEditing(entry);
    setFormEmail(entry.email);
    setFormName(entry.name || '');
    const availableMissions = missions.length ? missions : await loadMissions();
    setSelectedMissionId(entry.missionId || availableMissions[0]?.id || '');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmail.trim()) return;
    if (!selectedMissionId) {
      alert('Sélectionnez un chantier');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await mailingListAPI.update(editing.id, {
          email: formEmail.trim(),
          name: formName.trim(),
          missionId: selectedMissionId,
        });
      } else {
        await mailingListAPI.create({
          email: formEmail.trim(),
          name: formName.trim(),
          missionId: selectedMissionId,
        });
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      alert(err?.message || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: Entry) => {
    if (!confirm(`Supprimer ${entry.email} ?`)) return;
    try {
      await mailingListAPI.remove(entry.id);
      await load();
    } catch (err: any) {
      alert(err?.message || 'Erreur lors de la suppression');
    }
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadStatus('Lecture du fichier...');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const parsed: { email: string; name?: string }[] = [];
      rows.forEach((r) => {
        const keys = Object.keys(r);
        const emailKey = keys.find((k) => /e?mail/i.test(k));
        const nameKey = keys.find((k) => /nom|name/i.test(k));
        const email = String(r[emailKey || keys[0]] || '').trim();
        const name = nameKey ? String(r[nameKey] || '').trim() : '';
        if (emailRe.test(email)) parsed.push({ email, name });
      });
      if (parsed.length === 0) {
        setUploadStatus('Aucun email valide trouvé');
        return;
      }
      setPendingImportEntries(parsed);
      setPendingImportFileName(file.name);
      const availableMissions = missions.length ? missions : await loadMissions();
      setImportMissionId(availableMissions[0]?.id || '');
      setShowImportModal(true);
      setUploadStatus(null);
    } catch (err: any) {
      console.error(err);
      setUploadStatus(err?.message || 'Erreur lors de l\'import');
    }
  };

  const cancelImport = () => {
    setShowImportModal(false);
    setPendingImportEntries([]);
    setPendingImportFileName('');
    setImportMissionId('');
  };

  const confirmImport = async () => {
    if (!importMissionId) {
      alert('Sélectionnez un chantier');
      return;
    }
    setSaving(true);
    setUploadStatus(`Import de ${pendingImportEntries.length} email(s)...`);
    try {
      const res: any = await mailingListAPI.bulkCreate(importMissionId, pendingImportEntries);
      setUploadStatus(`${res?.added ?? 0} ajouté(s), ${res?.skipped ?? 0} ignoré(s)`);
      cancelImport();
      await load();
      setTimeout(() => setUploadStatus(null), 4000);
    } catch (err: any) {
      console.error(err);
      setUploadStatus(err?.message || 'Erreur lors de l\'import');
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const data = [
      ['email', 'nom'],
      ['exemple@domaine.com', 'Jean Dupont'],
      ['contact@societe.fr', 'Marie Martin'],
      ['admin@entreprise.com', 'Pierre Durand'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'template_liste_diffusion.xlsx');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Mail className="w-7 h-7 text-prosps-blue" />
            Liste de diffusion
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Ces adresses seront ajoutées automatiquement en CC lors de l'envoi des rapports au client.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFileSelected}
              className="hidden"
            />
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 text-emerald-700 text-sm"
            >
              <FileSpreadsheet className="w-4 h-4" /> Télécharger template
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 text-sm"
            >
              <Upload className="w-4 h-4" /> Importer CSV / Excel
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg hover:opacity-90 text-sm"
            >
              <Plus className="w-4 h-4" /> Ajouter un email
            </button>
          </div>
        )}
      </div>

      {uploadStatus && (
        <div className="mb-4 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded">
          {uploadStatus}
        </div>
      )}

      <div className="bg-white rounded-lg shadow border border-slate-200">
        <div className="p-4 border-b border-slate-200 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Filtrer par email ou nom..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue"
            />
          </div>
          <span className="text-sm text-slate-500">{filtered.length} / {entries.length}</span>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Nom</th>
                  <th className="px-4 py-3 font-medium">Chantier</th>
                  <th className="px-4 py-3 font-medium">Ajouté le</th>
                  {isAdmin && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 5 : 4} className="px-4 py-10 text-center text-slate-400">
                      Aucune adresse trouvée
                    </td>
                  </tr>
                ) : (
                  filtered.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-800">{entry.email}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{getMissionLabel(entry)}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(entry.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => openEdit(entry)}
                              className="p-2 hover:bg-slate-100 rounded text-slate-600"
                              title="Modifier"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(entry)}
                              className="p-2 hover:bg-red-50 rounded text-red-600"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold">
                {editing ? 'Modifier l\'email' : 'Ajouter un email'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chantier *</label>
                <MissionSelect
                  value={selectedMissionId}
                  onChange={setSelectedMissionId}
                  missions={missions}
                  loading={missionsLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-prosps-blue"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nom (facultatif)</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-prosps-blue"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedMissionId}
                  className="px-4 py-2 bg-prosps-blue text-white rounded-lg hover:opacity-90 text-sm disabled:opacity-60"
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold">Créer la liste de diffusion</h2>
              <button onClick={cancelImport} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-sm text-slate-600">
                {pendingImportEntries.length} email(s) détecté(s)
                {pendingImportFileName ? ` depuis ${pendingImportFileName}` : ''}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chantier *</label>
                <MissionSelect
                  value={importMissionId}
                  onChange={setImportMissionId}
                  missions={missions}
                  loading={missionsLoading}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={cancelImport}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={saving || !importMissionId}
                  className="px-4 py-2 bg-prosps-blue text-white rounded-lg hover:opacity-90 text-sm disabled:opacity-60"
                >
                  {saving ? 'Création...' : 'Créer la liste'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
