import { useState, useEffect } from 'react';
import { missionsAPI, usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Plus, Search, Filter, Calendar, MapPin, User, Clock, Upload, X, CheckCircle, AlertCircle, Trash2, Edit } from 'lucide-react';
import Swal from 'sweetalert2';

interface Mission {
  id: string;
  title: string;
  client: string;
  address: string;
  date: string;
  endDate: string;
  refBusiness: string;
  refClient: string;
  time: string;
  type: string;
  description: string | null;
  status: string;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  userId: string;
  user?: {
    firstName: string;
    lastName: string;
  };
}

export default function MissionManagement() {
  const { profile: currentUser } = useAuth();
  const [missions, setMissions] = useState < Mission[] > ([]);
  const [coordinators, setCoordinators] = useState < any[] > ([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState < string > ('all');
  const [importFile, setImportFile] = useState < File | null > (null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState < any > (null);
  const [selectedMission, setSelectedMission] = useState < Mission | null > (null);

  const [formData, setFormData] = useState({
    title: '',
    client: '',
    refClient: '',
    address: '',
    date: '',
    time: '',
    endDate: '',
    refBusiness: '',
    type: 'CSPS',
    description: '',
    contactFirstName: '',
    contactLastName: '',
    contactEmail: '',
    contactPhone: '',
    userId: '',
  });

  const isAdmin = currentUser?.role === 'ROLE_ADMIN';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [missionsData, usersData] = await Promise.all([
        missionsAPI.getAll(),
        usersAPI.getAll(),
      ]);

      setMissions(missionsData);
      setCoordinators(usersData.filter((u: any) => u.role === 'ROLE_USER' && u.isActive));
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setLoading(false);
  };

  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    try {
      await missionsAPI.create({
        title: formData.title,
        client: formData.client,
        refClient: formData.refClient || null,
        address: formData.address,
        date: formData.date,
        time: formData.time,
        endDate: formData.endDate,
        refBusiness: formData.refBusiness,
        type: formData.type,
        description: formData.description || null,
        contactFirstName: formData.contactFirstName || null,
        contactLastName: formData.contactLastName || null,
        contactEmail: formData.contactEmail || null,
        contactPhone: formData.contactPhone || null,
        userId: formData.userId || currentUser?.id,
      });

      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Error creating mission:', error);
      alert('Erreur lors de la création de la mission');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      client: '',
      refClient: '',
      address: '',
      date: '',
      time: '',
      endDate: '',
      refBusiness: '',
      type: 'CSPS',
      description: '',
      contactFirstName: '',
      contactLastName: '',
      contactEmail: '',
      contactPhone: '',
      userId: '',
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      if (fileExtension === 'csv' || fileExtension === 'xlsx' || fileExtension === 'xls') {
        setImportFile(file);
        setImportResult(null);
      } else {
        alert('Veuillez sélectionner un fichier CSV ou Excel (.csv, .xlsx, .xls)');
      }
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      alert('Veuillez sélectionner un fichier');
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', importFile);

      const result = await missionsAPI.bulkImport(formData);
      setImportResult(result);

      if (result.data.summary.imported > 0) {
        fetchData();
      }
    } catch (error: any) {
      console.error('Error importing missions:', error);
      setImportResult({
        success: false,
        message: error.message || 'Erreur lors de l\'import du fichier',
        data: null,
      });
    } finally {
      setImporting(false);
    }
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportFile(null);
    setImportResult(null);
  };

  const handleRowClick = (mission: Mission) => {
    if (!isAdmin) return;

    if (mission.status == 'terminee') return;

    setSelectedMission(mission);
    setFormData({
      title: mission.title,
      client: mission.client,
      refClient: (mission as any).refClient || '',
      address: mission.address,
      date: mission.date,
      time: mission.time,
      type: mission.type,
      endDate: mission.endDate,
      refBusiness: mission.refBusiness,
      description: mission.description || '',
      contactFirstName: mission.contactFirstName || '',
      contactLastName: mission.contactLastName || '',
      contactEmail: mission.contactEmail || '',
      contactPhone: mission.contactPhone || '',
      userId: mission.userId,
    });
    setShowEditModal(true);
  };

  const handleUpdateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !selectedMission) return;

    if (selectedMission.status == 'terminee') return;

    try {
      await missionsAPI.update(selectedMission.id, {
        title: formData.title,
        client: formData.client,
        refClient: formData.refClient || null,
        address: formData.address,
        date: formData.date,
        time: formData.time || null,
        endDate: formData.endDate || null,
        refBusiness: formData.refBusiness || null,
        type: formData.type,
        description: formData.description || null,
        contactFirstName: formData.contactFirstName || null,
        contactLastName: formData.contactLastName || null,
        contactEmail: formData.contactEmail || null,
        contactPhone: formData.contactPhone || null,
        userId: formData.userId || null,
      });

      setShowEditModal(false);
      setSelectedMission(null);
      resetForm();
      fetchData();

      Swal.fire({
        icon: 'success',
        title: 'Mission modifiée',
        text: 'La mission a été modifiée avec succès',
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error('Error updating mission:', error);
      Swal.fire({
        icon: 'error',
        title: 'Erreur',
        text: 'Erreur lors de la modification de la mission',
      });
    }
  };

  const handleDeleteMission = async (mission: Mission, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isAdmin) return;

    if (mission.status == 'terminee') return;

    const result = await Swal.fire({
      title: 'Confirmer la suppression',
      html: `Êtes-vous sûr de vouloir supprimer la mission :<br/><strong>${mission.title}</strong> ?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Oui, supprimer',
      cancelButtonText: 'Annuler',
    });

    if (result.isConfirmed) {
      try {
        await missionsAPI.delete(mission.id);
        fetchData();

        Swal.fire({
          icon: 'success',
          title: 'Mission supprimée',
          text: 'La mission a été supprimée avec succès',
          timer: 2000,
          showConfirmButton: false,
        });
      } catch (error) {
        console.error('Error deleting mission:', error);
        Swal.fire({
          icon: 'error',
          title: 'Erreur',
          text: 'Erreur lors de la suppression de la mission',
        });
      }
    }
  };

  const filteredMissions = missions.filter(mission => {
    const matchesSearch =
      mission.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mission.client?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mission.address?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mission.refClient?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mission.refBusiness?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || mission.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assignee': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'planifiee': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'affectee': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'refusee': return 'bg-red-100 text-red-700 border-red-200';
      case 'en_cours': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'terminee': return 'bg-green-100 text-green-700 border-green-200';
      case 'annulee': return 'bg-slate-100 text-slate-700 border-slate-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'assignee': return 'Assignée';
      case 'planifiee': return 'Planifiée';
      case 'affectee': return 'Affectée';
      case 'refusee': return 'Refusée';
      case 'en_cours': return 'En cours';
      case 'terminee': return 'Terminée';
      case 'annulee': return 'Annulée';
      default: return status;
    }
  };

  if (loading) {
    return <div className="text-center py-12">Chargement...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Gestion des missions</h1>
          <p className="text-slate-600 mt-1">{missions.length} mission(s) au total</p>
        </div>
        {isAdmin && (
          <div className="flex gap-3">
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 bg-amber-600 text-white px-6 py-3 rounded-lg hover:bg-amber-700 transition-colors"
            >
              <Upload className="w-5 h-5" />
              Importer missions
            </button>
            <button
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors"
            >
              <Plus className="w-5 h-5" />
              Nouvelle mission
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par titre, client, adresse..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="pl-10 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none appearance-none bg-white"
            >
              <option value="all">Tous les statuts</option>
              <option value="planifiee">Planifiée</option>
              <option value="affectee">Affectée</option>
              <option value="en_cours">En cours</option>
              <option value="terminee">Terminée</option>
              <option value="refusee">Refusée</option>
              <option value="annulee">Annulée</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Mission</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Client</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Date & Heure</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Type</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Coordonnateur</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredMissions.map((mission) => (
                <tr
                  key={mission.id}
                  onClick={() => handleRowClick(mission)}
                  className={`transition-colors ${isAdmin ? 'hover:bg-slate-50 cursor-pointer' : ''}`}
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium text-slate-900">{mission.title}</p>
                      <div className="flex items-center gap-1 text-sm text-slate-600 mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {mission.address}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    {mission.client}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 text-sm text-slate-700">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(mission.date).toLocaleDateString('fr-FR')}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                      <Clock className="w-3 h-3" />
                      {mission.time}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-700 capitalize">{mission.type}</span>
                  </td>
                  <td className="px-6 py-4">
                    {mission.user ? (
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-700">
                          {mission.user.firstName} {mission.user.lastName}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">Non affecté</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-8">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(mission.status)}`}>
                        {getStatusLabel(mission.status)}
                      </span>
                      {isAdmin && mission.status != 'terminee' && mission.status != 'en_cours' && !mission.assigned && (
                        <button
                          onClick={(e) => handleDeleteMission(mission, e)}
                          className="p-2 hover:bg-red-100 rounded-lg transition-colors group"
                          title="Supprimer la mission"
                        >
                          <Trash2 className="w-4 h-4 text-slate-400 group-hover:text-red-600" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Nouvelle mission</h2>
            </div>

            <form onSubmit={handleCreateMission} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Titre de la mission *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Client *</label>
                  <input
                    type="text"
                    value={formData.client}
                    onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Référence client</label>
                  <input
                    type="text"
                    value={formData.refClient}
                    onChange={(e) => setFormData({ ...formData, refClient: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Type de mission *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  >
                    <option value="CSPS">CSPS</option>
                    <option value="AEU">AEU</option>
                    <option value="Divers">Divers</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Adresse du chantier *</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Date de début *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Heure de début</label>
                  <input
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"

                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Date de fin</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"

                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Référence affaire </label>
                  <input
                    type="text"
                    value={formData.refBusiness}
                    onChange={(e) => setFormData({ ...formData, refBusiness: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"

                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Coordonnateur *</label>
                <select
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                >
                  <option value="">Non affecté</option>
                  {coordinators.map(coord => (
                    <option key={coord.id} value={coord.id}>
                      {coord.firstName} {coord.lastName} {coord.zoneGeographique ? `(${coord.zoneGeographique})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-200 pt-4 mt-4">
                <h3 className="font-semibold text-slate-900 mb-4">Interloculeur *</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Prénom *</label>
                    <input
                      type="text"
                      value={formData.contactFirstName}
                      onChange={(e) => setFormData({ ...formData, contactFirstName: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Nom *</label>
                    <input
                      type="text"
                      value={formData.contactLastName}
                      onChange={(e) => setFormData({ ...formData, contactLastName: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Email *</label>
                    <input
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Téléphone *</label>
                    <input
                      type="tel"
                      value={formData.contactPhone}
                      onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Description / Consignes</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium"
                >
                  Créer la mission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Importer des missions</h2>
              <button
                onClick={closeImportModal}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {!importResult ? (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-900 mb-2">Format du fichier</h3>
                    <p className="text-sm text-blue-800 mb-2">
                      Formats acceptés : CSV, Excel (.xlsx, .xls)
                    </p>
                    <p className="text-sm text-blue-800">
                      Le fichier doit contenir les colonnes nécessaires pour créer les missions.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Sélectionner un fichier
                    </label>
                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-prosps-blue transition-colors">
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-upload"
                      />
                      <label
                        htmlFor="file-upload"
                        className="cursor-pointer flex flex-col items-center"
                      >
                        <Upload className="w-12 h-12 text-slate-400 mb-3" />
                        <span className="text-slate-700 font-medium mb-1">
                          Cliquez pour sélectionner un fichier
                        </span>
                        <span className="text-sm text-slate-500">
                          CSV, XLSX ou XLS
                        </span>
                      </label>
                    </div>
                    {importFile && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        Fichier sélectionné : <span className="font-medium">{importFile.name}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={closeImportModal}
                      className="flex-1 px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={!importFile || importing}
                      className="flex-1 bg-amber-600 text-white px-6 py-3 rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {importing ? 'Import en cours...' : 'Importer'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={`border rounded-lg p-4 ${importResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-start gap-3">
                      {importResult.success ? (
                        <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <h3 className={`font-semibold mb-1 ${importResult.success ? 'text-green-900' : 'text-red-900'}`}>
                          {importResult.success ? 'Import terminé' : 'Erreur d\'import'}
                        </h3>
                        <p className={`text-sm ${importResult.success ? 'text-green-800' : 'text-red-800'}`}>
                          {importResult.message}
                        </p>
                      </div>
                    </div>
                  </div>

                  {importResult.data && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-4 gap-4">
                        <div className="bg-slate-100 rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-slate-900">{importResult.data.summary.total}</div>
                          <div className="text-sm text-slate-600">Total</div>
                        </div>
                        <div className="bg-green-100 rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-green-900">{importResult.data.summary.imported}</div>
                          <div className="text-sm text-green-700">Importées</div>
                        </div>
                        <div className="bg-amber-100 rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-amber-900">{importResult.data.summary.ignored}</div>
                          <div className="text-sm text-amber-700">Ignorées</div>
                        </div>
                        <div className="bg-red-100 rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-red-900">{importResult.data.summary.failed}</div>
                          <div className="text-sm text-red-700">Échecs</div>
                        </div>
                      </div>

                      {importResult.data.errors && importResult.data.errors.length > 0 && (
                        <div className="border border-red-200 rounded-lg p-4 bg-red-50">
                          <h4 className="font-semibold text-red-900 mb-2">Erreurs détaillées</h4>
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {importResult.data.errors.map((error: any, index: number) => (
                              <div key={index} className="text-sm text-red-800 bg-white rounded p-2">
                                <span className="font-medium">Ligne {error.row || index + 1}:</span> {error.error || error.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {importResult.data.ignoredMissions && importResult.data.ignoredMissions.length > 0 && (
                        <div className="border border-amber-200 rounded-lg p-4 bg-amber-50">
                          <h4 className="font-semibold text-amber-900 mb-2">Missions ignorées</h4>
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {importResult.data.ignoredMissions.map((ignored: any, index: number) => (
                              <div key={index} className="text-sm text-amber-800 bg-white rounded p-2">
                                {ignored.title || `Mission ${index + 1}`}: {ignored.reason}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={closeImportModal}
                      className="flex-1 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium"
                    >
                      Fermer
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showEditModal && selectedMission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Edit className="w-6 h-6 text-prosps-blue" />
                <h2 className="text-2xl font-bold text-slate-900">Modifier la mission</h2>
              </div>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedMission(null);
                  resetForm();
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateMission} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Titre de la mission *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Client *</label>
                  <input
                    type="text"
                    value={formData.client}
                    onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Référence client</label>
                  <input
                    type="text"
                    value={formData.refClient}
                    onChange={(e) => setFormData({ ...formData, refClient: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Type de mission *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  >
                    <option value="CSPS">CSPS</option>
                    <option value="AEU">AEU</option>
                    <option value="Divers">Divers</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Adresse du chantier *</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Date de début *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Heure de début</label>
                  <input
                    type="time"
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"

                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Date de fin</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"

                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Référence affaire </label>
                  <input
                    type="text"
                    value={formData.refBusiness}
                    onChange={(e) => setFormData({ ...formData, refBusiness: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"

                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Coordonnateur (optionnel)</label>
                <select
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                >
                  <option value="">Non affecté</option>
                  {coordinators.map(coord => (
                    <option key={coord.id} value={coord.id}>
                      {coord.firstName} {coord.lastName} {coord.zoneGeographique ? `(${coord.zoneGeographique})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-200 pt-4 mt-4">
                <h3 className="font-semibold text-slate-900 mb-4">Contact sur site (optionnel)</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Prénom</label>
                    <input
                      type="text"
                      value={formData.contactFirstName}
                      onChange={(e) => setFormData({ ...formData, contactFirstName: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Nom</label>
                    <input
                      type="text"
                      value={formData.contactLastName}
                      onChange={(e) => setFormData({ ...formData, contactLastName: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Téléphone</label>
                    <input
                      type="tel"
                      value={formData.contactPhone}
                      onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Description / Consignes</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedMission(null);
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
                  Modifier la mission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
