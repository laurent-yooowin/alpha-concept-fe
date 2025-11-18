import { useState, useEffect } from 'react';
import { usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Edit2, UserX, UserCheck, Search, Filter } from 'lucide-react';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: 'ROLE_ADMIN' | 'ROLE_USER';
  address: string | null;
  // specialite: string | null;
  company: string | null;
  experience: string | null;
  isActive: boolean;
  created_at: string;
}

export default function UserManagement() {
  const { profile: currentUser } = useAuth();
  const [users, setUsers] = useState < User[] > ([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState < User | null > (null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState < string > ('all');

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    role: 'ROLE_USER' as 'ROLE_ADMIN' | 'ROLE_USER',
    address: '',
    // specialite: '',
    company: '',
    experience: '',
    isActive: true,
  });

  const isAdmin = currentUser?.role === 'ROLE_ADMIN';

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await usersAPI.getAll();
      setUsers(data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
    setLoading(false);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    try {
      await usersAPI.create({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone || null,
        role: formData.role,
        address: formData.address || null,
        // specialite: formData.specialite || null,
        company: formData.company || null,
        experience: formData.experience || null,
        isActive: formData.isActive,
      });

      setShowModal(false);
      resetForm();
      fetchUsers();
    } catch (error) {
      console.error('Error creating user:', error);
      alert('Erreur lors de la création de l\'utilisateur');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !isAdmin) return;

    try {
      await usersAPI.update(editingUser.id, {
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone || null,
        role: formData.role,
        address: formData.address || null,
        // specialite: formData.specialite || null,
        company: formData.company || null,
        experience: formData.experience || null,
        isActive: formData.isActive,
      });

      setShowModal(false);
      setEditingUser(null);
      resetForm();
      fetchUsers();
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Erreur lors de la mise à jour');
    }
  };

  const toggleUserStatus = async (user: User) => {
    if (!isAdmin) return;

    try {
      await usersAPI.update(user.id, {
        isActive: !user.isActive,
      });
      fetchUsers();
    } catch (error) {
      console.error('Error toggling user status:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      phone: '',
      role: 'ROLE_USER',
      address: '',
      // specialite: '',
      company: '',
      experience: '',
      isActive: true,
    });
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      password: '',
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone || '',
      role: user.role,
      address: user.address || '',
      // specialite: user.specialite || '',
      company: user.company || '',
      experience: user.experience || '',
      isActive: user.isActive,
    });
    setShowModal(true);
  };

  const filteredUsers = users?.filter(user => {
    const matchesSearch =
      user.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = roleFilter === 'all' || user.role === roleFilter;

    return matchesSearch && matchesRole;
  });

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'ROLE_ADMIN': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'ROLE_USER': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ROLE_ADMIN': return 'Administrateur';
      case 'ROLE_USER': return 'Coordonnateur';
      default: return role;
    }
  };

  if (loading) {
    return <div className="text-center py-12">Chargement...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Gestion des utilisateurs</h1>
          <p className="text-slate-600 mt-1">{users.length} utilisateur(s) au total</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              setEditingUser(null);
              resetForm();
              setShowModal(true);
            }}
            className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors"
          >
            <Plus className="w-5 h-5" />
            Nouvel utilisateur
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par nom ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="pl-10 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none appearance-none bg-white"
            >
              <option value="all">Tous les rôles</option>
              <option value="ROLE_ADMIN">Administrateur</option>
              <option value="ROLE_USER">Coordonnateur</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Utilisateur</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Contact</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Rôle</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Email</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Statut</th>
                {isAdmin && (
                  <th className="text-right px-6 py-3 text-sm font-semibold text-slate-900">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-slate-900">
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="text-sm text-slate-600">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {user.phone || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getRoleBadgeColor(user.role)}`}>
                      {getRoleLabel(user.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {user.email ? (
                      <div>
                        {user.email && <div>{user.email}</div>}
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${user.isActive
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}>
                      {user.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Modifier"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleUserStatus(user)}
                          className={`p-2 rounded-lg transition-colors ${user.isActive
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-green-600 hover:bg-green-50'
                            }`}
                          title={user.isActive ? 'Désactiver' : 'Activer'}
                        >
                          {user.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">
                {editingUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
              </h2>
            </div>

            <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Prénom</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nom</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              {!editingUser && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Mot de passe temporaire</label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                      required
                      minLength={6}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Téléphone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Rôle</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                  required
                >
                  <option value="ROLE_USER">Coordonnateur</option>
                  <option value="ROLE_ADMIN">Administrateur</option>
                </select>
              </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Adresse</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  />
                </div>
              {/* <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Spécialité</label>
                  <input
                    type="text"
                    value={formData.specialite}
                    onChange={(e) => setFormData({ ...formData, specialite: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  />
                </div>
              </div>  */}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Entreprise</label>
                  <input
                    type="text"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Expérience</label>
                  <input
                    type="text"
                    value={formData.experience}
                    onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    placeholder="Ex: 5 ans"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 text-prosps-blue border-slate-300 rounded focus:ring-2 focus:ring-prosps-blue"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Compte actif
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingUser(null);
                    resetForm();
                  }}
                  className="flex-1 px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium"
                >
                  {editingUser ? 'Mettre à jour' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
