import { useState, useEffect } from 'react';
import { usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Edit2, UserX, UserCheck, Search, Filter, Eye, EyeOff } from 'lucide-react';
import Swal from 'sweetalert2';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: 'ROLE_ADMIN' | 'ROLE_USER';
  address: string | null;
  company: string | null;
  experience: number | null;
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
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [experienceError, setExperienceError] = useState('');

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    role: 'ROLE_USER' as 'ROLE_ADMIN' | 'ROLE_USER',
    address: '',
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
      Swal.fire({
        icon: 'error',
        title: 'Erreur',
        text: 'Impossible de charger les utilisateurs',
        confirmButtonColor: '#3b82f6',
      });
    }
    setLoading(false);
  };

  const handleApiError = (error: any, defaultMessage: string) => {
    console.error('API Error:', error);

    // Gérer les erreurs 400 (validation)
    if (error?.response?.status === 400) {
      const backendErrors = error?.response?.data?.message;

      // Si c'est un array de messages
      if (Array.isArray(backendErrors)) {
        const errorList = backendErrors.map((err: string) => `• ${err}`).join('<br>');
        Swal.fire({
          icon: 'error',
          title: 'Erreurs de validation',
          html: errorList,
          confirmButtonColor: '#3b82f6',
        });
      } else {
        // Si c'est un seul message
        Swal.fire({
          icon: 'error',
          title: 'Erreur de validation',
          text: backendErrors || 'Données invalides',
          confirmButtonColor: '#3b82f6',
        });
      }
    } else if (error?.response?.status === 409) {
      // Conflit (email déjà existant)
      Swal.fire({
        icon: 'error',
        title: 'Conflit',
        text: error?.response?.data?.message || 'Cet email est déjà utilisé',
        confirmButtonColor: '#3b82f6',
      });
    } else if (error?.response?.status === 401) {
      // Non autorisé
      Swal.fire({
        icon: 'error',
        title: 'Non autorisé',
        text: 'Vous n\'êtes pas autorisé à effectuer cette action',
        confirmButtonColor: '#3b82f6',
      });
    } else if (error?.response?.status === 403) {
      // Interdit
      Swal.fire({
        icon: 'error',
        title: 'Accès interdit',
        text: 'Vous n\'avez pas les permissions nécessaires',
        confirmButtonColor: '#3b82f6',
      });
    } else if (error?.response?.status === 404) {
      // Non trouvé
      Swal.fire({
        icon: 'error',
        title: 'Non trouvé',
        text: 'La ressource demandée n\'existe pas',
        confirmButtonColor: '#3b82f6',
      });
    } else {
      // Autres erreurs
      Swal.fire({
        icon: 'error',
        title: 'Erreur',
        text: error?.response?.data?.message || defaultMessage,
        confirmButtonColor: '#3b82f6',
      });
    }
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (!email) {
      setEmailError('L\'email est requis');
      return false;
    }

    if (!emailRegex.test(email)) {
      setEmailError('Format d\'email invalide');
      return false;
    }

    setEmailError('');
    return true;
  };

  const validatePassword = (password: string, isRequired: boolean = true): boolean => {
    // Si le mot de passe est vide et optionnel, c'est valide
    if (!password && !isRequired) {
      setPasswordError('');
      return true;
    }

    // Si le mot de passe est vide et requis, c'est invalide
    if (!password && isRequired) {
      setPasswordError('Le mot de passe est requis');
      return false;
    }

    const minLength = 6;
    const maxLength = 16;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    if (password.length < minLength) {
      setPasswordError('Le mot de passe doit contenir au moins 6 caractères');
      return false;
    }
    if (password.length > maxLength) {
      setPasswordError('Le mot de passe ne peut pas dépasser 16 caractères');
      return false;
    }
    if (!hasUpperCase) {
      setPasswordError('Le mot de passe doit contenir au moins une majuscule');
      return false;
    }
    if (!hasLowerCase) {
      setPasswordError('Le mot de passe doit contenir au moins une minuscule');
      return false;
    }
    if (!hasNumber) {
      setPasswordError('Le mot de passe doit contenir au moins un chiffre');
      return false;
    }

    setPasswordError('');
    return true;
  };

  const validateExperience = (experience: string): boolean => {
    if (!experience) {
      setExperienceError('');
      return true; // Optionnel
    }

    const expNumber = parseInt(experience, 10);

    if (isNaN(expNumber)) {
      setExperienceError('L\'expérience doit être un nombre');
      return false;
    }

    if (expNumber < 0) {
      setExperienceError('L\'expérience doit être positive');
      return false;
    }

    if (expNumber > 99) {
      setExperienceError('L\'expérience ne peut pas dépasser 99 ans');
      return false;
    }

    setExperienceError('');
    return true;
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    // Valider l'email
    if (!validateEmail(formData.email)) {
      Swal.fire({
        icon: 'error',
        title: 'Email invalide',
        text: emailError,
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    // Valider le mot de passe (requis en création)
    if (!validatePassword(formData.password, true)) {
      Swal.fire({
        icon: 'error',
        title: 'Mot de passe invalide',
        text: passwordError,
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    // Valider l'expérience
    if (formData.experience && !validateExperience(formData.experience)) {
      Swal.fire({
        icon: 'error',
        title: 'Expérience invalide',
        text: experienceError,
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    try {
      await usersAPI.create({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone || null,
        role: formData.role,
        address: formData.address || null,
        company: formData.company || null,
        experience: formData.experience ? parseInt(formData.experience, 10) : null,
        isActive: formData.isActive,
      });

      setShowModal(false);
      resetForm();
      fetchUsers();

      Swal.fire({
        icon: 'success',
        title: 'Succès',
        text: 'Utilisateur créé avec succès',
        confirmButtonColor: '#3b82f6',
        timer: 3000,
        timerProgressBar: true,
      });
    } catch (error: any) {
      handleApiError(error, 'Erreur lors de la création de l\'utilisateur');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !isAdmin) return;

    // Valider l'expérience si modifiée
    if (formData.experience && !validateExperience(formData.experience)) {
      Swal.fire({
        icon: 'error',
        title: 'Expérience invalide',
        text: experienceError,
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    // Valider le mot de passe seulement s'il est renseigné
    if (formData.password && !validatePassword(formData.password, false)) {
      Swal.fire({
        icon: 'error',
        title: 'Mot de passe invalide',
        text: passwordError,
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    try {
      // Préparer les données à envoyer
      const updateData: any = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone || null,
        role: formData.role,
        address: formData.address || null,
        company: formData.company || null,
        experience: formData.experience ? parseInt(formData.experience, 10) : null,
        isActive: formData.isActive,
      };

      // Ajouter le mot de passe seulement s'il est renseigné
      if (formData.password) {
        updateData.password = formData.password;
      }

      await usersAPI.update(editingUser.id, updateData);

      setShowModal(false);
      setEditingUser(null);
      resetForm();
      fetchUsers();

      Swal.fire({
        icon: 'success',
        title: 'Succès',
        text: 'Utilisateur mis à jour avec succès',
        confirmButtonColor: '#3b82f6',
        timer: 3000,
        timerProgressBar: true,
      });
    } catch (error: any) {
      handleApiError(error, 'Erreur lors de la mise à jour');
    }
  };

  const toggleUserStatus = async (user: User) => {
    if (!isAdmin) return;

    const result = await Swal.fire({
      title: 'Êtes-vous sûr ?',
      text: `Voulez-vous ${user.isActive ? 'désactiver' : 'activer'} cet utilisateur ?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3b82f6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Oui, confirmer',
      cancelButtonText: 'Annuler',
    });

    if (result.isConfirmed) {
      try {
        await usersAPI.update(user.id, {
          isActive: !user.isActive,
        });
        fetchUsers();

        Swal.fire({
          icon: 'success',
          title: 'Succès',
          text: `Utilisateur ${!user.isActive ? 'activé' : 'désactivé'} avec succès`,
          confirmButtonColor: '#3b82f6',
          timer: 2000,
          timerProgressBar: true,
        });
      } catch (error) {
        console.error('Error toggling user status:', error);
        Swal.fire({
          icon: 'error',
          title: 'Erreur',
          text: 'Impossible de modifier le statut',
          confirmButtonColor: '#3b82f6',
        });
      }
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
      company: '',
      experience: '',
      isActive: true,
    });
    setPasswordError('');
    setEmailError('');
    setExperienceError('');
    setShowPassword(false);
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
      company: user.company || '',
      experience: user.experience ? user.experience.toString() : '',
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
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-red-600 hover:bg-red-50'
                            }`}
                          title={user.isActive ? 'Désactiver' : 'Activer'}
                        >
                          {!user.isActive ? <UserX className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
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

              {/* Champ Email - seulement en création */}
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => {
                      setFormData({ ...formData, email: e.target.value });
                      if (e.target.value) {
                        validateEmail(e.target.value);
                      } else {
                        setEmailError('');
                      }
                    }}
                    pattern="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
                    className={`w-full px-4 py-2 border ${emailError ? 'border-red-500' : 'border-slate-300'
                      } rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none`}
                    required
                  />
                  {emailError && (
                    <p className="mt-1 text-sm text-red-600">{emailError}</p>
                  )}
                </div>
              )}

              {/* Champ Mot de passe - toujours affiché mais optionnel en mode édition */}
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Mot de passe {editingUser && <span className="text-slate-500 text-xs">(laisser vide pour ne pas modifier)</span>}
                </label>

                <input
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({ ...formData, password: e.target.value });
                    if (e.target.value) {
                      validatePassword(e.target.value, !editingUser);
                    } else {
                      setPasswordError('');
                    }
                  }}
                  pattern={formData.password ? "^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{6,16}$" : undefined}
                  className={`w-full px-4 py-2 pr-10 border ${passwordError ? 'border-red-500' : 'border-slate-300'
                    } rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none`}
                  required={!editingUser}
                  minLength={formData.password ? 6 : undefined}
                  maxLength={16}
                  placeholder={editingUser ? "Nouveau mot de passe (optionnel)" : ""}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                  style={{ top: '3rem' }}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>

                {passwordError && (
                  <p className="mt-1 text-sm text-red-600">{passwordError}</p>
                )}

                <p className="mt-2 text-xs text-slate-500">
                  {editingUser
                    ? "Si vous souhaitez modifier le mot de passe, il doit contenir entre 6 et 16 caractères, une majuscule, une minuscule et un chiffre."
                    : "Le mot de passe doit contenir entre 6 et 16 caractères, une majuscule, une minuscule et un chiffre. Caractères spéciaux autorisés: ! _ - ."
                  }
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Téléphone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Rôle</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
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
                    type="number"
                    value={formData.experience}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, experience: value });
                      if (value) {
                        validateExperience(value);
                      } else {
                        setExperienceError('');
                      }
                    }}
                    min="0"
                    max="99"
                    className={`w-full px-4 py-2 border ${experienceError ? 'border-red-500' : 'border-slate-300'
                      } rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none`}
                    placeholder="Ex: 5"
                  />
                  {experienceError && (
                    <p className="mt-1 text-sm text-red-600">{experienceError}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Nombre d'années d'expérience (0-99)
                  </p>
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