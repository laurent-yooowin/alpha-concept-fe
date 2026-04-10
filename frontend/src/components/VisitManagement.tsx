import { useState, useEffect, useRef, useMemo } from 'react';
import { visitsAPI, missionsAPI, reportsAPI } from '../lib/api';
import { visitService } from '../services/visitService';
import { filesService } from '../services/filesService';
import { uploadService } from '../services/uploadService';
import { aiService, AIAnalysis } from '../services/aiService';
import { generatePdfService } from '../services/generatePdfService';
import { useAuth } from '../contexts/AuthContext';
import {
  Camera, Calendar, Search, Filter, Eye, FileText, AlertTriangle, CheckCircle,
  Clock, MapPin, Image as ImageIcon, X, ChevronDown, ChevronUp, RefreshCw,
  Plus, Trash2, Save, Send, Edit2, Download, Loader2, Upload, Sparkles,
  Pencil, RotateCcw, MessageSquare, Paperclip
} from 'lucide-react';
import Swal from 'sweetalert2';
import PhotoReportEditor from './PhotoReportEditor';
import MissionReportModal from './MissionReportModal';

// ─── TYPES ───────────────────────────────────────
interface PhotoAnalysis {
  observation: string | string[];
  recommendation: string | string[];
  references?: string | string[];
  riskLevel: 'faible' | 'moyen' | 'eleve' | 'low' | 'medium' | 'high';
  confidence: number;
  unreadableSections?: string[];
}

interface Photo {
  id: string;
  uri: string;
  s3Url?: string;
  analysis?: PhotoAnalysis;
  comment?: string;
  userDirectives?: string;
  isDirectiveOnly?: boolean;
  validated: boolean;
  groupId?: string;
  timestamp?: Date;
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
  mission?: { id: string; title: string; client: string; address: string; status: string; type?: string };
  user?: { firstName: string; lastName: string; email: string };
  report?: { id: string; status: string; title: string };
}

interface ReportGroup {
  groupId: string;
  photos: Photo[];
  isDirectiveOnly: boolean;
  directives: string;
  comment: string;
  analysis?: {
    observations: string[];
    recommendations: string[];
    references: string[];
    riskLevel: string;
    confidence: number;
    unreadableSections?: string[];
  };
}

// ─── HELPERS ─────────────────────────────────────
const toArray = (val: string | string[] | undefined): string[] => {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
};

const mapRisk = (level: string) => {
  const m: Record<string, string> = { faible: 'low', moyen: 'medium', eleve: 'high', low: 'low', medium: 'medium', high: 'high' };
  return m[level] || 'low';
};

const getRiskColor = (level: string) => {
  const l = mapRisk(level);
  if (l === 'high') return 'bg-red-100 text-red-700 border-red-300';
  if (l === 'medium') return 'bg-amber-100 text-amber-700 border-amber-300';
  return 'bg-emerald-100 text-emerald-700 border-emerald-300';
};

