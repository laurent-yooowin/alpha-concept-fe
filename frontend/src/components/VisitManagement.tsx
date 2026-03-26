import { useState, useEffect } from 'react';
import { visitsAPI, missionsAPI, reportsAPI } from '../lib/api';
import { visitService } from '../services/visitService';
import { filesService } from '../services/filesService';
import { generatePdfService } from '../services/generatePdfService';
import { useAuth } from '../contexts/AuthContext';
import {
  Camera, Calendar, Search, Filter, Eye, FileText, AlertTriangle, CheckCircle,
  Clock, MapPin, Image as ImageIcon, X, ChevronDown, ChevronUp, RefreshCw,
  Plus, Trash2, Save, Send, Edit2, Download
} from 'lucide-react';
import Swal from 'sweetalert2';
import PhotoReportEditor from './PhotoReportEditor';

interface PhotoAnalysis {
  observation: string | string[];
  recommendation: string | string[];
  references?: string | string[];
  riskLevel: 'faible' | 'moyen' | 'eleve';
  confidence: number;
}

interface Photo {
  id: string;
  uri: string;
  s3Url?: string;
  analysis: PhotoAnalysis;
  comment?: string;
  userDirectives?: string;
  isDirectiveOnly?: boolean;
  validated: boolean;
  groupId?: string;
}

interface Visit {
  id: string;
  missionId: string;
  userId: string;
  visitDate: string;
  photos: Photo[];
  photoCount: number;
  notes?: string;
  reportGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  mission?: { id: string; title: string; client: string; address: string; status: string };
  user?: { firstName: string; lastName: string; email: string };
  report?: { id: string; status: string; title: string };
}

