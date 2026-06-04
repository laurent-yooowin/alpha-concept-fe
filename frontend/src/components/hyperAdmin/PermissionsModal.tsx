import { useEffect, useState } from 'react';
import { X, Shield, BookOpen, Eye, Pencil, Ban, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { hyperAdminAPI } from '../../lib/api';

export type PermissionLevel = 'none' | 'read' | 'write';
export type PermissionModule = 'missions' | 'visits' | 'reports' | 'clients' | 'users';
export type UserPermissions = Partial<Record<PermissionModule, PermissionLevel>>;

const MODULES: { key: PermissionModule; label: string; description: string }[] = [
  { key: 'missions', label: 'Missions', description: 'Création, édition, suppression' },
  { key: 'visits', label: 'Visites', description: 'Planification et exécution' },
  { key: 'reports', label: 'Rapports', description: 'Génération et validation' },
  { key: 'clients', label: 'Clients', description: 'CRM' },
  { key: 'users', label: 'Utilisateurs', description: 'Gestion des coordonnateurs' },
];

const PRESETS: { id: string; label: string; perms: UserPermissions; tone: string; icon: React.ReactNode }[] = [
  {
    id: 'ADMIN_FULL',
    label: 'Admin complet',
    tone: 'bg-blue-50 border-blue-200 text-blue-700',
    icon: <Shield className="w-4 h-4" />,
    perms: { missions: 'write', visits: 'write', reports: 'write', clients: 'write', users: 'write' },
  },
  {
    id: 'COORDINATOR',
    label: 'Coordonnateur',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    icon: <Pencil className="w-4 h-4" />,
    perms: { missions: 'write', visits: 'write', reports: 'write', clients: 'read', users: 'none' },
  },
  {
    id: 'READ_ONLY',
    label: 'Lecture seule',
    tone: 'bg-slate-50 border-slate-200 text-slate-700',
    icon: <BookOpen className="w-4 h-4" />,
    perms: { missions: 'read', visits: 'read', reports: 'read', clients: 'read', users: 'none' },
  },
];

interface Props {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    permissions?: UserPermissions | null;
  };
  onClose: () => void;
  onSaved: () => void;
}

const defaultFor = (role: string): UserPermissions => {
  if (role === 'ROLE_ADMIN') return PRESETS[0].perms;
  if (role === 'ROLE_USER') return PRESETS[1].perms;
  return {};
};

export default function PermissionsModal({ user, onClose, onSaved }: Props) {
  const [perms, setPerms] = useState<UserPermissions>(
    user.permissions && Object.keys(user.permissions).length > 0
      ? user.permissions
      : defaultFor(user.role),
  );
  const [saving, setSaving] = useState(false);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const match = PRESETS.find((p) =>
      MODULES.every((m) => (perms[m.key] || 'none') === (p.perms[m.key] || 'none')),
    );
    setPresetId(match?.id || null);
  }, [perms]);

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p) setPerms({ ...p.perms });
  };

  const setLevel = (mod: PermissionModule, level: PermissionLevel) => {
    setPerms((prev) => ({ ...prev, [mod]: level }));
  };

  const submit = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await hyperAdminAPI.updateUserPermissions(user.id, { permissions: perms });
      setFeedback({ type: 'success', message: 'Permissions mises à jour avec succès.' });
      onSaved();
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (e: any) {
      const status: number | undefined = e?.status;
      const apiMsg: string =
        e?.message && e.message !== 'Request failed'
          ? e.message
          : "Impossible d'enregistrer les permissions.";
      const prefix =
        status === 403
          ? 'Accès refusé'
          : status === 401
          ? 'Session expirée'
          : status === 404
          ? 'Utilisateur introuvable'
          : status && status >= 500
          ? 'Erreur serveur'
          : 'Erreur';
      setFeedback({
        type: 'error',
        message: `${prefix}${status ? ` (${status})` : ''} : ${apiMsg}`,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Permissions</h2>
            <p className="text-xs text-slate-500">
              {user.firstName} {user.lastName} — {user.email}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Préréglages</div>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition ${
                    presetId === p.id ? `${p.tone} ring-2 ring-offset-1 ring-current` : `${p.tone} hover:opacity-90`
                  }`}
                >
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Accès par module</div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              {MODULES.map((m, idx) => (
                <div
                  key={m.key}
                  className={`flex items-center justify-between px-4 py-3 ${
                    idx > 0 ? 'border-t border-slate-100' : ''
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">{m.label}</div>
                    <div className="text-xs text-slate-500">{m.description}</div>
                  </div>
                  <div className="inline-flex bg-slate-100 rounded-lg p-1">
                    {(['none', 'read', 'write'] as PermissionLevel[]).map((lvl) => {
                      const active = (perms[m.key] || 'none') === lvl;
                      const icon = lvl === 'none' ? <Ban className="w-3 h-3" /> : lvl === 'read' ? <Eye className="w-3 h-3" /> : <Pencil className="w-3 h-3" />;
                      const label = lvl === 'none' ? 'Aucun' : lvl === 'read' ? 'Lecture' : 'Écriture';
                      const tone = active
                        ? lvl === 'write'
                          ? 'bg-blue-600 text-white shadow'
                          : lvl === 'read'
                          ? 'bg-emerald-500 text-white shadow'
                          : 'bg-slate-400 text-white shadow'
                        : 'text-slate-600 hover:bg-white';
                      return (
                        <button
                          key={lvl}
                          onClick={() => setLevel(m.key, lvl)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md ${tone}`}
                        >
                          {icon}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Les <span className="font-semibold">Hyper-Admins</span> conservent un accès total à toutes les organisations.
            Ces permissions s'appliquent au frontend (UI) et au backend (API).
          </p>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex flex-col gap-3">
          {feedback && (() => {
            const isError = feedback.type === 'error';
            const [title, ...rest] = feedback.message.split(' : ');
            const body = rest.join(' : ');
            return (
              <div
                role={isError ? 'alert' : 'status'}
                aria-live={isError ? 'assertive' : 'polite'}
                className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-sm border ${
                  isError
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {isError ? (
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-tight">{title}</div>
                  {body && (
                    <div className={`mt-0.5 text-xs break-words ${isError ? 'text-red-700' : 'text-emerald-700'}`}>
                      {body}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setFeedback(null)}
                  className={`p-1 rounded hover:bg-black/5 shrink-0 ${isError ? 'text-red-700' : 'text-emerald-700'}`}
                  aria-label="Fermer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })()}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg hover:bg-slate-100 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