const getRiskLabel = (level: string) => {
  const l = mapRisk(level);
  if (l === 'high') return 'Élevé';
  if (l === 'medium') return 'Moyen';
  return 'Faible';
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

const getPhotoUrl = (photo: Photo): string | null => {
  return photo.s3Url || photo.uri || null;
};

// ─── COMPONENT ────────────────────────────────────
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
  const [generatingVisitPdf, setGeneratingVisitPdf] = useState(false);

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadDirectives, setUploadDirectives] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Group detail modal
  const [showGroupDetail, setShowGroupDetail] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingGroupReport, setEditingGroupReport] = useState(false);
  const [tempGroupObservations, setTempGroupObservations] = useState<string[]>([]);
  const [tempGroupRecommendations, setTempGroupRecommendations] = useState<string[]>([]);
  const [tempGroupReferences, setTempGroupReferences] = useState<string[]>([]);
  const [tempGroupDirectives, setTempGroupDirectives] = useState('');
  const [tempGroupComments, setTempGroupComments] = useState('');
  const [isRegeneratingGroup, setIsRegeneratingGroup] = useState(false);

  // Attach photos to group
  const groupAttachInputRef = useRef<HTMLInputElement>(null);
  const [attachingToGroupId, setAttachingToGroupId] = useState<string | null>(null);

  // Directive-only modal
  const [showDirectiveModal, setShowDirectiveModal] = useState(false);
  const [directiveOnlyText, setDirectiveOnlyText] = useState('');
  const [directiveOnlyComment, setDirectiveOnlyComment] = useState('');
  const [isAnalyzingDirective, setIsAnalyzingDirective] = useState(false);

  // Global regeneration
  const [isRegeneratingAll, setIsRegeneratingAll] = useState(false);
  const [regeneratingProgress, setRegeneratingProgress] = useState('');

  // Image base64 cache
  const [imageCache, setImageCache] = useState<Record<string, string>>({});

  // MissionReportModal state
  const [showMissionReportModal, setShowMissionReportModal] = useState(false);
  const [missionReportId, setMissionReportId] = useState<string | undefined>(undefined);
  const [missionReportMission, setMissionReportMission] = useState<any>(null);

  const isAdmin = currentUser?.role === 'ROLE_ADMIN';

  // ─── DATA LOADING ──────────────────────────────
  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [visitsData, missionsData] = await Promise.all([visitsAPI.getAll(), missionsAPI.getAll()]);
      setVisits(Array.isArray(visitsData) ? visitsData : []);
      setMissions(Array.isArray(missionsData) ? missionsData : []);
    } catch (error) {
      console.error('Erreur chargement visites:', error);
    }
    setLoading(false);
  };

  // ─── IMAGE LOADING ─────────────────────────────
  const loadImageBase64 = async (url: string): Promise<string | null> => {
    if (!url) return null;
    if (imageCache[url]) return imageCache[url];
    try {
      const response = await filesService.downloadFile(url, 'reports', true);
      const { base64 } = response.data;
      if (base64) {
        const dataUrl = base64.startsWith('data:image') ? base64 : `data:image/jpeg;base64,${base64}`;
        setImageCache(prev => ({ ...prev, [url]: dataUrl }));
        return dataUrl;
      }
    } catch (error) {
      console.error('Erreur chargement image:', error);
    }
    return null;
  };

  const loadGroupImages = async (photos: Photo[]) => {
    const promises = photos.filter(p => p.s3Url && !imageCache[p.s3Url]).map(p => loadImageBase64(p.s3Url!));
    await Promise.all(promises);
  };

  // ─── REPORT GROUPS ──────────────────────────────
  const photoGroups = useMemo(() => {
    if (!selectedVisit?.photos) return [];
    const groups: Record<string, Photo[]> = {};
    selectedVisit.photos.forEach(photo => {
      const gid = photo.groupId || photo.id;
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(photo);
    });
    return Object.entries(groups).map(([groupId, photos]) => {
      const first = photos[0];
      const obs = toArray(first?.analysis?.observation);
      const recs = toArray(first?.analysis?.recommendation);
      const refs = toArray(first?.analysis?.references);
      return {
        groupId,
        photos,
        isDirectiveOnly: first?.isDirectiveOnly || false,
        directives: first?.userDirectives || '',
        comment: first?.comment || '',
        analysis: first?.analysis ? {
          observations: obs,
          recommendations: recs,
          references: refs,
          riskLevel: first.analysis.riskLevel,
          confidence: first.analysis.confidence,
          unreadableSections: first.analysis.unreadableSections || [],
        } : undefined,
      } as ReportGroup;
    });
  }, [selectedVisit?.photos]);

  // ─── CRUD ───────────────────────────────────────
  const handleCreateVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createMissionId) return;
    setCreating(true);
    try {
      await visitsAPI.create({ missionId: createMissionId, visitDate: createVisitDate, notes: createNotes || undefined });
      setShowCreateModal(false);
      setCreateMissionId(''); setCreateVisitDate(new Date().toISOString().split('T')[0]); setCreateNotes('');
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
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#64748b',
      confirmButtonText: 'Supprimer', cancelButtonText: 'Annuler',
    });
    if (result.isConfirmed) {
      try {
        await visitsAPI.delete(visit.id);
        if (selectedVisit?.id === visit.id) setSelectedVisit(null);
        await loadData();
        Swal.fire({ icon: 'success', title: 'Visite supprimée', timer: 1500, showConfirmButton: false });
      } catch { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la suppression' }); }
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
    } catch { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la sauvegarde' }); }
    setSavingNotes(false);
  };

  // ─── PHOTO UPLOAD ──────────────────────────────
  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const previews = files.map(f => URL.createObjectURL(f));
    setPendingFiles(files);
    setPendingPreviews(previews);
    setUploadDirectives('');
    setShowUploadModal(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = (index: number) => {
    URL.revokeObjectURL(pendingPreviews[index]);
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
    setPendingPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const cancelUpload = () => {
    pendingPreviews.forEach(p => URL.revokeObjectURL(p));
    setPendingFiles([]); setPendingPreviews([]);
    setShowUploadModal(false); setUploadDirectives('');
  };

  const uploadAndAnalyze = async (analyze: boolean) => {
    if (!selectedVisit || pendingFiles.length === 0) return;
    setIsUploading(true);
    setShowUploadModal(false);

    const batchGroupId = `group-${Date.now()}`;
    const uploadedS3Urls: string[] = [];
    const newPhotos: Photo[] = [];

    try {
      // Step 1: Upload all photos
      for (let i = 0; i < pendingFiles.length; i++) {
        setUploadProgress(`Upload photo ${i + 1}/${pendingFiles.length}...`);
        try {
          const results = await uploadService.uploadVisitPhotos([pendingFiles[i]]);
          const s3Url = results[0]?.url;
          if (s3Url) {
            uploadedS3Urls.push(s3Url);
            newPhotos.push({
              id: `photo-${Date.now()}-${i}`,
              uri: s3Url,
              s3Url,
              validated: false,
              groupId: batchGroupId,
              userDirectives: uploadDirectives,
              comment: '',
              timestamp: new Date(),
            });
          }
        } catch (error) {
          console.error(`Erreur upload photo ${i + 1}:`, error);
        }
      }

      if (newPhotos.length === 0) {
        Swal.fire({ icon: 'error', title: 'Erreur', text: 'Aucune photo n\'a pu être uploadée' });
        return;
      }

      // Step 2: AI analysis if requested
      if (analyze && uploadedS3Urls.length > 0) {
        setIsAnalyzing(true);
        setUploadProgress(`Analyse IA de ${uploadedS3Urls.length} photo(s)...`);
        try {
          const analysis = await aiService.analyzeBatchPhotos(uploadedS3Urls, uploadDirectives || undefined);
          const photoAnalysis: PhotoAnalysis = {
            observation: analysis.observations,
            recommendation: analysis.recommendations,
            references: analysis.references,
            riskLevel: analysis.riskLevel === 'low' ? 'faible' : analysis.riskLevel === 'medium' ? 'moyen' : 'eleve',
            confidence: analysis.confidence,
            unreadableSections: analysis.unreadableSections,
          };
          newPhotos.forEach(p => { p.analysis = photoAnalysis; });
        } catch (error) {
          console.error('Erreur analyse IA:', error);
          Swal.fire({ icon: 'warning', title: 'Analyse IA échouée', text: 'Les photos ont été uploadées mais l\'analyse a échoué.' });
        }
        setIsAnalyzing(false);
      }

      // Step 3: Save to visit
      const updatedPhotos = [...(selectedVisit.photos || []), ...newPhotos];
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);

      // Clean up previews
      pendingPreviews.forEach(p => URL.revokeObjectURL(p));
      setPendingFiles([]); setPendingPreviews([]); setUploadDirectives('');

      Swal.fire({ icon: 'success', title: 'Photos ajoutées', text: `${newPhotos.length} photo(s) ajoutée(s)${analyze ? ' et analysée(s)' : ''}`, timer: 2000, showConfirmButton: false });

      // Auto-open group detail if analyzed
      if (analyze && newPhotos[0]?.analysis) {
        setSelectedGroupId(batchGroupId);
        setTimeout(() => { setShowGroupDetail(true); loadGroupImages(newPhotos); }, 500);
      }
    } catch (error) {
      console.error('Erreur upload:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de l\'upload des photos' });
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  // ─── DIRECTIVE-ONLY ANALYSIS ────────────────────
  const handleDirectiveOnlyAnalysis = async () => {
    if (!selectedVisit || !directiveOnlyText.trim()) return;
    setIsAnalyzingDirective(true);
    try {
      const mission = selectedVisit.mission;
      const missionContext = mission ? { title: mission.title, client: mission.client, address: mission.address, type: mission.type } : undefined;
      const analysis = await aiService.analyzeDirectives(directiveOnlyText, missionContext);

      const directivePhoto: Photo = {
        id: `directive-${Date.now()}`,
        uri: '',
        validated: false,
        isDirectiveOnly: true,
        groupId: `directive-group-${Date.now()}`,
        userDirectives: directiveOnlyText,
        comment: directiveOnlyComment,
        analysis: {
          observation: analysis.observations,
          recommendation: analysis.recommendations,
          references: analysis.references,
          riskLevel: analysis.riskLevel === 'low' ? 'faible' : analysis.riskLevel === 'medium' ? 'moyen' : 'eleve',
          confidence: analysis.confidence,
        },
      };

      const updatedPhotos = [...(selectedVisit.photos || []), directivePhoto];
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);

      setShowDirectiveModal(false);
      setDirectiveOnlyText(''); setDirectiveOnlyComment('');

      // Auto-open group detail
      setSelectedGroupId(directivePhoto.groupId!);
      setTimeout(() => setShowGroupDetail(true), 300);

      Swal.fire({ icon: 'success', title: 'Directive analysée', timer: 1500, showConfirmButton: false });
    } catch (error) {
      console.error('Erreur analyse directive:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'L\'analyse IA a échoué' });
    }
    setIsAnalyzingDirective(false);
  };

  // ─── GROUP REPORT EDITING ──────────────────────
  const openGroupDetail = async (group: ReportGroup) => {
    setSelectedGroupId(group.groupId);
    setTempGroupDirectives(group.directives);
    setTempGroupComments(group.comment);
    if (group.analysis) {
      setTempGroupObservations([...group.analysis.observations]);
      setTempGroupRecommendations([...group.analysis.recommendations]);
      setTempGroupReferences([...group.analysis.references]);
    }
    setEditingGroupReport(false);
    setShowGroupDetail(true);
    await loadGroupImages(group.photos);
  };

  const saveGroupReportEdits = async () => {
    if (!selectedVisit || !selectedGroupId) return;
    const updatedPhotos = selectedVisit.photos.map(p => {
      if ((p.groupId || p.id) === selectedGroupId) {
        return {
          ...p,
          userDirectives: tempGroupDirectives,
          comment: tempGroupComments,
          analysis: p.analysis ? {
            ...p.analysis,
            observation: tempGroupObservations,
            recommendation: tempGroupRecommendations,
            references: tempGroupReferences,
          } : p.analysis,
        };
      }
      return p;
    });
    try {
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      setEditingGroupReport(false);
      Swal.fire({ icon: 'success', title: 'Rapport modifié', timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la sauvegarde' });
    }
  };

  // ─── GROUP RE-ANALYSIS ─────────────────────────
  const regenerateGroupReport = async () => {
    if (!selectedVisit || !selectedGroupId) return;
    const group = photoGroups.find(g => g.groupId === selectedGroupId);
    if (!group) return;

    // Validate directives field
    if (!tempGroupDirectives.trim() && !group.isDirectiveOnly) {
      const s3Urls = group.photos.filter(p => p.s3Url).map(p => p.s3Url!);
      if (s3Urls.length === 0) { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Aucune photo uploadée dans ce groupe' }); return; }
    }
    if (!tempGroupDirectives.trim()) {
      Swal.fire({ icon: 'warning', title: 'Directives requises', text: 'Veuillez remplir le champ directives avant de réanalyser.' });
      return;
    }

    // Build previousReport from existing analysis
    const previousReport = group.analysis ? JSON.stringify({
      observations: group.analysis.observations || [],
      recommendations: group.analysis.recommendations || [],
      references: group.analysis.references || [],
      riskLevel: group.analysis.riskLevel,
      confidence: group.analysis.confidence,
    }) : undefined;

    setIsRegeneratingGroup(true);
    try {
      let analysis: AIAnalysis;
      if (group.isDirectiveOnly) {
        const mission = selectedVisit.mission;
        const missionContext = mission ? { title: mission.title, client: mission.client, address: mission.address, type: mission.type } : undefined;
        analysis = await aiService.analyzeDirectives(tempGroupDirectives || group.directives, missionContext, previousReport);
      } else {
        const s3Urls = group.photos.filter(p => p.s3Url).map(p => p.s3Url!);
        if (s3Urls.length === 0) { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Aucune photo uploadée dans ce groupe' }); return; }
        analysis = await aiService.analyzeBatchPhotos(s3Urls, tempGroupDirectives || undefined, previousReport);
      }

      const photoAnalysis: PhotoAnalysis = {
        observation: analysis.observations,
        recommendation: analysis.recommendations,
        references: analysis.references,
        riskLevel: analysis.riskLevel === 'low' ? 'faible' : analysis.riskLevel === 'medium' ? 'moyen' : 'eleve',
        confidence: analysis.confidence,
        unreadableSections: analysis.unreadableSections,
      };

      const updatedPhotos = selectedVisit.photos.map(p => {
        if ((p.groupId || p.id) === selectedGroupId) {
          return { ...p, analysis: photoAnalysis, userDirectives: tempGroupDirectives };
        }
        return p;
      });

      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);

      // Update temp state
      setTempGroupObservations([...analysis.observations]);
      setTempGroupRecommendations([...analysis.recommendations]);
      setTempGroupReferences([...analysis.references]);

      Swal.fire({ icon: 'success', title: 'Rapport régénéré', timer: 1500, showConfirmButton: false });
    } catch (error) {
      console.error('Erreur régénération:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'L\'analyse IA a échoué' });
    }
    setIsRegeneratingGroup(false);
  };

  // ─── GLOBAL RE-ANALYSIS ────────────────────────
  const regenerateAllGroups = async () => {
    if (!selectedVisit || photoGroups.length === 0 || !selectedVisit.notes?.trim()) {
      Swal.fire({ icon: 'info', title: 'Info', text: 'Veuillez saisir des directives globales (notes) avant de regénérer.' });
      return;
    }
    const confirm = await Swal.fire({
      title: 'Regénérer tous les groupes',
      text: `Regénérer les ${photoGroups.length} groupe(s) avec les directives globales ?`,
      icon: 'question', showCancelButton: true, confirmButtonText: 'Regénérer', cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    setIsRegeneratingAll(true);
    try {
      let updatedPhotos = [...selectedVisit.photos];

      for (let i = 0; i < photoGroups.length; i++) {
        const group = photoGroups[i];
        setRegeneratingProgress(`Groupe ${i + 1}/${photoGroups.length}...`);

        try {
          const previousReport = group.analysis ? JSON.stringify(group.analysis) : undefined;
          let analysis: AIAnalysis;

          if (group.isDirectiveOnly) {
            const mission = selectedVisit.mission;
            analysis = await aiService.analyzeDirectives(selectedVisit.notes!, mission ? { title: mission.title, client: mission.client, address: mission.address, type: mission.type } : undefined, previousReport);
          } else {
            const s3Urls = group.photos.filter(p => p.s3Url).map(p => p.s3Url!);
            if (s3Urls.length === 0) continue;
            analysis = await aiService.analyzeBatchPhotos(s3Urls, selectedVisit.notes!, previousReport);
          }

          const photoAnalysis: PhotoAnalysis = {
            observation: analysis.observations,
            recommendation: analysis.recommendations,
            references: analysis.references,
            riskLevel: analysis.riskLevel === 'low' ? 'faible' : analysis.riskLevel === 'medium' ? 'moyen' : 'eleve',
            confidence: analysis.confidence,
          };

          updatedPhotos = updatedPhotos.map(p => {
            if ((p.groupId || p.id) === group.groupId) {
              return { ...p, analysis: photoAnalysis, userDirectives: selectedVisit.notes };
            }
            return p;
          });
        } catch (error) {
          console.error(`Erreur groupe ${i + 1}:`, error);
        }
      }

      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      const result = await Swal.fire({
        icon: 'success', title: 'Regénération terminée',
        text: 'Tous les groupes ont été régénérés.',
        showCancelButton: true,
        confirmButtonText: 'Voir rapport',
        cancelButtonText: 'Fermer',
      });
      if (result.isConfirmed && selectedVisit.mission) {
        const refreshed = await visitsAPI.getById(selectedVisit.id);
        const reportId = refreshed?.report?.id;
        setMissionReportMission(selectedVisit.mission);
        setMissionReportId(reportId);
        setShowMissionReportModal(true);
      }
    } catch (error) {
      console.error('Erreur régénération globale:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'La regénération a échoué' });
    }
    setIsRegeneratingAll(false);
    setRegeneratingProgress('');
  };

  // ─── REPORT GENERATION ─────────────────────────
  const handleGenerateReport = async () => {
    if (!selectedVisit) return;
    const confirm = await Swal.fire({
      title: 'Générer un rapport', text: 'Voulez-vous générer un rapport à partir de cette visite ?',
      icon: 'question', showCancelButton: true, confirmButtonText: 'Générer', cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    setGeneratingReport(true);
    try {
      const report = await visitsAPI.generateReport(selectedVisit.id, { notes: selectedVisit.notes });
      await loadData();
      const updated = await visitsAPI.getById(selectedVisit.id);
      setSelectedVisit(updated);
      const reportId = report?.id || updated?.report?.id;

      setGeneratingReport(false);
      const result = await Swal.fire({
        icon: 'success', title: 'Rapport généré',
        text: 'Le rapport a été généré avec succès.',
        showCancelButton: true,
        confirmButtonText: 'Voir rapport',
        cancelButtonText: 'Fermer',
      });
      if (result.isConfirmed && (updated?.mission || selectedVisit?.mission)) {
        setMissionReportMission(updated?.mission || selectedVisit?.mission);
        setMissionReportId(reportId);
        setShowMissionReportModal(true);
      }
    } catch (error: any) {
      setGeneratingReport(false);
      Swal.fire({ icon: 'error', title: 'Erreur', text: error.message || 'Erreur lors de la génération' });
    }
  };

  // ─── REPORT MODAL ──────────────────────────────
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
    } catch { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Impossible de charger le rapport' }); }
  };

  const downloadImages = async (url: string) => {
    try {
      const response = await filesService.downloadFile(url, 'reports', true);
      const { base64 } = response.data;
      return base64;
    } catch (error) { console.error('Erreur téléchargement image:', error); }
  };

  const handleSaveReport = async () => {
    if (!visitReport) return;
    try {
      const resp = await reportsAPI.update(visitReport.id, {
        content: editedContent, header: editedHeader, footer: editedFooter, observations: editedObservations,
      });
      if (selectedVisit) await visitService.update(visitReport.visitId, { photos: reportPhotos });
      setVisitReport((prev: any) => prev ? { ...prev, ...resp } : null);
      setIsEditingReport(false);
      Swal.fire({ icon: 'success', title: 'Rapport sauvegardé', timer: 1500, showConfirmButton: false });
    } catch { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la sauvegarde' }); }
  };

  const handleDownloadVisitPdf = async () => {
    if (!visitReport || !selectedVisit) return;
    setGeneratingVisitPdf(true);
    try {
      const visitPhotos = visitReport.visit?.photos || selectedVisit.photos || [];
      const photosForPdf = visitPhotos.map((photo: any) => {
        const riskLevelMap: Record<string, string> = { faible: 'low', moyen: 'medium', eleve: 'high', low: 'low', medium: 'medium', high: 'high' };
        const obs = photo.analysis?.observation || [];
        const recs = photo.analysis?.recommendation || [];
        const refs = photo.analysis?.references || [];
        return {
          ...photo,
          aiAnalysis: photo.analysis ? {
            observations: Array.isArray(obs) ? obs : [obs],
            recommendations: Array.isArray(recs) ? recs : [recs],
            references: Array.isArray(refs) ? refs : [refs],
            riskLevel: riskLevelMap[photo.analysis.riskLevel] || 'low',
            confidence: photo.analysis.confidence || 0,
          } : undefined,
          comment: photo.comment || '',
        };
      });

      await generatePdfService.generateReportPDF({
        title: visitReport.title || selectedVisit.mission?.title || 'Rapport',
        mission: selectedVisit.mission?.title || '',
        client: selectedVisit.mission?.client || '',
        date: new Date(visitReport.createdAt).toLocaleDateString('fr-FR'),
        conformity: visitReport.conformityPercentage,
        header: visitReport.header || editedHeader || '',
        content: visitReport.content || editedContent || '',
        footer: visitReport.footer || editedFooter || '',
        observations: visitReport.observations || editedObservations || '',
        photos: photosForPdf,
      });
      Swal.fire({ icon: 'success', title: 'PDF généré', timer: 2000, showConfirmButton: false });
    } catch (error) {
      console.error('Error generating PDF:', error);
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la génération du PDF' });
    } finally { setGeneratingVisitPdf(false); }
  };

  // ─── DELETE GROUP ───────────────────────────────
  const handleDeleteGroup = async (groupId: string) => {
    if (!selectedVisit) return;
    const confirm = await Swal.fire({
      title: 'Supprimer le groupe', text: 'Supprimer ce groupe de photos et son analyse ?',
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Supprimer', cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    const updatedPhotos = selectedVisit.photos.filter(p => (p.groupId || p.id) !== groupId);
    try {
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      if (selectedGroupId === groupId) { setShowGroupDetail(false); setSelectedGroupId(null); }
      Swal.fire({ icon: 'success', title: 'Groupe supprimé', timer: 1500, showConfirmButton: false });
    } catch { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la suppression' }); }
  };

  // ─── DELETE ATTACHED PHOTO (non-AI) ─────────────
  const handleDeleteAttachedPhoto = async (photo: Photo) => {
    if (!selectedVisit) return;
    const confirm = await Swal.fire({
      title: 'Supprimer la photo jointe',
      text: 'Cette photo sera supprimée du serveur et du groupe. Confirmer ?',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#dc2626', confirmButtonText: 'Supprimer', cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    try {
      if (photo.s3Url) {
        try { await uploadService.deletePhotoByUrl(photo.s3Url); } catch (e) { console.error('S3 delete error:', e); }
      }
      const updatedPhotos = selectedVisit.photos.filter(p => p.id !== photo.id);
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      Swal.fire({ icon: 'success', title: 'Photo supprimée', timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la suppression' });
    }
  };

  // ─── ATTACH PHOTOS TO EXISTING GROUP ────────────
  const onAttachFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !selectedVisit || !attachingToGroupId) return;
    if (groupAttachInputRef.current) groupAttachInputRef.current.value = '';

    setIsUploading(true);
    setUploadProgress('Upload des photos supplémentaires...');
    try {
      const newPhotos: Photo[] = [];
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Upload photo ${i + 1}/${files.length}...`);
        const results = await uploadService.uploadVisitPhotos([files[i]]);
        const s3Url = results[0]?.url;
        if (s3Url) {
          newPhotos.push({
            id: `photo-${Date.now()}-${i}`,
            uri: s3Url, s3Url, validated: false,
            groupId: attachingToGroupId,
            comment: '',
          });
        }
      }
      const updatedPhotos = [...(selectedVisit.photos || []), ...newPhotos];
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      Swal.fire({ icon: 'success', title: `${newPhotos.length} photo(s) jointe(s)`, timer: 1500, showConfirmButton: false });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: "Erreur lors de l'ajout des photos" });
    }
    setIsUploading(false); setUploadProgress('');
    setAttachingToGroupId(null);
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

  const getPhotoCount = (visit: Visit) => visit.photoCount || visit.photos?.filter(p => !p.isDirectiveOnly)?.length || 0;
  const getDirectiveCount = (visit: Visit) => visit.photos?.filter(p => p.isDirectiveOnly)?.length || 0;
  const getRiskSummary = (visit: Visit) => ({
    high: visit.photos?.filter(p => p.analysis?.riskLevel === 'eleve' || p.analysis?.riskLevel === 'high')?.length || 0,
    medium: visit.photos?.filter(p => p.analysis?.riskLevel === 'moyen' || p.analysis?.riskLevel === 'medium')?.length || 0,
    low: visit.photos?.filter(p => p.analysis?.riskLevel === 'faible' || p.analysis?.riskLevel === 'low')?.length || 0,
  });

  // ─── BLOCK EDITING HELPERS ─────────────────────
  const addItem = (setter: React.Dispatch<React.SetStateAction<string[]>>) => setter(prev => [...prev, '']);
  const updateItem = (setter: React.Dispatch<React.SetStateAction<string[]>>, index: number, value: string) => setter(prev => prev.map((v, i) => i === index ? value : v));
  const removeItem = (setter: React.Dispatch<React.SetStateAction<string[]>>, index: number) => setter(prev => prev.filter((_, i) => i !== index));

  // ─── RENDER: Loading overlay ───────────────────
  const renderLoadingOverlay = () => {
    if (!isUploading && !isAnalyzing && !isRegeneratingAll) return null;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
        <div className="bg-white rounded-xl p-8 max-w-sm w-full mx-4 text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            {isAnalyzing ? 'Analyse IA en cours...' : isRegeneratingAll ? 'Regénération en cours...' : 'Upload en cours...'}
          </h3>
          <p className="text-s text-slate-500">{uploadProgress || regeneratingProgress}</p>
        </div>
      </div>
    );
  };

  // ─── RENDER: Group Detail Modal ─────────────────
  const renderGroupDetailModal = () => {
    if (!showGroupDetail || !selectedGroupId) return null;
    const group = photoGroups.find(g => g.groupId === selectedGroupId);
    if (!group) return null;

    const obs = editingGroupReport ? tempGroupObservations : (group.analysis?.observations || []);
    const recs = editingGroupReport ? tempGroupRecommendations : (group.analysis?.recommendations || []);
    const refs = editingGroupReport ? tempGroupReferences : (group.analysis?.references || []);
    const riskLevel = group.analysis?.riskLevel || 'faible';

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
        <div className="bg-white rounded-xl max-w-4xl w-full my-8 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {group.isDirectiveOnly ? '📝 Rapport Directive' : `📸 Rapport ${photoGroups.indexOf(group) + 1} — ${group.photos.length} photo(s)`}
              </h2>
              {riskLevel && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mt-1 ${getRiskColor(riskLevel)}`}>
                  {getRiskLabel(riskLevel)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!editingGroupReport ? (
                <button onClick={() => { setEditingGroupReport(true); setTempGroupObservations([...obs]); setTempGroupRecommendations([...recs]); setTempGroupReferences([...refs]); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-s bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">
                  <Pencil className="w-3.5 h-3.5" /> Modifier
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setEditingGroupReport(false)} className="px-3 py-1.5 text-s border border-slate-300 rounded-lg hover:bg-slate-50">Annuler</button>
                  <button onClick={saveGroupReportEdits} className="flex items-center gap-1 px-3 py-1.5 text-s bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Save className="w-3.5 h-3.5" /> Sauvegarder
                  </button>
                </div>
              )}
              <button onClick={() => setShowGroupDetail(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
          </div>

          {/* Content - Order: Observations → Recommandations → Références → Directives → Notes → Photos */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Observations */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-s font-semibold text-red-600 flex items-center gap-1"><span className="w-1 h-4 bg-red-500 rounded"></span> 🔍 Observations</h4>
                {editingGroupReport && <button onClick={() => addItem(setTempGroupObservations)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>}
              </div>
              {editingGroupReport ? (
                <div className="space-y-2">
                  {tempGroupObservations.map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-red-400 mt-2 text-s">•</span>
                      <textarea value={item} onChange={e => updateItem(setTempGroupObservations, i, e.target.value)}
                        className="flex-1 px-3 py-2 border border-red-200 rounded-lg text-s focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none bg-red-50/30" rows={4} />
                      <button onClick={() => removeItem(setTempGroupObservations, i)} className="p-1 text-red-400 hover:text-red-600 mt-1"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                obs.length > 0 ? (
                  <ul className="space-y-1">{obs.map((item, i) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-red-400 mt-0.5">•</span> {item}</li>)}</ul>
                ) : <p className="text-s text-slate-400 italic">Aucune observation</p>
              )}
            </div>

            {/* Recommendations */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-s font-semibold text-blue-600 flex items-center gap-1"><span className="w-1 h-4 bg-blue-500 rounded"></span> 💡 Recommandations</h4>
                {editingGroupReport && <button onClick={() => addItem(setTempGroupRecommendations)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>}
              </div>
              {editingGroupReport ? (
                <div className="space-y-2">
                  {tempGroupRecommendations.map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-blue-400 mt-2 text-s">•</span>
                      <textarea value={item} onChange={e => updateItem(setTempGroupRecommendations, i, e.target.value)}
                        className="flex-1 px-3 py-2 border border-blue-200 rounded-lg text-s focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none bg-blue-50/30" rows={3} />
                      <button onClick={() => removeItem(setTempGroupRecommendations, i)} className="p-1 text-blue-400 hover:text-blue-600 mt-1"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                recs.length > 0 ? (
                  <ul className="space-y-1">{recs.map((item, i) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> {item}</li>)}</ul>
                ) : <p className="text-s text-slate-400 italic">Aucune recommandation</p>
              )}
            </div>

            {/* References */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-s font-semibold text-purple-600 flex items-center gap-1"><span className="w-1 h-4 bg-purple-500 rounded"></span> 🏛️ Références</h4>
                {editingGroupReport && <button onClick={() => addItem(setTempGroupReferences)} className="text-xs text-purple-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>}
              </div>
              {editingGroupReport ? (
                <div className="space-y-2">
                  {tempGroupReferences.map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-purple-400 mt-2 text-s">•</span>
                      <textarea value={item} onChange={e => updateItem(setTempGroupReferences, i, e.target.value)}
                        className="flex-1 px-3 py-2 border border-purple-200 rounded-lg text-s focus:ring-2 focus:ring-purple-100 focus:border-purple-400 outline-none bg-purple-50/30" rows={2} />
                      <button onClick={() => removeItem(setTempGroupReferences, i)} className="p-1 text-purple-400 hover:text-purple-600 mt-1"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                refs.length > 0 ? (
                  <ul className="space-y-1">{refs.map((item, i) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-purple-400 mt-0.5">•</span> {item}</li>)}</ul>
                ) : <p className="text-s text-slate-400 italic">Aucune référence</p>
              )}
            </div>

            {/* Directives */}
            <div>
              <h4 className="text-s font-semibold text-slate-700 mb-2">📋 Directives</h4>
              {editingGroupReport ? (
                <textarea value={tempGroupDirectives} onChange={e => setTempGroupDirectives(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-s focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none" rows={3}
                  placeholder="Directives pour ce groupe..." />
              ) : (
                <div className="bg-slate-50 rounded-lg p-3 text-s text-slate-700">{group.directives || <span className="text-slate-400 italic">Aucune directive</span>}</div>
              )}
            </div>

            {/* Comments */}
            <div>
              <h4 className="text-s font-semibold text-amber-600 mb-2 flex items-center gap-1"><span className="w-1 h-4 bg-amber-500 rounded"></span> 💬 Notes / Commentaires</h4>
              {editingGroupReport ? (
                <textarea value={tempGroupComments} onChange={e => setTempGroupComments(e.target.value)}
                  className="w-full px-3 py-2 border border-amber-200 rounded-lg text-s focus:ring-2 focus:ring-amber-100 focus:border-amber-400 outline-none bg-amber-50/30" rows={2}
                  placeholder="Commentaires du coordonnateur..." />
              ) : (
                <div className="bg-slate-50 rounded-lg p-3 text-s text-slate-700 italic">{group.comment || <span className="text-slate-400">Aucun commentaire</span>}</div>
              )}
            </div>

            {/* Photos grid - at the end */}
            {!group.isDirectiveOnly && group.photos.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-s font-semibold text-slate-700">📸 Photos ({group.photos.length})</h4>
                  <button onClick={() => { setAttachingToGroupId(selectedGroupId); groupAttachInputRef.current?.click(); }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <Paperclip className="w-3 h-3" /> Joindre des photos
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {group.photos.map((photo, idx) => {
                    const src = photo.s3Url ? (imageCache[photo.s3Url] || photo.s3Url) : photo.uri;
                    const isAttachedOnly = !photo.analysis && !photo.isDirectiveOnly;
                    const missionStatus = selectedVisit?.mission?.status || '';
                    const reportSt = selectedVisit?.report?.status || '';
                    const canDeleteAttached = isAttachedOnly && !['terminee', 'archivee', 'annulee'].includes(missionStatus) && reportSt !== 'envoye_au_client';
                    return (
                      <div key={photo.id || idx} className="relative">
                        {src ? (
                          <img src={src} alt={`Photo ${idx + 1}`}
                            className="w-full h-40 object-cover rounded-lg border border-slate-200"
                          />
                        ) : (
                          <div className="w-full h-40 bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200">
                            <ImageIcon className="w-8 h-8 text-slate-300" />
                          </div>
                        )}
                        <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                        {canDeleteAttached && (
                          <button
                            onClick={() => handleDeleteAttachedPhoto(photo)}
                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700"
                            title="Supprimer cette photo jointe"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer with re-analysis */}
          <div className="p-4 border-t border-slate-200 flex flex-wrap gap-2">
            <button onClick={regenerateGroupReport} disabled={isRegeneratingGroup}
              className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 text-s font-medium disabled:opacity-50">
              {isRegeneratingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isRegeneratingGroup ? 'Analyse...' : 'Réanalyser avec directives'}
            </button>
            <button onClick={() => handleDeleteGroup(selectedGroupId)} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 text-s font-medium">
              <Trash2 className="w-4 h-4" /> Supprimer le groupe
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── RENDER: Upload Modal ───────────────────────
  const renderUploadModal = () => {
    if (!showUploadModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Upload className="w-5 h-5 text-blue-600" /> Photos sélectionnées ({pendingFiles.length})</h2>
            <button onClick={cancelUpload} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Photo previews */}
            <div className="grid grid-cols-3 gap-3">
              {pendingPreviews.map((preview, i) => (
                <div key={i} className="relative group">
                  <img src={preview} alt={`Preview ${i + 1}`} className="w-full h-28 object-cover rounded-lg border border-slate-200" />
                  <button onClick={() => removePendingFile(i)}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <span className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                </div>
              ))}
            </div>
            {/* Directives */}
            <div>
              <label className="block text-s font-medium text-slate-700 mb-2">📋 Directives pour l'analyse IA (optionnel)</label>
              <textarea value={uploadDirectives} onChange={e => setUploadDirectives(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg text-s focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none" rows={4}
                placeholder="Ex: Vérifier la conformité des garde-corps, inspecter les accès au chantier..." />
            </div>
          </div>
          <div className="p-6 border-t border-slate-200 flex flex-wrap gap-3">
            <button onClick={cancelUpload} className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium text-s">Annuler</button>
            {/* <button onClick={() => uploadAndAnalyze(false)}
              className="flex items-center gap-2 px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 font-medium text-s">
              <Upload className="w-4 h-4" /> Sauvegarder sans analyser
            </button> */}
            <button onClick={() => uploadAndAnalyze(true)}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-s">
              <Sparkles className="w-4 h-4" /> Analyser avec l'IA
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── RENDER: Directive-only Modal ───────────────
  const renderDirectiveModal = () => {
    if (!showDirectiveModal) return null;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl max-w-lg w-full">
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">📝 Directives du coordonnateur</h2>
            <button onClick={() => setShowDirectiveModal(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-s font-medium text-slate-700 mb-2">Directives *</label>
              <textarea value={directiveOnlyText} onChange={e => setDirectiveOnlyText(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg text-s focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none" rows={5}
                placeholder="Saisissez vos directives pour l'analyse IA..." />
            </div>
            <div>
              <label className="block text-s font-medium text-slate-700 mb-2">Commentaires (optionnel)</label>
              <textarea value={directiveOnlyComment} onChange={e => setDirectiveOnlyComment(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg text-s focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none" rows={3}
                placeholder="Commentaires supplémentaires..." />
            </div>
          </div>
          <div className="p-6 border-t border-slate-200 flex gap-3">
            <button onClick={() => setShowDirectiveModal(false)} className="flex-1 px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium">Annuler</button>
            <button onClick={handleDirectiveOnlyAnalysis} disabled={!directiveOnlyText.trim() || isAnalyzingDirective}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
              {isAnalyzingDirective ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isAnalyzingDirective ? 'Analyse...' : 'Analyser'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── RENDER: SELECTED VISIT DETAIL ──────────────
  if (selectedVisit) {
    const risks = getRiskSummary(selectedVisit);
    const BLOCKED_STATUSES = ['terminee', 'archivee', 'annulee', 'supprimee'];
    const missionStatus = selectedVisit.mission?.status || '';
    const reportStatus = selectedVisit.report?.status || '';
    const canRegenerate = reportStatus !== 'envoye_au_client' && !BLOCKED_STATUSES.includes(missionStatus);

    return (
      <div className="space-y-6">
        {renderLoadingOverlay()}
        {renderUploadModal()}
        {renderDirectiveModal()}
        {renderGroupDetailModal()}

        {/* Hidden file input for group attach */}
        <input ref={groupAttachInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onAttachFilesSelected} />

        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesSelected} />

        {/* Header */}
        <div className="flex items-center gap-4">
          <button onClick={() => { setSelectedVisit(null); setEditingNotes(false); }}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-s font-medium text-slate-700 hover:bg-slate-50">← Retour</button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900">{selectedVisit.mission?.title || 'Visite'}</h2>
            <p className="text-s text-slate-500">{selectedVisit.mission?.client} — {selectedVisit.mission?.address}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Upload photos */}
            {canRegenerate && (
              <>
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-s font-medium">
                  <Upload className="w-4 h-4" /> Ajouter photos
                </button>
                <button onClick={() => setShowDirectiveModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 text-s font-medium">
                  <MessageSquare className="w-4 h-4" /> Directive
                </button>
              </>
            )}
            {/* Generate report - always show if photos exist */}
            {canRegenerate && selectedVisit.photos?.length > 0 && (
              <button onClick={handleGenerateReport} disabled={generatingReport}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-s font-medium disabled:opacity-50">
                <FileText className="w-4 h-4" /> {generatingReport ? 'Génération...' : selectedVisit.reportGenerated ? 'Regénérer rapport' : 'Générer rapport'}
              </button>
            )}
            {selectedVisit.report && (
              <button onClick={openVisitReport}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-s font-medium">
                <Eye className="w-4 h-4" /> Voir rapport
              </button>
            )}
            <button onClick={(e) => handleDeleteVisit(selectedVisit, e)}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 text-s font-medium">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Visit info */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-s mb-1"><Calendar className="w-4 h-4" /> Date</div>
            <p className="font-semibold text-slate-900">{new Date(selectedVisit.visitDate).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-s mb-1"><Camera className="w-4 h-4" /> Photos</div>
            <p className="font-semibold text-slate-900">{getPhotoCount(selectedVisit)} photo(s), {getDirectiveCount(selectedVisit)} directive(s)</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-s mb-1"><AlertTriangle className="w-4 h-4" /> Risques</div>
            <div className="flex gap-2 mt-1">
              {risks.high > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{risks.high} élevé</span>}
              {risks.medium > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{risks.medium} moyen</span>}
              {risks.low > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">{risks.low} faible</span>}
              {risks.high === 0 && risks.medium === 0 && risks.low === 0 && <span className="text-s text-slate-400">Aucun</span>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-s mb-1"><FileText className="w-4 h-4" /> Rapport</div>
            <p className="font-semibold text-slate-900">
              {selectedVisit.reportGenerated ? (
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle className="w-4 h-4" /> Généré
                  {selectedVisit.report && <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(selectedVisit.report.status)}`}>{getStatusLabel(selectedVisit.report.status)}</span>}
                </span>
              ) : <span className="flex items-center gap-1 text-slate-400"><Clock className="w-4 h-4" /> Non généré</span>}
            </p>
          </div>
        </div>

        {/* Coordinator */}
        {selectedVisit.user && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <span className="text-s text-slate-500">Coordinateur :</span>
            <span className="ml-2 font-medium text-slate-900">{selectedVisit.user.firstName} {selectedVisit.user.lastName}</span>
            <span className="ml-2 text-s text-slate-400">{selectedVisit.user.email}</span>
          </div>
        )}

        {/* Photo groups */}
        {photoGroups.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-600" /> Rapports d'analyse ({photoGroups.length})
              </h3>
              {canRegenerate && photoGroups.length > 0 && (
                <button onClick={regenerateAllGroups} disabled={isRegeneratingAll}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 text-s font-medium disabled:opacity-50">
                  {isRegeneratingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Regénérer tout (directives globales)
                </button>
              )}
            </div>
            {photoGroups.map((group, index) => {
              const isExpanded = expandedPhoto === group.groupId;
              const obs = group.analysis?.observations || [];
              const recs = group.analysis?.recommendations || [];
              const refs = group.analysis?.references || [];

              return (
                <div key={group.groupId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <button onClick={() => setExpandedPhoto(isExpanded ? null : group.groupId)}
                    className="w-full flex-1 px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-s font-bold">{index + 1}</span>
                      <div className="text-left">
                        <span className="font-medium text-slate-900">{group.isDirectiveOnly ? '📝 Directives' : `📸 ${group.photos.length} photo(s)`}</span>
                        {!group.isDirectiveOnly && <span className="ml-2 text-s text-slate-400">— Groupe {index + 1}</span>}
                      </div>
                      {group.analysis?.riskLevel && <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getRiskColor(group.analysis.riskLevel)}`}>{getRiskLabel(group.analysis.riskLevel)}</span>}
                    </div>
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                  </button>
                  <div className="flex items-center gap-1 px-3">
                    {canRegenerate && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); openGroupDetail(group); }} className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">
                          <Pencil className="w-3 h-3" /> Modifier
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); openGroupDetail(group); }} className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100">
                          <RotateCcw className="w-3 h-3" /> Réanalyser
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.groupId); }} className="p-1 text-red-500 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="px-5 pb-5 border-t border-slate-100">
                      {/* Analysis first - Order: Observations → Recommendations → References → Directives → Notes → Photos */}
                      <div className="mt-4 space-y-4">
                        <div className={`grid grid-cols-1 ${!group.isDirectiveOnly ? 'lg:grid-cols-2' : ''} gap-6`}>
                          {/* Analysis column */}
                          <div>
                            {obs.length > 0 && (
                              <div className="mb-4">
                                <h4 className="text-s font-semibold text-slate-700 mb-2">🔍 Observations</h4>
                                <ul className="space-y-1">{obs.map((o, i) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-red-400 mt-0.5">•</span> {o}</li>)}</ul>
                              </div>
                            )}
                            {recs.length > 0 && (
                              <div className="mb-4">
                                <h4 className="text-s font-semibold text-slate-700 mb-2">💡 Recommandations</h4>
                                <ul className="space-y-1">{recs.map((r, i) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-amber-500 mt-0.5">•</span> {r}</li>)}</ul>
                              </div>
                            )}
                            {refs.length > 0 && (
                              <div className="mb-4">
                                <h4 className="text-s font-semibold text-slate-700 mb-2">🏛️ Références</h4>
                                <ul className="space-y-1">{refs.map((r, i) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-purple-400 mt-0.5">•</span> {r}</li>)}</ul>
                              </div>
                            )}
                            {group.directives && (
                              <div className="mb-4">
                                <h4 className="text-s font-semibold text-slate-700 mb-2">📋 Directives</h4>
                                <p className="text-s text-slate-600 bg-slate-50 rounded-lg p-3">{group.directives}</p>
                              </div>
                            )}
                            {group.comment && (
                              <div>
                                <h4 className="text-s font-semibold text-slate-700 mb-2">💬 Notes</h4>
                                <p className="text-s text-slate-600 bg-slate-50 rounded-lg p-3 italic">{group.comment}</p>
                              </div>
                            )}
                          </div>

                          {/* Photos column - at the end */}
                          {!group.isDirectiveOnly && (
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-s font-semibold text-slate-700">📸 Photos ({group.photos.length})</h4>
                                <button onClick={(e) => { e.stopPropagation(); setAttachingToGroupId(group.groupId); groupAttachInputRef.current?.click(); }}
                                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                  <Paperclip className="w-3 h-3" /> Joindre
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                {group.photos.map((photo, pIdx) => {
                                  const src = photo.s3Url || photo.uri;
                                  return (
                                    <div key={photo.id || pIdx} className="relative">
                                      {src ? (
                                        <img src={imageCache[src] || src} alt={`Photo ${pIdx + 1}`}
                                          className="w-full h-32 object-cover rounded-lg border border-slate-200"
                                          onLoad={() => { if (photo.s3Url && !imageCache[photo.s3Url]) loadImageBase64(photo.s3Url); }}
                                          onError={(e) => {
                                            const el = e.target as HTMLImageElement;
                                            if (photo.s3Url && !imageCache[photo.s3Url]) {
                                              loadImageBase64(photo.s3Url).then(b64 => { if (b64) el.src = b64; });
                                            }
                                          }} />
                                      ) : (
                                        <div className="w-full h-32 bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200"><ImageIcon className="w-8 h-8 text-slate-300" /></div>
                                      )}
                                      <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">{pIdx + 1}</span>
                                    </div>
                                  );
                                })}
                              </div>
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
            <p className="text-slate-500 mb-4">Aucune photo pour cette visite</p>
            {canRegenerate && (
              <button onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                <Upload className="w-4 h-4" /> Ajouter des photos
              </button>
            )}
          </div>
        )}

        {/* Global notes */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2"><FileText className="w-5 h-5 text-blue-600" /> Notes / Directives globales</h3>
            {!editingNotes ? (
              <button onClick={() => { setEditingNotes(true); setTempNotes(selectedVisit.notes || ''); }}
                className="flex items-center gap-1 text-s text-blue-600 hover:underline"><Edit2 className="w-3.5 h-3.5" /> Modifier</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditingNotes(false)} className="px-3 py-1 text-s border border-slate-300 rounded-lg hover:bg-slate-50">Annuler</button>
                <button onClick={handleSaveNotes} disabled={savingNotes}
                  className="flex items-center gap-1 px-3 py-1 text-s bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> {savingNotes ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            )}
          </div>
          {editingNotes ? (
            <textarea value={tempNotes} onChange={(e) => setTempNotes(e.target.value)} rows={4}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none text-s"
              placeholder="Ajouter des notes ou directives globales pour la regénération de tous les groupes..." />
          ) : (
            <div className="bg-slate-50 rounded-lg p-4 text-s text-slate-700 whitespace-pre-wrap">
              {selectedVisit.notes || <span className="text-slate-400 italic">Aucune note</span>}
            </div>
          )}
        </div>

        {/* Report detail modal */}
        {showReportModal && visitReport && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-xl max-w-4xl w-full my-8">
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Rapport de visite</h2>
                  <p className="text-s text-slate-600 mt-1">{visitReport.title || selectedVisit.mission?.title}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(visitReport.status)}`}>{getStatusLabel(visitReport.status)}</span>
                  <button onClick={() => setShowReportModal(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-s">
                    <div><p className="text-slate-600">Client</p><p className="font-medium text-slate-900">{selectedVisit.mission?.client}</p></div>
                    <div><p className="text-slate-600">Date</p><p className="font-medium text-slate-900">{new Date(visitReport.createdAt).toLocaleDateString('fr-FR')}</p></div>
                    {visitReport.conformityPercentage != null && <div><p className="text-slate-600">Conformité</p><p className="font-medium text-slate-900">{visitReport.conformityPercentage}%</p></div>}
                  </div>
                </div>
                <div>
                  <label className="block text-s font-medium text-slate-700 mb-2">Contenu du rapport</label>
                  <PhotoReportEditor
                    initialPhotos={visitReport.visit?.photos || selectedVisit.photos || []}
                    downloadImages={downloadImages}
                    isEditing={isEditingReport}
                    editedFooter={editedFooter}
                    editedHeader={editedHeader}
                    onPhotosChange={isEditingReport ? setReportPhotos : undefined}
                    onHeaderChange={isEditingReport ? setEditedHeader : undefined}
                    onFooterChange={isEditingReport ? setEditedFooter : undefined}
                  />
                </div>
                <div>
                  <label className="block text-s font-medium text-slate-700 mb-2">Observations</label>
                  {isEditingReport ? (
                    <textarea value={editedObservations} onChange={(e) => setEditedObservations(e.target.value)} rows={4}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none" />
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-lg whitespace-pre-wrap text-slate-900">{editedObservations || 'Aucune observation'}</div>
                  )}
                </div>
              </div>
              <div className="p-6 border-t border-slate-200 flex flex-wrap gap-3">
                <button onClick={() => setShowReportModal(false)} className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium">Fermer</button>
                <button onClick={handleDownloadVisitPdf} disabled={generatingVisitPdf}
                  className="flex items-center gap-2 bg-slate-700 text-white px-6 py-3 rounded-lg hover:bg-slate-800 font-medium disabled:opacity-50">
                  {generatingVisitPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {generatingVisitPdf ? 'Génération...' : 'Télécharger PDF'}
                </button>
                {canRegenerate && visitReport.status !== 'envoye_au_client' && visitReport.status !== 'annule' && (
                  isEditingReport ? (
                    <>
                      <button onClick={() => setIsEditingReport(false)} className="px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium">Annuler</button>
                      <button onClick={handleSaveReport} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium">
                        <CheckCircle className="w-4 h-4" /> Enregistrer
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setIsEditingReport(true)} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-6 py-3 rounded-lg hover:bg-slate-50 font-medium">
                      <Edit2 className="w-4 h-4" /> Modifier
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* MissionReportModal for viewing report after generation */}
        {showMissionReportModal && (
          <MissionReportModal
            mission={missionReportMission}
            onClose={async () => { setShowMissionReportModal(false); setMissionReportId(undefined); setMissionReportMission(null); await loadData(); setSelectedVisit(null); setEditingNotes(false); }}
            initialReportId={missionReportId}
          />
        )}
      </div>
    );
  }

  // ─── RENDER: VISITS LIST ────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Camera className="w-7 h-7 text-blue-600" /> Gestion des Visites</h1>
          <p className="text-slate-500 text-s mt-1">{filteredVisits.length} visite(s) trouvée(s)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-s font-medium">
            <Plus className="w-4 h-4" /> Nouvelle visite
          </button>
          <button onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-s font-medium">
            <RefreshCw className="w-4 h-4" /> Actualiser
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Rechercher..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-s focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500" />
        </div>
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select value={filterMission} onChange={(e) => setFilterMission(e.target.value)}
            className="pl-10 pr-8 py-2 border border-slate-200 rounded-lg text-s focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 appearance-none bg-white">
            <option value="all">Tous les chantiers</option>
            {missions.map(m => <option key={m.id} value={m.id}>{m.title} — {m.client}</option>)}
          </select>
        </div>
      </div>

      {/* Visits list */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">Chargement des visites...</div>
      ) : filteredVisits.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune visite trouvée</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredVisits.map((visit) => {
            const risks = getRiskSummary(visit);
            const reportStatus = visit.report?.status;
            const borderClass = reportStatus === 'envoye_au_client'
              ? 'border-2 border-green-500'
              : reportStatus
                ? 'border-2 border-blue-500'
                : 'border border-slate-200';
            return (
              <div key={visit.id} className={`bg-white rounded-xl ${borderClass} p-5 hover:shadow-md cursor-pointer transition-all`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0" onClick={() => setSelectedVisit(visit)}>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-900 truncate">{visit.mission?.title || 'Chantier inconnu'}</h3>
                      {visit.reportGenerated && <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium"><CheckCircle className="w-3 h-3" /> Rapport</span>}
                      {visit.report && <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(visit.report.status)}`}>{getStatusLabel(visit.report.status)}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-s text-slate-500">
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{new Date(visit.visitDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{visit.mission?.client || '—'}</span>
                      {visit.user && <span className="flex items-center gap-1">👤 {visit.user.firstName} {visit.user.lastName}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-s">
                      <span className="flex items-center gap-1 text-slate-600"><Camera className="w-4 h-4" />{getPhotoCount(visit)}</span>
                      {getDirectiveCount(visit) > 0 && <span className="flex items-center gap-1 text-slate-400 text-xs">📝 {getDirectiveCount(visit)}</span>}
                    </div>
                    <div className="flex gap-1">
                      {risks.high > 0 && <span className="w-2.5 h-2.5 rounded-full bg-red-500" title={`${risks.high} élevé`} />}
                      {risks.medium > 0 && <span className="w-2.5 h-2.5 rounded-full bg-amber-500" title={`${risks.medium} moyen`} />}
                      {risks.low > 0 && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title={`${risks.low} faible`} />}
                    </div>
                    <button onClick={(e) => handleDeleteVisit(visit, e)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                    <span onClick={() => setSelectedVisit(visit)} className="text-s text-blue-600 font-medium whitespace-nowrap cursor-pointer">Voir détails →</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create visit modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Nouvelle visite</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateVisit} className="p-6 space-y-4">
              <div>
                <label className="block text-s font-medium text-slate-700 mb-2">Chantier *</label>
                <select value={createMissionId} onChange={(e) => setCreateMissionId(e.target.value)} required
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none">
                  <option value="">Sélectionner un chantier</option>
                  {missions.filter(m => m.status !== 'terminee' && m.status !== 'annulee').map(m => <option key={m.id} value={m.id}>{m.title} — {m.client}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-s font-medium text-slate-700 mb-2">Date de visite *</label>
                <input type="date" value={createVisitDate} onChange={(e) => setCreateVisitDate(e.target.value)} required
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-s font-medium text-slate-700 mb-2">Notes</label>
                <textarea value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} rows={3}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none"
                  placeholder="Notes ou directives pour cette visite..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 px-6 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium">Annuler</button>
                <button type="submit" disabled={creating} className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
                  {creating ? 'Création...' : 'Créer la visite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MissionReportModal for viewing report after generation */}
      {showMissionReportModal && (
        <MissionReportModal
          mission={missionReportMission}
          onClose={async () => { setShowMissionReportModal(false); setMissionReportId(undefined); setMissionReportMission(null); await loadData(); }}
          initialReportId={missionReportId}
        />
      )}
    </div>
  );
}