export default function VisitManagement() {
  const { profile: currentUser } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);
  const [filterMission, setFilterMission] = useState('all');
  const [missions, setMissions] = useState<any[]>([]);

  // Create visit
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMissionId, setCreateMissionId] = useState('');
  const [createVisitDate, setCreateVisitDate] = useState(new Date().toISOString().split('T')[0]);
  const [createNotes, setCreateNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit visit notes
  const [editingNotes, setEditingNotes] = useState(false);
  const [tempNotes, setTempNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Generate report
  const [generatingReport, setGeneratingReport] = useState(false);

  // Report detail modal
  const [showReportModal, setShowReportModal] = useState(false);
  const [visitReport, setVisitReport] = useState<any>(null);
  const [reportPhotos, setReportPhotos] = useState<any[]>([]);
  const [editedHeader, setEditedHeader] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [editedFooter, setEditedFooter] = useState('');
  const [editedObservations, setEditedObservations] = useState('');
  const [isEditingReport, setIsEditingReport] = useState(false);

  const isAdmin = currentUser?.role === 'ROLE_ADMIN';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [visitsData, missionsData] = await Promise.all([
        visitsAPI.getAll(),
        missionsAPI.getAll(),
      ]);
      setVisits(Array.isArray(visitsData) ? visitsData : []);
      setMissions(Array.isArray(missionsData) ? missionsData : []);
    } catch (error) {
      console.error('Erreur chargement visites:', error);
    }
    setLoading(false);
  };

  const handleCreateVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createMissionId) return;
    setCreating(true);
    try {
      await visitsAPI.create({
        missionId: createMissionId,
        visitDate: createVisitDate,
        notes: createNotes || undefined,
      });
      setShowCreateModal(false);
      setCreateMissionId('');
      setCreateVisitDate(new Date().toISOString().split('T')[0]);
      setCreateNotes('');
      await loadData();
      Swal.fire({ icon: 'success', title: 'Visite créée', timer: 1500, showConfirmButton: false });
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: error.message || 'Erreur lors de la création' });
    }
    setCreating(false);
  };

  const handleDeleteVisit = async (visit: Visit, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await Swal.fire({
      title: 'Confirmer la suppression',
      html: `Supprimer cette visite du <strong>${new Date(visit.visitDate).toLocaleDateString('fr-FR')}</strong> ?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Supprimer',
      cancelButtonText: 'Annuler',
    });
    if (result.isConfirmed) {
      try {
        await visitsAPI.delete(visit.id);
        if (selectedVisit?.id === visit.id) setSelectedVisit(null);
        await loadData();
        Swal.fire({ icon: 'success', title: 'Visite supprimée', timer: 1500, showConfirmButton: false });
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la suppression' });
      }
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedVisit) return;
    setSavingNotes(true);
    try {
      await visitsAPI.update(selectedVisit.id, { notes: tempNotes });
      setSelectedVisit(prev => prev ? { ...prev, notes: tempNotes } : null);
      setEditingNotes(false);
      Swal.fire({ icon: 'success', title: 'Notes sauvegardées', timer: 1500, showConfirmButton: false });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la sauvegarde' });
    }
    setSavingNotes(false);
  };

  const handleGenerateReport = async () => {
    if (!selectedVisit) return;
    const confirm = await Swal.fire({
      title: 'Générer un rapport',
      text: 'Voulez-vous générer un rapport à partir de cette visite ?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Générer',
      cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    setGeneratingReport(true);
    try {
      await visitsAPI.generateReport(selectedVisit.id, { notes: selectedVisit.notes });
      await loadData();
      // Reload selected visit
      const updated = await visitsAPI.getById(selectedVisit.id);
      setSelectedVisit(updated);
      Swal.fire({ icon: 'success', title: 'Rapport généré', timer: 2000, showConfirmButton: false });
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: error.message || 'Erreur lors de la génération' });
    }
    setGeneratingReport(false);
  };

  const openVisitReport = async () => {
    if (!selectedVisit?.report) return;
    try {
      const report = await reportsAPI.getById(selectedVisit.report.id);
      setVisitReport(report);
      setReportPhotos(report.visit?.photos || selectedVisit.photos || []);
      setEditedHeader(report.header || '');
      setEditedContent(report.content || '');
      setEditedFooter(report.footer || '');
      setEditedObservations(report.observations || '');
      setIsEditingReport(false);
      setShowReportModal(true);
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Impossible de charger le rapport' });
    }
  };

  const downloadImages = async (url: string) => {
    try {
      const response = await filesService.downloadFile(url, 'reports', true);
      const { base64 } = response.data;
      return base64;
    } catch (error) {
      console.error('Erreur téléchargement image:', error);
    }
  };

  const handleSaveReport = async () => {
    if (!visitReport) return;
    try {
      const resp = await reportsAPI.update(visitReport.id, {
        content: editedContent,
        header: editedHeader,
        footer: editedFooter,
        observations: editedObservations,
      });
      if (selectedVisit) {
        await visitService.update(visitReport.visitId, { photos: reportPhotos });
      }
      setVisitReport((prev: any) => prev ? { ...prev, ...resp } : null);
      setIsEditingReport(false);
      Swal.fire({ icon: 'success', title: 'Rapport sauvegardé', timer: 1500, showConfirmButton: false });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la sauvegarde' });
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'eleve': return 'bg-red-100 text-red-700 border-red-300';
      case 'moyen': return 'bg-amber-100 text-amber-700 border-amber-300';
      case 'faible': return 'bg-emerald-100 text-emerald-700 border-emerald-300';
      default: return 'bg-slate-100 text-slate-600 border-slate-300';
    }
  };

  const getRiskLabel = (level: string) => {
    switch (level) {
      case 'eleve': return 'Élevé';
      case 'moyen': return 'Moyen';
      case 'faible': return 'Faible';
      default: return level;
    }
  };

  const toArray = (val: string | string[] | undefined): string[] => {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  };

  const filteredVisits = visits.filter(visit => {
    const matchesSearch =
      visit.mission?.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      visit.mission?.client?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      visit.user?.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      visit.user?.lastName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesMission = filterMission === 'all' || visit.missionId === filterMission;
    return matchesSearch && matchesMission;
  });

  const photoGroups = (photos: Photo[]) => {
    const groups: { [key: string]: Photo[] } = {};
    photos?.forEach(photo => {
      const gid = photo.groupId || photo.id;
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(photo);
    });
    return Object.entries(groups);
  };

  const getPhotoCount = (visit: Visit) => {
    return visit.photoCount || visit.photos?.filter(p => !p.isDirectiveOnly)?.length || 0;
  };

  const getDirectiveCount = (visit: Visit) => {
    return visit.photos?.filter(p => p.isDirectiveOnly)?.length || 0;
  };

  const getRiskSummary = (visit: Visit) => {
    const high = visit.photos?.filter(p => p.analysis?.riskLevel === 'eleve')?.length || 0;
    const medium = visit.photos?.filter(p => p.analysis?.riskLevel === 'moyen')?.length || 0;
    const low = visit.photos?.filter(p => p.analysis?.riskLevel === 'faible')?.length || 0;
    return { high, medium, low };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'brouillon': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'envoye': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'valide': return 'bg-green-100 text-green-700 border-green-200';
      case 'envoye_au_client': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'annule': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'brouillon': return 'Brouillon';
      case 'envoye': return 'Soumis';
      case 'valide': return 'Validé';
      case 'envoye_au_client': return 'Envoyé au client';
      case 'annule': return 'Annulé';
      default: return status;
    }
  };

  // ─── SELECTED VISIT DETAIL VIEW ────────────────────────────
  if (selectedVisit) {
    const groups = photoGroups(selectedVisit.photos || []);
    const risks = getRiskSummary(selectedVisit);

    return (
      <div className="space-y-6">
        {/* Back button & header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setSelectedVisit(null); setEditingNotes(false); }}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            ← Retour aux visites
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900">
              {selectedVisit.mission?.title || 'Visite'}
            </h2>
            <p className="text-sm text-slate-500">
              {selectedVisit.mission?.client} — {selectedVisit.mission?.address}
            </p>
          </div>
          <div className="flex gap-2">
            {/* Generate report */}
            {!selectedVisit.reportGenerated && selectedVisit.photos?.length > 0 && (
              <button
                onClick={handleGenerateReport}
                disabled={generatingReport}
                className="flex items-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg hover:bg-prosps-blue-dark transition-colors text-sm font-medium disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                {generatingReport ? 'Génération...' : 'Générer rapport'}
              </button>
            )}
            {/* View report */}
            {selectedVisit.report && (
              <button
                onClick={openVisitReport}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
              >
                <Eye className="w-4 h-4" />
                Voir rapport
              </button>
            )}
            {/* Delete visit */}
            <button
              onClick={(e) => handleDeleteVisit(selectedVisit, e)}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer
            </button>
          </div>
        </div>

        {/* Visit info cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
              <Calendar className="w-4 h-4" /> Date de visite
            </div>
            <p className="font-semibold text-slate-900">
              {new Date(selectedVisit.visitDate).toLocaleDateString('fr-FR', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
              })}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
              <Camera className="w-4 h-4" /> Photos
            </div>
            <p className="font-semibold text-slate-900">
              {getPhotoCount(selectedVisit)} photo(s), {getDirectiveCount(selectedVisit)} directive(s)
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
              <AlertTriangle className="w-4 h-4" /> Risques
            </div>
            <div className="flex gap-2 mt-1">
              {risks.high > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{risks.high} élevé</span>}
              {risks.medium > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{risks.medium} moyen</span>}
              {risks.low > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">{risks.low} faible</span>}
              {risks.high === 0 && risks.medium === 0 && risks.low === 0 && <span className="text-sm text-slate-400">Aucun</span>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
              <FileText className="w-4 h-4" /> Rapport
            </div>
            <p className="font-semibold text-slate-900">
              {selectedVisit.reportGenerated ? (
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle className="w-4 h-4" /> Généré
                  {selectedVisit.report && (
                    <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(selectedVisit.report.status)}`}>
                      {getStatusLabel(selectedVisit.report.status)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-slate-400">
                  <Clock className="w-4 h-4" /> Non généré
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Coordinator */}
        {selectedVisit.user && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <span className="text-sm text-slate-500">Coordinateur :</span>
            <span className="ml-2 font-medium text-slate-900">
              {selectedVisit.user.firstName} {selectedVisit.user.lastName}
            </span>
            <span className="ml-2 text-sm text-slate-400">{selectedVisit.user.email}</span>
          </div>
        )}

        {/* Photo groups / Reports */}
        {groups.length > 0 ? (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-5 h-5 text-prosps-blue" />
              Rapports d'analyse ({groups.length})
            </h3>
            {groups.map(([groupId, groupPhotos], index) => {
              const firstPhoto = groupPhotos[0];
              const isDirectiveOnly = firstPhoto?.isDirectiveOnly;
              const isExpanded = expandedPhoto === groupId;
              const observations = toArray(firstPhoto?.analysis?.observation);
              const recommendations = toArray(firstPhoto?.analysis?.recommendation);
              const references = toArray(firstPhoto?.analysis?.references);
              const riskLevel = firstPhoto?.analysis?.riskLevel;

              return (
                <div key={groupId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  {/* Group header */}
                  <button
                    onClick={() => setExpandedPhoto(isExpanded ? null : groupId)}
                    className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-prosps-blue text-white flex items-center justify-center text-sm font-bold">
                        {index + 1}
                      </span>
                      <div className="text-left">
                        <span className="font-medium text-slate-900">
                          {isDirectiveOnly ? '📝 Directives du coordonnateur' : `📸 ${groupPhotos.length} photo(s)`}
                        </span>
                        {!isDirectiveOnly && (
                          <span className="ml-2 text-sm text-slate-400">
                            — Groupe {index + 1}
                          </span>
                        )}
                      </div>
                      {riskLevel && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getRiskColor(riskLevel)}`}>
                          {getRiskLabel(riskLevel)}
                        </span>
                      )}
                    </div>
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-5 pb-5 border-t border-slate-100">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                        {/* Photos */}
                        {!isDirectiveOnly && (
                          <div>
                            <h4 className="text-sm font-semibold text-slate-700 mb-3">Photos</h4>
                            <div className="grid grid-cols-2 gap-3">
                              {groupPhotos.map((photo, pIdx) => (
                                <div key={photo.id || pIdx} className="relative">
                                  {photo.uri ? (
                                    <img
                                      src={photo.uri}
                                      alt={`Photo ${pIdx + 1}`}
                                      className="w-full h-32 object-cover rounded-lg border border-slate-200"
                                    />
                                  ) : (
                                    <div className="w-full h-32 bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200">
                                      <ImageIcon className="w-8 h-8 text-slate-300" />
                                    </div>
                                  )}
                                  {photo.analysis?.riskLevel && (
                                    <span className={`absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold border ${getRiskColor(photo.analysis.riskLevel)}`}>
                                      {getRiskLabel(photo.analysis.riskLevel)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Analysis details */}
                        <div className={isDirectiveOnly ? 'lg:col-span-2' : ''}>
                          {observations.length > 0 && (
                            <div className="mb-4">
                              <h4 className="text-sm font-semibold text-slate-700 mb-2">🔍 Observations</h4>
                              <ul className="space-y-1">
                                {observations.map((obs, i) => (
                                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                                    <span className="text-prosps-blue mt-0.5">•</span> {obs}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {recommendations.length > 0 && (
                            <div className="mb-4">
                              <h4 className="text-sm font-semibold text-slate-700 mb-2">💡 Recommandations</h4>
                              <ul className="space-y-1">
                                {recommendations.map((rec, i) => (
                                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                                    <span className="text-amber-500 mt-0.5">•</span> {rec}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {references.length > 0 && (
                            <div className="mb-4">
                              <h4 className="text-sm font-semibold text-slate-700 mb-2">🏛️ Références</h4>
                              <ul className="space-y-1">
                                {references.map((ref, i) => (
                                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                                    <span className="text-slate-400 mt-0.5">•</span> {ref}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {firstPhoto?.userDirectives && (
                            <div className="mb-4">
                              <h4 className="text-sm font-semibold text-slate-700 mb-2">📋 Directives</h4>
                              <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{firstPhoto.userDirectives}</p>
                            </div>
                          )}

                          {firstPhoto?.comment && (
                            <div>
                              <h4 className="text-sm font-semibold text-slate-700 mb-2">💬 Commentaires</h4>
                              <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 italic">{firstPhoto.comment}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">Aucune photo pour cette visite</p>
          </div>
        )}

        {/* Global notes - editable */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-prosps-blue" />
              Notes / Directives globales
            </h3>
            {!editingNotes ? (
              <button
                onClick={() => { setEditingNotes(true); setTempNotes(selectedVisit.notes || ''); }}
                className="flex items-center gap-1 text-sm text-prosps-blue hover:underline"
              >
                <Edit2 className="w-3.5 h-3.5" /> Modifier
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingNotes(false)}
                  className="px-3 py-1 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-prosps-blue text-white rounded-lg hover:bg-prosps-blue-dark disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" /> {savingNotes ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            )}
          </div>
          {editingNotes ? (
            <textarea
              value={tempNotes}
              onChange={(e) => setTempNotes(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none text-sm"
              placeholder="Ajouter des notes ou directives globales..."
            />
          ) : (
            <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap">
              {selectedVisit.notes || <span className="text-slate-400 italic">Aucune note</span>}
            </div>
          )}
        </div>

        {/* Report detail modal */}
        {showReportModal && visitReport && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-xl max-w-4xl w-full my-8">
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Rapport de visite</h2>
                  <p className="text-sm text-slate-600 mt-1">{visitReport.title || selectedVisit.mission?.title}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(visitReport.status)}`}>
                    {getStatusLabel(visitReport.status)}
                  </span>
                  <button onClick={() => setShowReportModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-600">Client</p>
                      <p className="font-medium text-slate-900">{selectedVisit.mission?.client}</p>
                    </div>
                    <div>
                      <p className="text-slate-600">Date de création</p>
                      <p className="font-medium text-slate-900">{new Date(visitReport.createdAt).toLocaleDateString('fr-FR')}</p>
                    </div>
                    {visitReport.conformityPercentage != null && (
                      <div>
                        <p className="text-slate-600">Conformité</p>
                        <p className="font-medium text-slate-900">{visitReport.conformityPercentage}%</p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Contenu du rapport</label>
                  {isEditingReport ? (
                    <PhotoReportEditor
                      initialPhotos={visitReport.visit?.photos || selectedVisit.photos || []}
                      downloadImages={downloadImages}
                      isEditing={true}
                      editedFooter={editedFooter}
                      editedHeader={editedHeader}
                      onPhotosChange={setReportPhotos}
                      onHeaderChange={setEditedHeader}
                      onFooterChange={setEditedFooter}
                    />
                  ) : (
                    <PhotoReportEditor
                      initialPhotos={visitReport.visit?.photos || selectedVisit.photos || []}
                      downloadImages={downloadImages}
                      isEditing={false}
                      editedFooter={editedFooter}
                      editedHeader={editedHeader}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Observations</label>
                  {isEditingReport ? (
                    <textarea
                      value={editedObservations}
                      onChange={(e) => setEditedObservations(e.target.value)}
                      rows={4}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                    />
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap text-slate-900">
                      {editedObservations || 'Aucune observation'}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-slate-200 flex gap-3">
                <button
                  onClick={() => setShowReportModal(false)}
                  className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  Fermer
                </button>
                {visitReport.status !== 'envoye_au_client' && visitReport.status !== 'annule' && (
                  <>
                    {isEditingReport ? (
                      <>
                        <button
                          onClick={() => setIsEditingReport(false)}
                          className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                        >
                          Annuler
                        </button>
                        <button
                          onClick={handleSaveReport}
                          className="flex items-center gap-2 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Enregistrer
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setIsEditingReport(true)}
                        className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-6 py-3 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                      >
                        <Edit2 className="w-4 h-4" />
                        Modifier
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── VISITS LIST VIEW ──────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Camera className="w-7 h-7 text-prosps-blue" />
            Gestion des Visites
          </h1>
          <p className="text-slate-500 text-sm mt-1">{filteredVisits.length} visite(s) trouvée(s)</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-prosps-blue text-white rounded-lg hover:bg-prosps-blue-dark transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Nouvelle visite
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Actualiser
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher par chantier, client, coordinateur..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue/20 focus:border-prosps-blue"
          />
        </div>
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={filterMission}
            onChange={(e) => setFilterMission(e.target.value)}
            className="pl-10 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-prosps-blue/20 focus:border-prosps-blue appearance-none bg-white"
          >
            <option value="all">Tous les chantiers</option>
            {missions.map(m => (
              <option key={m.id} value={m.id}>{m.title} — {m.client}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Visits list */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
          Chargement des visites...
        </div>
      ) : filteredVisits.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune visite trouvée</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredVisits.map((visit) => {
            const risks = getRiskSummary(visit);
            return (
              <div
                key={visit.id}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-prosps-blue/30 cursor-pointer transition-all"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0" onClick={() => setSelectedVisit(visit)}>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-900 truncate">
                        {visit.mission?.title || 'Chantier inconnu'}
                      </h3>
                      {visit.reportGenerated && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                          <CheckCircle className="w-3 h-3" /> Rapport
                        </span>
                      )}
                      {visit.report && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(visit.report.status)}`}>
                          {getStatusLabel(visit.report.status)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(visit.visitDate).toLocaleDateString('fr-FR', {
                          day: 'numeric', month: 'long', year: 'numeric'
                        })}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {visit.mission?.client || '—'}
                      </span>
                      {visit.user && (
                        <span className="flex items-center gap-1">
                          👤 {visit.user.firstName} {visit.user.lastName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex items-center gap-1 text-slate-600">
                        <Camera className="w-4 h-4" />
                        {getPhotoCount(visit)}
                      </span>
                      {getDirectiveCount(visit) > 0 && (
                        <span className="flex items-center gap-1 text-slate-400 text-xs">
                          📝 {getDirectiveCount(visit)}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {risks.high > 0 && <span className="w-2.5 h-2.5 rounded-full bg-red-500" title={`${risks.high} élevé`} />}
                      {risks.medium > 0 && <span className="w-2.5 h-2.5 rounded-full bg-amber-500" title={`${risks.medium} moyen`} />}
                      {risks.low > 0 && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title={`${risks.low} faible`} />}
                    </div>
                    <button
                      onClick={(e) => handleDeleteVisit(visit, e)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <span
                      onClick={() => setSelectedVisit(visit)}
                      className="text-sm text-prosps-blue font-medium whitespace-nowrap cursor-pointer"
                    >
                      Voir détails →
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create visit modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Nouvelle visite</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateVisit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Chantier *</label>
                <select
                  value={createMissionId}
                  onChange={(e) => setCreateMissionId(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  required
                >
                  <option value="">Sélectionner un chantier</option>
                  {missions.filter(m => m.status !== 'terminee' && m.status !== 'annulee').map(m => (
                    <option key={m.id} value={m.id}>{m.title} — {m.client}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Date de visite *</label>
                <input
                  type="date"
                  value={createVisitDate}
                  onChange={(e) => setCreateVisitDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
                <textarea
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
                  placeholder="Notes ou directives pour cette visite..."
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 bg-prosps-blue text-white px-6 py-3 rounded-lg hover:bg-prosps-blue-dark transition-colors font-medium disabled:opacity-50"
                >
                  {creating ? 'Création...' : 'Créer la visite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
