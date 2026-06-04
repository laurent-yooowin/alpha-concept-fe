import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { hyperAdminAPI, organizationsAPI } from '../../lib/api';
import { Plus, Pencil, Trash2, X, Loader2, Users, Shield, UserCog, Crown, Eye, EyeOff } from 'lucide-react';
import Swal from 'sweetalert2';

type Role = 'ROLE_ADMIN' | 'ROLE_USER' | 'ROLE_HYPER_ADMIN';

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

interface UserItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  phone?: string;
  company?: string;
  isActive: boolean;
  organizationId: string | null;
  createdAt: string;
}

const emptyForm = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  phone: '',
  company: '',
  role: 'ROLE_USER' as Role,
  organizationId: '',
  isActive: true,
};

const roleLabel = (role: Role) => {
  if (role === 'ROLE_HYPER_ADMIN') return 'Hyper Admin';
  if (role === 'ROLE_ADMIN') return 'Admin';
  return 'Coordonnateur';
};

export default function HyperAdminUsers() {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [orgFilter, setOrgFilter] = useState<'all' | 'no-org' | string>('all');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [orgData, userData] = await Promise.all([
        organizationsAPI.getAll(),
        hyperAdminAPI.users(),
      ]);
      const loadedOrgs = Array.isArray(orgData) ? orgData : [];
      setOrgs(loadedOrgs);
      setUsers(Array.isArray(userData) ? userData : []);
      setForm((current) => ({
        ...current,
        organizationId: current.organizationId || loadedOrgs[0]?.id || '',
      }));
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const orgById = useMemo(() => new Map(orgs.map((org) => [org.id, org])), [orgs]);

  const filtered = useMemo(() => users
    .filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (orgFilter === 'no-org') return !user.organizationId;
      if (orgFilter !== 'all') return user.organizationId === orgFilter;
      return true;
    })
    .sort((a, b) => {
      const roleRank = (role: Role) => (role === 'ROLE_HYPER_ADMIN' ? 0 : role === 'ROLE_ADMIN' ? 1 : 2);
      const aOrgName = a.organizationId ? orgById.get(a.organizationId)?.name || '' : '';
      const bOrgName = b.organizationId ? orgById.get(b.organizationId)?.name || '' : '';
      if (a.role === 'ROLE_HYPER_ADMIN' || b.role === 'ROLE_HYPER_ADMIN') {
        return roleRank(a.role) - roleRank(b.role) || a.lastName.localeCompare(b.lastName);
      }
      return (
        aOrgName.localeCompare(bOrgName) ||
        roleRank(a.role) - roleRank(b.role) ||
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
      );
    }), [users, roleFilter, orgFilter, orgById]);

  const counts = useMemo(() => ({
    hyperAdmins: users.filter((u) => u.role === 'ROLE_HYPER_ADMIN').length,
    admins: users.filter((u) => u.role === 'ROLE_ADMIN').length,
    coords: users.filter((u) => u.role === 'ROLE_USER').length,
  }), [users]);

  const roleNeedsOrg = form.role !== 'ROLE_HYPER_ADMIN';

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      organizationId: orgs[0]?.id || '',
    });
    setShowPassword(false);
    setShowModal(true);
  };

  const openEdit = (user: UserItem) => {
    setEditing(user);
    setForm({
      email: user.email,
      password: '',
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone || '',
      company: user.company || '',
      role: user.role,
      organizationId: user.organizationId || orgs[0]?.id || '',
      isActive: user.isActive,
    });
    setShowPassword(false);
    setShowModal(true);
  };

  const close = () => {
    setShowModal(false);
    setEditing(null);
    setShowPassword(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (roleNeedsOrg && !form.organizationId) {
      await Swal.fire({ icon: 'warning', title: 'Organisation requise', text: 'Veuillez sélectionner une organisation' });
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || undefined,
        company: form.company || undefined,
        role: form.role,
        organizationId: form.role === 'ROLE_HYPER_ADMIN' ? null : form.organizationId,
        isActive: form.isActive,
      };
      if (form.password) payload.password = form.password;

      if (editing) {
        await hyperAdminAPI.updateUser(editing.id, payload);
      } else {
        await hyperAdminAPI.createUser(payload);
      }

      close();
      await load();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Erreur', text: e.message || 'Erreur' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: UserItem) => {
    const result = await Swal.fire({
      icon: 'warning',
      title: 'Supprimer cet utilisateur ?',
      text: `${user.firstName} ${user.lastName} (${user.email}) sera supprimé définitivement.`,
      showCancelButton: true,
      confirmButtonText: 'Supprimer',
      cancelButtonText: 'Annuler',
      confirmButtonColor: '#dc2626',
    });
    if (!result.isConfirmed) return;
    try {
      await hyperAdminAPI.deleteUser(user.id);
      await load();
      await Swal.fire({ icon: 'success', title: 'Utilisateur supprimé', timer: 1500, showConfirmButton: false });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Erreur', text: e.message || 'Erreur' });
    }
  };

  const toggleActive = async (user: UserItem) => {
    try {
      await hyperAdminAPI.updateUser(user.id, { isActive: !user.isActive });
      await load();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Erreur', text: e.message || 'Erreur' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Utilisateurs</h1>
          <p className="text-slate-500 mt-1">
            Les Admins et Coordonnateurs sont limités à leur organisation. Les Hyper Admins accèdent à toutes les organisations.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-lg font-medium"
        >
          <Plus className="w-4 h-4" /> Nouvel utilisateur
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Organisation</label>
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="all">Toutes les organisations</option>
            <option value="no-org">Sans organisation</option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>{org.name} - /{org.slug}{org.isActive ? '' : ' (inactif)'}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Rôle</label>
          <div className="inline-flex bg-slate-100 rounded-lg p-1">
            {(['all', 'ROLE_HYPER_ADMIN', 'ROLE_ADMIN', 'ROLE_USER'] as const).map((role) => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${roleFilter === role ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}
              >
                {role === 'all' ? 'Tous' : roleLabel(role)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 text-xs">
          <Stat icon={<Crown className="w-3.5 h-3.5" />} label="Hyper Admins" value={counts.hyperAdmins} />
          <Stat icon={<Shield className="w-3.5 h-3.5" />} label="Admins" value={counts.admins} />
          <Stat icon={<UserCog className="w-3.5 h-3.5" />} label="Coordonnateurs" value={counts.coords} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
            Aucun utilisateur.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Nom</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Rôle</th>
                <th className="text-left px-4 py-3">Organisation</th>
                <th className="text-left px-4 py-3">Société</th>
                <th className="text-left px-4 py-3">Statut</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const org = user.organizationId ? orgById.get(user.organizationId) : null;
                return (
                  <tr key={user.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-900">{user.firstName} {user.lastName}</td>
                    <td className="px-4 py-3 text-slate-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        user.role === 'ROLE_HYPER_ADMIN'
                          ? 'bg-amber-100 text-amber-700'
                          : user.role === 'ROLE_ADMIN'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-700'
                      }`}>
                        {roleLabel(user.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{org ? org.name : 'Toutes les organisations'}</td>
                    <td className="px-4 py-3 text-slate-600">{user.company || '-'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(user)}
                        className={`text-xs px-2 py-0.5 rounded-full ${user.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                      >
                        {user.isActive ? 'Actif' : 'Inactif'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(user)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded"
                      >
                        <Pencil className="w-3 h-3" /> Modifier
                      </button>
                      {user.role !== 'ROLE_HYPER_ADMIN' && (
                        <button
                          onClick={() => remove(user)}
                          className="ml-2 inline-flex items-center gap-1 px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editing ? `Modifier ${editing.firstName} ${editing.lastName}` : 'Nouvel utilisateur'}
              </h2>
              <button onClick={close} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prénom *" required value={form.firstName} onChange={(v: string) => setForm({ ...form, firstName: v })} />
                <Field label="Nom *" required value={form.lastName} onChange={(v: string) => setForm({ ...form, lastName: v })} />
              </div>
              <Field label="Email *" type="email" required value={form.email} onChange={(v: string) => setForm({ ...form, email: v })} />
              <PasswordField
                label={editing ? 'Mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *'}
                required={!editing}
                value={form.password}
                visible={showPassword}
                onToggle={() => setShowPassword((visible) => !visible)}
                onChange={(v: string) => setForm({ ...form, password: v })}
                hint="6-16 car., 1 maj, 1 min, 1 chiffre. Spéciaux autorisés: ! _ - ."
              />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Téléphone" value={form.phone} onChange={(v: string) => setForm({ ...form, phone: v })} />
                <Field label="Société" value={form.company} onChange={(v: string) => setForm({ ...form, company: v })} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rôle *</label>
                <select
                  value={form.role}
                  onChange={(e) => {
                    const role = e.target.value as Role;
                    setForm({
                      ...form,
                      role,
                      organizationId: role === 'ROLE_HYPER_ADMIN' ? '' : form.organizationId || orgs[0]?.id || '',
                    });
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="ROLE_HYPER_ADMIN">Hyper Admin (toutes les organisations)</option>
                  <option value="ROLE_ADMIN">Admin (lecture/écriture dans son organisation)</option>
                  <option value="ROLE_USER">Coordonnateur (périmètre de son organisation)</option>
                </select>
              </div>

              {roleNeedsOrg && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Organisation *</label>
                  <select
                    value={form.organizationId}
                    required
                    onChange={(e) => setForm({ ...form, organizationId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {orgs.map((org) => (
                      <option key={org.id} value={org.id}>{org.name} - /{org.slug}</option>
                    ))}
                    {orgs.length === 0 && <option value="">Aucune organisation</option>}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <span className="text-sm">Compte actif</span>
              </label>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button type="button" onClick={close} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-100">Annuler</button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Enregistrement...' : editing ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const Field = ({
  label,
  value,
  onChange,
  type = 'text',
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
}) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
    />
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

const PasswordField = ({
  label,
  value,
  onChange,
  required,
  hint,
  visible,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  visible: boolean;
  onToggle: () => void;
}) => (
  <div>
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

const Stat = ({ icon, label, value }: { icon: ReactNode; label: string; value: number }) => (
  <div className="inline-flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg">
    {icon}
    <span className="text-slate-500">{label}:</span>
    <span className="font-semibold text-slate-900">{value}</span>
  </div>
);
