import { useState, useEffect, useRef } from 'react';
import { X, Calendar, Camera, FileText, AlertTriangle, CheckCircle, Clock, MapPin, Image as ImageIcon, Upload, Sparkles, Loader2, Plus, Pencil, Save, Trash2, RotateCcw, MessageSquare, Eye, Download, Send, Edit2 } from 'lucide-react';
import { visitService } from '../services/visitService';
import { visitsAPI, reportsAPI, missionsAPI } from '../lib/api';
import { filesService } from '../services/filesService';
import { uploadService } from '../services/uploadService';
import { aiService, AIAnalysis } from '../services/aiService';
import { generatePdfService } from '../services/generatePdfService';
import { useAuth } from '../contexts/AuthContext';
import MissionReportModal from './MissionReportModal';
import Swal from 'sweetalert2';

interface Visit {
  id: string;
  missionId: string;
  visitDate: string;
  photos: any[];
  photoCount: number;
  notes?: string;
  reportGenerated: boolean;
  createdAt: string;
  user?: { firstName: string; lastName: string };
  report?: any;
  mission?: any;
}

interface MissionVisitsModalProps {
  mission: { id: string; title: string; client: string; address: string; status?: string; type?: string };
  onClose: () => void;
  onNavigateToReports?: (reportId?: string) => void;
}

const toArray = (val: any) => { if (!val) return []; return Array.isArray(val) ? val : [val]; };

const getRiskColor = (level: string) => {
  switch (level) {
    case 'eleve': case 'high': return 'bg-red-100 text-red-700 border-red-200';
    case 'moyen': case 'medium': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'faible': case 'low': return 'bg-green-100 text-green-700 border-green-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

const getRiskLabel = (level: string) => {
  switch (level) {
    case 'eleve': case 'high': return 'Élevé';
    case 'moyen': case 'medium': return 'Moyen';
    case 'faible': case 'low': return 'Faible';
    default: return level;
  }
};

const BLOCKED_STATUSES = ['terminee', 'archivee', 'annulee', 'refusee'];

export default function MissionVisitsModal({ mission, onClose, onNavigateToReports }: MissionVisitsModalProps) {
  const { profile: currentUser } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [imageCache, setImageCache] = useState<Record<string, string>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDate, setCreateDate] = useState(new Date().toISOString().split('T')[0]);
  const [creating, setCreating] = useState(false);

  // Upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupAttachInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadDirectives, setUploadDirectives] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // Directive-only
  const [showDirectiveModal, setShowDirectiveModal] = useState(false);
  const [directiveOnlyText, setDirectiveOnlyText] = useState('');
  const [directiveOnlyComment, setDirectiveOnlyComment] = useState('');
  const [isAnalyzingDirective, setIsAnalyzingDirective] = useState(false);

  // Group detail / edit
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
  const [attachingToGroupId, setAttachingToGroupId] = useState<string | null>(null);

  // Report generation
  const [generatingReport, setGeneratingReport] = useState(false);

  // Show inline report modal (instead of navigating away)
  const [showInlineReportModal, setShowInlineReportModal] = useState(false);
  const [inlineReportId, setInlineReportId] = useState<string | undefined>(undefined);

  // Global directives
  const [editingNotes, setEditingNotes] = useState(false);
  const [tempNotes, setTempNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [isRegeneratingAll, setIsRegeneratingAll] = useState(false);
  const [regeneratingProgress, setRegeneratingProgress] = useState('');

  useEffect(() => { fetchVisits(); }, []);

  const isMissionBlocked = BLOCKED_STATUSES.includes(mission.status || '');
  const canModify = !isMissionBlocked;

  const fetchVisits = async () => {
    setLoading(true);
    try {
      const allVisits = await visitService.getVisit();
      const missionVisits = Array.isArray(allVisits) ? allVisits.filter((v: Visit) => v.missionId === mission.id) : [];
      setVisits(missionVisits);
    } catch (error) { console.error('Error fetching visits:', error); }
    setLoading(false);
  };

  const loadImageBase64 = async (url: string) => {
    if (!url || imageCache[url]) return;
    try {
      const response = await filesService.downloadFile(url, 'reports', true);
      const { base64 } = response.data;
      if (base64) {
        const dataUrl = base64.startsWith('data:image') ? base64 : `data:image/jpeg;base64,${base64}`;
        setImageCache(prev => ({ ...prev, [url]: dataUrl }));
      }
    } catch (error) { console.error('Erreur chargement image:', error); }
  };

  const loadGroupImages = async (photos: any[]) => {
    const promises = photos.filter(p => p.s3Url && !imageCache[p.s3Url]).map(p => loadImageBase64(p.s3Url!));
    await Promise.all(promises);
  };

  const handleCreateVisit = async () => {
    setCreating(true);
    try {
      await visitsAPI.create({ missionId: mission.id, visitDate: createDate });
      setShowCreateForm(false);
      await fetchVisits();
      Swal.fire({ icon: 'success', title: 'Visite créée', timer: 1500, showConfirmButton: false });
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: error.message || 'Erreur lors de la création' });
    }
    setCreating(false);
  };

  // ─── PHOTO UPLOAD ──────────────────────────────
  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPendingFiles(files);
    setPendingPreviews(files.map(f => URL.createObjectURL(f)));
    setUploadDirectives('');
    setShowUploadModal(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const cancelUpload = () => {
    pendingPreviews.forEach(p => URL.revokeObjectURL(p));
    setPendingFiles([]); setPendingPreviews([]);
    setShowUploadModal(false);
  };

  const uploadAndAnalyze = async (analyze: boolean) => {
    if (!selectedVisit || pendingFiles.length === 0) return;
    setIsUploading(true);
    setShowUploadModal(false);
    const batchGroupId = `group-${Date.now()}`;
    const uploadedS3Urls: string[] = [];
    const newPhotos: any[] = [];

    try {
      for (let i = 0; i < pendingFiles.length; i++) {
        setUploadProgress(`Upload photo ${i + 1}/${pendingFiles.length}...`);
        try {
          const results = await uploadService.uploadVisitPhotos([pendingFiles[i]]);
          const s3Url = results[0]?.url;
          if (s3Url) {
            uploadedS3Urls.push(s3Url);
            newPhotos.push({ id: `photo-${Date.now()}-${i}`, uri: s3Url, s3Url, validated: false, groupId: batchGroupId, userDirectives: uploadDirectives, comment: '' });
          }
        } catch (error) { console.error(`Upload error ${i}:`, error); }
      }

      if (analyze && uploadedS3Urls.length > 0) {
        setUploadProgress(`Analyse IA de ${uploadedS3Urls.length} photo(s)...`);
        try {
          const analysis = await aiService.analyzeBatchPhotos(uploadedS3Urls, uploadDirectives || undefined);
          const photoAnalysis = {
            observation: analysis.observations, recommendation: analysis.recommendations,
            references: analysis.references,
            riskLevel: analysis.riskLevel === 'low' ? 'faible' : analysis.riskLevel === 'medium' ? 'moyen' : 'eleve',
            confidence: analysis.confidence,
          };
          newPhotos.forEach(p => { p.analysis = photoAnalysis; });
        } catch (error) { console.error('AI analysis error:', error); }
      }

      const updatedPhotos = [...(selectedVisit.photos || []), ...newPhotos];
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      pendingPreviews.forEach(p => URL.revokeObjectURL(p));
      setPendingFiles([]); setPendingPreviews([]);
      Swal.fire({ icon: 'success', title: 'Photos ajoutées', timer: 1500, showConfirmButton: false });
    } catch (error) { Swal.fire({ icon: 'error', title: 'Erreur' }); }
    setIsUploading(false); setUploadProgress('');
  };

  // ─── ATTACH PHOTOS TO EXISTING GROUP ────────────
  const onAttachFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !selectedVisit || !attachingToGroupId) return;
    if (groupAttachInputRef.current) groupAttachInputRef.current.value = '';

    setIsUploading(true);
    setUploadProgress('Upload des photos supplémentaires...');
    try {
      const newPhotos: any[] = [];
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

  // ─── DIRECTIVE-ONLY ANALYSIS ────────────────────
  const handleDirectiveOnlyAnalysis = async () => {
    if (!selectedVisit || !directiveOnlyText.trim()) return;
    setIsAnalyzingDirective(true);
    try {
      const missionContext = { title: mission.title, client: mission.client, address: mission.address, type: mission.type };
      const analysis = await aiService.analyzeDirectives(directiveOnlyText, missionContext);

      const directivePhoto = {
        id: `directive-${Date.now()}`,
        uri: '', validated: false, isDirectiveOnly: true,
        groupId: `directive-group-${Date.now()}`,
        userDirectives: directiveOnlyText,
        comment: directiveOnlyComment,
        analysis: {
          observation: analysis.observations, recommendation: analysis.recommendations,
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
      Swal.fire({ icon: 'success', title: 'Directive analysée', timer: 1500, showConfirmButton: false });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: "L'analyse IA a échoué" });
    }
    setIsAnalyzingDirective(false);
  };

  // ─── PHOTO GROUPS ──────────────────────────────
  const photoGroups = (photos: any[]) => {
    const groups: Record<string, any[]> = {};
    photos?.forEach(photo => {
      const gid = photo.groupId || photo.id;
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(photo);
    });
    return Object.entries(groups);
  };

  // ─── GROUP EDITING ──────────────────────────────
  const openGroupDetail = async (groupId: string, groupPhotos: any[], autoEdit = true) => {
    const first = groupPhotos[0];
    setSelectedGroupId(groupId);
    setTempGroupDirectives(first?.userDirectives || '');
    setTempGroupComments(first?.comment || '');
    setTempGroupObservations([...toArray(first?.analysis?.observation)]);
    setTempGroupRecommendations([...toArray(first?.analysis?.recommendation)]);
    setTempGroupReferences([...toArray(first?.analysis?.references)]);
    setEditingGroupReport(autoEdit);
    setShowGroupDetail(true);
    await loadGroupImages(groupPhotos);
  };

  const saveGroupReportEdits = async () => {
    if (!selectedVisit || !selectedGroupId) return;
    const updatedPhotos = selectedVisit.photos.map((p: any) => {
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

  const regenerateGroupReport = async () => {
    if (!selectedVisit || !selectedGroupId) return;
    const groupPhotos = selectedVisit.photos.filter((p: any) => (p.groupId || p.id) === selectedGroupId);
    const first = groupPhotos[0];
    const isDirectiveOnly = first?.isDirectiveOnly;

    // Validate directives
    if (!tempGroupDirectives.trim()) {
      Swal.fire({ icon: 'warning', title: 'Directives requises', text: 'Veuillez remplir le champ directives avant de réanalyser.' });
      return;
    }

    // Build previousReport from existing analysis
    const existingObs = toArray(first?.analysis?.observation);
    const existingRecs = toArray(first?.analysis?.recommendation);
    const existingRefs = toArray(first?.analysis?.references);
    const previousReport = first?.analysis ? JSON.stringify({
      observations: existingObs,
      recommendations: existingRecs,
      references: existingRefs,
      riskLevel: first.analysis.riskLevel,
      confidence: first.analysis.confidence,
    }) : undefined;

    setIsRegeneratingGroup(true);
    try {
      let analysis: AIAnalysis;
      if (isDirectiveOnly) {
        const missionContext = { title: mission.title, client: mission.client, address: mission.address, type: mission.type };
        analysis = await aiService.analyzeDirectives(tempGroupDirectives, missionContext, previousReport);
      } else {
        const s3Urls = groupPhotos.filter((p: any) => p.s3Url).map((p: any) => p.s3Url);
        if (s3Urls.length === 0) { Swal.fire({ icon: 'error', title: 'Erreur', text: 'Aucune photo dans ce groupe' }); return; }
        analysis = await aiService.analyzeBatchPhotos(s3Urls, tempGroupDirectives, previousReport);
      }

      const photoAnalysis = {
        observation: analysis.observations, recommendation: analysis.recommendations,
        references: analysis.references,
        riskLevel: analysis.riskLevel === 'low' ? 'faible' : analysis.riskLevel === 'medium' ? 'moyen' : 'eleve',
        confidence: analysis.confidence,
      };

      const updatedPhotos = selectedVisit.photos.map((p: any) => {
        if ((p.groupId || p.id) === selectedGroupId) {
          return { ...p, analysis: photoAnalysis, userDirectives: tempGroupDirectives };
        }
        return p;
      });

      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      setTempGroupObservations([...analysis.observations]);
      setTempGroupRecommendations([...analysis.recommendations]);
      setTempGroupReferences([...analysis.references]);
      // Auto-save directives after reanalysis
      await saveGroupReportEdits();
      Swal.fire({ icon: 'success', title: 'Rapport régénéré et sauvegardé', timer: 1500, showConfirmButton: false });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: "L'analyse IA a échoué" });
    }
    setIsRegeneratingGroup(false);
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!selectedVisit) return;
    const confirm = await Swal.fire({
      title: 'Supprimer le groupe', text: 'Supprimer ce groupe et son analyse ?',
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Supprimer', cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;
    const updatedPhotos = selectedVisit.photos.filter((p: any) => (p.groupId || p.id) !== groupId);
    try {
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      if (selectedGroupId === groupId) { setShowGroupDetail(false); setSelectedGroupId(null); }
      Swal.fire({ icon: 'success', title: 'Groupe supprimé', timer: 1500, showConfirmButton: false });
    } catch { Swal.fire({ icon: 'error', title: 'Erreur' }); }
  };

  // ─── DELETE ATTACHED PHOTO (non-AI) ─────────────
  const handleDeleteAttachedPhoto = async (photo: any) => {
    if (!selectedVisit) return;
    const confirm = await Swal.fire({
      title: 'Supprimer la photo jointe',
      text: 'Cette photo sera supprimée du serveur et du groupe. Confirmer ?',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#dc2626', confirmButtonText: 'Supprimer', cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    try {
      // Delete from S3
      if (photo.s3Url) {
        try { await uploadService.deletePhotoByUrl(photo.s3Url); } catch (e) { console.error('S3 delete error:', e); }
      }
      // Remove from visit photos
      const updatedPhotos = selectedVisit.photos.filter((p: any) => p.id !== photo.id);
      await visitsAPI.update(selectedVisit.id, { photos: updatedPhotos });
      setSelectedVisit(prev => prev ? { ...prev, photos: updatedPhotos } : null);
      Swal.fire({ icon: 'success', title: 'Photo supprimée', timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'Erreur lors de la suppression' });
    }
  };

  // ─── NOTES / GLOBAL DIRECTIVES ──────────────────
  const handleSaveNotes = async () => {
    if (!selectedVisit) return;
    setSavingNotes(true);
    try {
      await visitsAPI.update(selectedVisit.id, { notes: tempNotes });
      setSelectedVisit(prev => prev ? { ...prev, notes: tempNotes } : null);
      setEditingNotes(false);
      Swal.fire({ icon: 'success', title: 'Notes sauvegardées', timer: 1500, showConfirmButton: false });
    } catch { Swal.fire({ icon: 'error', title: 'Erreur' }); }
    setSavingNotes(false);
  };

  const regenerateAllGroups = async () => {
    if (!selectedVisit) return;
    const groups = photoGroups(selectedVisit.photos);
    if (groups.length === 0) return;
    if (!selectedVisit.notes?.trim()) {
      Swal.fire({ icon: 'info', title: 'Info', text: 'Veuillez saisir des directives globales (notes) avant de regénérer.' });
      return;
    }
    const confirm = await Swal.fire({
      title: 'Regénérer tout', text: `Regénérer les ${groups.length} groupe(s) avec les directives globales ?`,
      icon: 'question', showCancelButton: true, confirmButtonText: 'Regénérer', cancelButtonText: 'Annuler',
    });
    if (!confirm.isConfirmed) return;

    setIsRegeneratingAll(true);
    let updatedPhotos = [...selectedVisit.photos];
    try {
      for (let i = 0; i < groups.length; i++) {
        const [groupId, groupPhotos] = groups[i];
        const first = groupPhotos[0];
        setRegeneratingProgress(`Groupe ${i + 1}/${groups.length}...`);

        // Build previousReport from existing analysis for each group
        const existingObs = toArray(first?.analysis?.observation);
        const existingRecs = toArray(first?.analysis?.recommendation);
        const existingRefs = toArray(first?.analysis?.references);
        const previousReport = first?.analysis ? JSON.stringify({
          observations: existingObs,
          recommendations: existingRecs,
          references: existingRefs,
          riskLevel: first.analysis.riskLevel,
          confidence: first.analysis.confidence,
        }) : undefined;

        try {
          let analysis: AIAnalysis;
          if (first?.isDirectiveOnly) {
            analysis = await aiService.analyzeDirectives(selectedVisit.notes!, { title: mission.title, client: mission.client, address: mission.address, type: mission.type }, previousReport);
          } else {
            const s3Urls = groupPhotos.filter((p: any) => p.s3Url).map((p: any) => p.s3Url);
            if (s3Urls.length === 0) continue;
            analysis = await aiService.analyzeBatchPhotos(s3Urls, selectedVisit.notes!, previousReport);
          }
          const photoAnalysis = {
            observation: analysis.observations, recommendation: analysis.recommendations,
            references: analysis.references,
            riskLevel: analysis.riskLevel === 'low' ? 'faible' : analysis.riskLevel === 'medium' ? 'moyen' : 'eleve',
            confidence: analysis.confidence,
          };
          updatedPhotos = updatedPhotos.map(p => {
            if ((p.groupId || p.id) === groupId) return { ...p, analysis: photoAnalysis, userDirectives: selectedVisit.notes };
            return p;
          });
        } catch (error) { console.error(`Erreur groupe ${i + 1}:`, error); }
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
      if (result.isConfirmed) {
        // Get report ID from refreshed visit
        const refreshed = await visitsAPI.getById(selectedVisit.id);
        const reportId = refreshed?.report?.id;
        if (reportId) {
          setInlineReportId(reportId);
        }
        setShowInlineReportModal(true);
      }
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Erreur', text: 'La regénération a échoué' });
    }
    setIsRegeneratingAll(false); setRegeneratingProgress('');
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
      await fetchVisits();
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
      if (result.isConfirmed && reportId) {
        setInlineReportId(reportId);
        setShowInlineReportModal(true);
      }
    } catch (error: any) {
      setGeneratingReport(false);
      Swal.fire({ icon: 'error', title: 'Erreur', text: error.message || 'Erreur lors de la génération' });
    }
  };

  // Save or update report in DB (like mobile)
  const saveOrUpdateReport = async (visit: any, generatedReport?: any): Promise<string | undefined> => {
    try {
      // Check if report already exists for this visit
      const existingReportId = visit?.report?.id || generatedReport?.id;
      if (existingReportId) {
        return existingReportId;
      }
      // If generateReport already created one, try to get it from the refreshed visit
      const refreshed = await visitsAPI.getById(visit.id);
      return refreshed?.report?.id;
    } catch (error) {
      console.error('Error saving report:', error);
      return undefined;
    }
  };

  // ─── HELPERS ────────────────────────────────────
  const addItem = (setter: React.Dispatch<React.SetStateAction<string[]>>) => setter(prev => [...prev, '']);
  const updateItem = (setter: React.Dispatch<React.SetStateAction<string[]>>, index: number, value: string) => setter(prev => prev.map((v, i) => i === index ? value : v));
  const removeItem = (setter: React.Dispatch<React.SetStateAction<string[]>>, index: number) => setter(prev => prev.filter((_, i) => i !== index));

  // ─── RENDER: Group Detail Modal ─────────────────
  const renderGroupDetailModal = () => {
    if (!showGroupDetail || !selectedGroupId || !selectedVisit) return null;
    const groupPhotos = selectedVisit.photos.filter((p: any) => (p.groupId || p.id) === selectedGroupId);
    if (groupPhotos.length === 0) return null;
    const first = groupPhotos[0];
    const isDirectiveOnly = first?.isDirectiveOnly;
    const obs = editingGroupReport ? tempGroupObservations : toArray(first?.analysis?.observation);
    const recs = editingGroupReport ? tempGroupRecommendations : toArray(first?.analysis?.recommendation);
    const refs = editingGroupReport ? tempGroupReferences : toArray(first?.analysis?.references);
    const riskLevel = first?.analysis?.riskLevel || '';

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60] overflow-y-auto">
        <div className="bg-white rounded-xl max-w-4xl w-full my-8 max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {isDirectiveOnly ? '📝 Rapport Directive' : `📸 Rapport — ${groupPhotos.length} photo(s)`}
              </h2>
              {riskLevel && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-s font-medium border mt-1 ${getRiskColor(riskLevel)}`}>{getRiskLabel(riskLevel)}</span>}
            </div>
            <div className="flex items-center gap-2">
              {(() => {
                const visitReportStatus = selectedVisit?.report?.status;
                const visitCanModify = canModify && visitReportStatus !== 'envoye_au_client';
                return visitCanModify && !editingGroupReport ? (
                  <button onClick={() => { setEditingGroupReport(true); setTempGroupObservations([...obs]); setTempGroupRecommendations([...recs]); setTempGroupReferences([...refs]); }}
                    className="flex items-center gap-1 px-3 py-1.5 text-s bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">
                    <Pencil className="w-3.5 h-3.5" /> Modifier
                  </button>
                ) : null;
              })()}
              {editingGroupReport && (
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
                {editingGroupReport && <button onClick={() => addItem(setTempGroupObservations)} className="text-s text-blue-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>}
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
                  <ul className="space-y-1">{obs.map((o: string, i: number) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-red-400 mt-0.5">•</span> {o}</li>)}</ul>
                ) : <p className="text-s text-slate-400 italic">Aucune observation</p>
              )}
            </div>

            {/* Recommendations */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-s font-semibold text-blue-600 flex items-center gap-1"><span className="w-1 h-4 bg-blue-500 rounded"></span> 💡 Recommandations</h4>
                {editingGroupReport && <button onClick={() => addItem(setTempGroupRecommendations)} className="text-s text-blue-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>}
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
                  <ul className="space-y-1">{recs.map((r: string, i: number) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> {r}</li>)}</ul>
                ) : <p className="text-s text-slate-400 italic">Aucune recommandation</p>
              )}
            </div>

            {/* References */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-s font-semibold text-purple-600 flex items-center gap-1"><span className="w-1 h-4 bg-purple-500 rounded"></span> 🏛️ Références</h4>
                {editingGroupReport && <button onClick={() => addItem(setTempGroupReferences)} className="text-s text-purple-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>}
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
                  <ul className="space-y-1">{refs.map((r: string, i: number) => <li key={i} className="text-s text-slate-600 flex items-start gap-2"><span className="text-purple-400 mt-0.5">•</span> {r}</li>)}</ul>
                ) : <p className="text-s text-slate-400 italic">Aucune référence</p>
              )}
            </div>

            {/* Directives - always editable */}
            <div>
              <h4 className="text-s font-semibold text-slate-700 mb-2">📋 Directives</h4>
              <textarea value={tempGroupDirectives} onChange={e => setTempGroupDirectives(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-s focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none" rows={3}
                placeholder="Directives pour ce groupe..." />
            </div>

            {/* Comments */}
            <div>
              <h4 className="text-s font-semibold text-amber-600 mb-2 flex items-center gap-1"><span className="w-1 h-4 bg-amber-500 rounded"></span> 💬 Notes / Commentaires</h4>
              {editingGroupReport ? (
                <textarea value={tempGroupComments} onChange={e => setTempGroupComments(e.target.value)}
                  className="w-full px-3 py-2 border border-amber-200 rounded-lg text-s focus:ring-2 focus:ring-amber-100 focus:border-amber-400 outline-none bg-amber-50/30" rows={3}
                  placeholder="Commentaires..." />
              ) : (
                <div className="bg-slate-50 rounded-lg p-3 text-s text-slate-700 italic">{first?.comment || <span className="text-slate-400">Aucun commentaire</span>}</div>
              )}
            </div>

            {/* Photos grid - at the end */}
            {!isDirectiveOnly && groupPhotos.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-s font-semibold text-slate-700">📸 Photos ({groupPhotos.length})</h4>
                  {canModify && (
                    <button onClick={() => { setAttachingToGroupId(selectedGroupId); groupAttachInputRef.current?.click(); }}
                      className="flex items-center gap-1 text-s text-blue-600 hover:underline">
                      <Plus className="w-3 h-3" /> Joindre des photos
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {groupPhotos.map((photo: any, idx: number) => {
                    const src = photo.s3Url ? (imageCache[photo.s3Url] || photo.s3Url) : photo.uri;
                    const isAttachedOnly = !photo.analysis && !photo.isDirectiveOnly;
                    const canDeleteAttached = canModify && isAttachedOnly;
                    return (
                      <div key={photo.id || idx} className="relative">
                        {src ? (
                          <img src={src} alt={`Photo ${idx + 1}`}
                            className="w-full h-40 object-cover rounded-lg border border-slate-200"
                            onError={() => { if (photo.s3Url && !imageCache[photo.s3Url]) loadImageBase64(photo.s3Url); }} />
                        ) : (
                          <div className="w-full h-40 bg-slate-100 rounded-lg flex items-center justify-center"><ImageIcon className="w-8 h-8 text-slate-300" /></div>
                        )}
                        <span className="absolute top-2 left-2 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-s font-bold">{idx + 1}</span>
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

          <div className="p-4 border-t border-slate-200 flex flex-wrap gap-2">
            {(() => {
              const visitReportStatus = selectedVisit?.report?.status;
              const visitCanModify = canModify && visitReportStatus !== 'envoye_au_client';
              return visitCanModify ? (
                <>
                  <button onClick={regenerateGroupReport} disabled={isRegeneratingGroup}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 text-s font-medium disabled:opacity-50">
                    {isRegeneratingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isRegeneratingGroup ? 'Analyse...' : 'Réanalyser avec directives'}
                  </button>
                  <button onClick={() => handleDeleteGroup(selectedGroupId!)} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 text-s font-medium">
                    <Trash2 className="w-4 h-4" /> Supprimer
                  </button>
                </>
              ) : null;
            })()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col relative">
        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-6 h-6 text-emerald-600" /> Visites du chantier
            </h2>
            <p className="text-slate-600 mt-1">{mission.title} — {mission.client}</p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && (
              <button onClick={() => setShowCreateForm(true)} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-s font-medium">
                <Plus className="w-4 h-4" /> Nouvelle visite
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesSelected} />
        <input ref={groupAttachInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onAttachFilesSelected} />

        {/* Loading overlay */}
        {(isUploading || isRegeneratingAll) && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 rounded-xl">
            <div className="bg-white rounded-xl p-6 text-center">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-s text-slate-600">{uploadProgress || regeneratingProgress}</p>
            </div>
          </div>
        )}

        {/* Upload modal */}
        {showUploadModal && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 rounded-xl p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
              <h3 className="font-bold text-slate-900">Photos sélectionnées ({pendingFiles.length})</h3>
              <div className="grid grid-cols-3 gap-2">{pendingPreviews.map((p, i) => <img key={i} src={p} className="w-full h-20 object-cover rounded-lg border" />)}</div>
              <textarea value={uploadDirectives} onChange={e => setUploadDirectives(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-s" rows={3} placeholder="Directives pour l'analyse IA (optionnel)..." />
              <div className="flex gap-2">
                <button onClick={cancelUpload} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-s">Annuler</button>
                {/* <button onClick={() => uploadAndAnalyze(false)} className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg text-s">Sauvegarder</button> */}
                <button onClick={() => uploadAndAnalyze(true)} className="flex-1 flex items-center justify-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-s">
                  <Sparkles className="w-3.5 h-3.5" /> Analyser
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Directive-only modal */}
        {showDirectiveModal && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 rounded-xl p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
              <h3 className="font-bold text-slate-900">📝 Analyse sans photo</h3>
              <div>
                <label className="block text-s font-medium text-slate-700 mb-1">Directives *</label>
                <textarea value={directiveOnlyText} onChange={e => setDirectiveOnlyText(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-s" rows={4}
                  placeholder="Saisissez vos directives pour l'analyse IA..." />
              </div>
              <div>
                <label className="block text-s font-medium text-slate-700 mb-1">Commentaires (optionnel)</label>
                <textarea value={directiveOnlyComment} onChange={e => setDirectiveOnlyComment(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-s" rows={3}
                  placeholder="Commentaires supplémentaires..." />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowDirectiveModal(false)} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-s">Annuler</button>
                <button onClick={handleDirectiveOnlyAnalysis} disabled={!directiveOnlyText.trim() || isAnalyzingDirective}
                  className="flex-1 flex items-center justify-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-s disabled:opacity-50">
                  {isAnalyzingDirective ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {isAnalyzingDirective ? 'Analyse...' : 'Analyser'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create visit form */}
        {showCreateForm && (
          <div className="p-4 border-b border-slate-200 bg-blue-50">
            <div className="flex items-center gap-3">
              <input type="date" value={createDate} onChange={e => setCreateDate(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-s" />
              <button onClick={handleCreateVisit} disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-s font-medium disabled:opacity-50">
                {creating ? 'Création...' : 'Créer'}
              </button>
              <button onClick={() => setShowCreateForm(false)} className="px-3 py-2 text-s text-slate-600 hover:underline">Annuler</button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-slate-500">Chargement...</div>
          ) : visits.length === 0 ? (
            <div className="text-center py-12">
              <Camera className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">Aucune visite pour ce chantier</p>
            </div>
          ) : selectedVisit ? (
            <div>
              <button onClick={() => setSelectedVisit(null)} className="text-s text-blue-600 hover:underline mb-4 flex items-center gap-1">← Retour à la liste</button>

              {/* Visit info + actions */}
              <div className="bg-slate-50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-s text-slate-600 mb-2">
                      <Calendar className="w-4 h-4" />
                      {new Date(selectedVisit.visitDate).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                    <div className="flex items-center gap-4 text-s text-slate-600">
                      <span className="flex items-center gap-1"><Camera className="w-4 h-4" />{selectedVisit.photos?.filter((p: any) => !p.isDirectiveOnly)?.length || 0} photo(s)</span>
                      {selectedVisit.reportGenerated && <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-4 h-4" />Rapport généré</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(() => {
                      const visitReportStatus = selectedVisit.report?.status;
                      const visitCanModify = canModify && visitReportStatus !== 'envoye_au_client';
                      return (
                        <>
                          {visitCanModify && (
                            <>
                              <button onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-s font-medium">
                                <Upload className="w-4 h-4" /> Photos
                              </button>
                              <button onClick={() => setShowDirectiveModal(true)}
                                className="flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 text-s font-medium">
                                <MessageSquare className="w-4 h-4" /> Sans photo
                              </button>
                            </>
                          )}
                          {selectedVisit.photos?.length > 0 && visitCanModify && (
                            <button onClick={handleGenerateReport} disabled={generatingReport}
                              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-s font-medium disabled:opacity-50">
                              <FileText className="w-4 h-4" /> {generatingReport ? 'Génération...' : 'Générer rapport'}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Photo groups */}
              {selectedVisit.photos && selectedVisit.photos.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2"><ImageIcon className="w-5 h-5" /> Groupes de rapports ({photoGroups(selectedVisit.photos).length})</h3>
                    {(() => {
                      const visitReportStatus = selectedVisit?.report?.status;
                      const visitCanModify = canModify && visitReportStatus !== 'envoye_au_client';
                      return visitCanModify && photoGroups(selectedVisit.photos).length > 0 ? (
                        <button onClick={regenerateAllGroups} disabled={isRegeneratingAll}
                          className="flex items-center gap-1 text-s text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg hover:bg-amber-100 disabled:opacity-50">
                          {isRegeneratingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          Regénérer tout
                        </button>
                      ) : null;
                    })()}
                  </div>

                  {photoGroups(selectedVisit.photos).map(([groupId, groupPhotos], gIdx) => {
                    const first = groupPhotos[0];
                    const obs = toArray(first?.analysis?.observation);
                    const recs = toArray(first?.analysis?.recommendation);
                    const refs = toArray(first?.analysis?.references);

                    return (
                      <div key={groupId} className="border border-slate-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-s font-bold">{gIdx + 1}</span>
                            <span className="font-medium text-slate-900">{first?.isDirectiveOnly ? '📝 Directives' : `📸 ${groupPhotos.length} photo(s)`}</span>
                            {first?.analysis?.riskLevel && (
                              <span className={`px-2 py-0.5 rounded-full text-s font-medium border ${getRiskColor(first.analysis.riskLevel)}`}>{getRiskLabel(first.analysis.riskLevel)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {(() => {
                              const visitReportStatus = selectedVisit?.report?.status;
                              const visitCanModify = canModify && visitReportStatus !== 'envoye_au_client';
                              return visitCanModify ? (
                                <>
                                  <button onClick={() => openGroupDetail(groupId, groupPhotos)}
                                    className="flex items-center gap-1 px-2 py-1 text-s bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">
                                    <Pencil className="w-3 h-3" /> Modifier
                                  </button>
                                  <button onClick={() => {
                                    const s3Urls = groupPhotos.filter((p: any) => p.s3Url).map((p: any) => p.s3Url);
                                    if (first?.isDirectiveOnly || s3Urls.length > 0) {
                                      openGroupDetail(groupId, groupPhotos, true);
                                    }
                                  }}
                                    className="flex items-center gap-1 px-2 py-1 text-s bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100">
                                    <RotateCcw className="w-3 h-3" /> Réanalyser
                                  </button>
                                  <button onClick={() => handleDeleteGroup(groupId)}
                                    className="p-1 text-red-500 hover:bg-red-50 rounded-lg">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : null;
                            })()}
                          </div>
                        </div>

                        {/* Observations as blocks */}
                        <div className="mb-3">
                          <h4 className="text-s font-semibold text-slate-700 mb-1">🔍 Observations</h4>
                          {obs.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">{obs.map((o: string, i: number) => <span key={i} style={{ whiteSpace: 'pre-line' }} className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-s bg-red-50 text-red-700 border border-red-200">{o}</span>)}</div>
                          ) : <p className="text-s text-slate-400 italic">Aucune</p>}
                        </div>
                        {/* Recommandations as blocks */}
                        <div className="mb-3">
                          <h4 className="text-s font-semibold text-slate-700 mb-1">💡 Recommandations</h4>
                          {recs.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">{recs.map((r: string, i: number) => <span key={i} style={{ whiteSpace: 'pre-line' }} className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-s bg-blue-50 text-blue-700 border border-blue-200">{r}</span>)}</div>
                          ) : <p className="text-s text-slate-400 italic">Aucune</p>}
                        </div>
                        {/* Références as blocks */}
                        <div className="mb-3">
                          <h4 className="text-s font-semibold text-slate-700 mb-1">🏛️ Références</h4>
                          {refs.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">{refs.map((r: string, i: number) => <span key={i} style={{ whiteSpace: 'pre-line' }} className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-s bg-purple-50 text-purple-700 border border-purple-200">{r}</span>)}</div>
                          ) : <p className="text-s text-slate-400 italic">Aucune</p>}
                        </div>
                        {first?.userDirectives && (
                          <div className="mb-3">
                            <h4 className="text-s font-semibold text-slate-700 mb-1">📋 Directives</h4>
                            <p style={{ whiteSpace: 'pre-line' }} className="text-s text-slate-600 bg-slate-50 rounded-lg p-2">{first.userDirectives}</p>
                          </div>
                        )}
                        {first?.comment && (
                          <div className="mb-3">
                            <h4 className="text-s font-semibold text-slate-700 mb-1">💬 Notes</h4>
                            <p style={{ whiteSpace: 'pre-line' }} className="text-s text-slate-500 italic">{first.comment}</p>
                          </div>
                        )}

                        {/* Photos at the end */}
                        {!first?.isDirectiveOnly && (
                          <div className="grid grid-cols-3 gap-2 mt-3">
                            {groupPhotos.map((photo: any, index: number) => {
                              const src = photo.s3Url || photo.uri;
                              return (
                                <div key={photo.id || index} className="relative">
                                  {src ? (
                                    <img src={imageCache[src] || src} alt={`Photo ${index + 1}`}
                                      className="w-full h-24 object-cover rounded-lg border border-slate-200"
                                      onError={() => { if (photo.s3Url && !imageCache[photo.s3Url]) loadImageBase64(photo.s3Url); }} />
                                  ) : (
                                    <div className="w-full h-24 bg-slate-100 rounded-lg flex items-center justify-center"><ImageIcon className="w-6 h-6 text-slate-400" /></div>
                                  )}
                                  <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">{index + 1}</span>
                                </div>
                              );
                            })}
                            {canModify && (
                              <button onClick={() => { setAttachingToGroupId(groupId); groupAttachInputRef.current?.click(); }}
                                className="w-full h-24 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:border-blue-400 hover:text-blue-500">
                                <Plus className="w-5 h-5" />
                                <span className="text-[10px]">Joindre</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Camera className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 mb-3">Aucune photo pour cette visite</p>
                  {canModify && (
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-s font-medium">
                        <Upload className="w-4 h-4" /> Ajouter des photos
                      </button>
                      <button onClick={() => setShowDirectiveModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 text-s font-medium">
                        <MessageSquare className="w-4 h-4" /> Analyse sans photo
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Global directives / notes */}
              <div className="mt-6 bg-slate-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4" /> Directives globales / Notes</h3>
                  {canModify && !editingNotes && (
                    <button onClick={() => { setEditingNotes(true); setTempNotes(selectedVisit.notes || ''); }}
                      className="text-s text-blue-600 hover:underline flex items-center gap-1"><Edit2 className="w-3 h-3" /> Modifier</button>
                  )}
                  {editingNotes && (
                    <div className="flex gap-2">
                      <button onClick={() => setEditingNotes(false)} className="px-2 py-1 text-s border border-slate-300 rounded-lg hover:bg-slate-100">Annuler</button>
                      <button onClick={handleSaveNotes} disabled={savingNotes}
                        className="flex items-center gap-1 px-2 py-1 text-s bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                        <Save className="w-3 h-3" /> {savingNotes ? '...' : 'Sauvegarder'}
                      </button>
                    </div>
                  )}
                </div>
                {editingNotes ? (
                  <textarea value={tempNotes} onChange={e => setTempNotes(e.target.value)} rows={3}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-s" placeholder="Directives globales pour regénération..." />
                ) : (
                  <div className="text-s text-slate-700 whitespace-pre-wrap">{selectedVisit.notes || <span className="text-slate-400 italic">Aucune note</span>}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {visits.map((visit) => {
                const reportStatus = visit.report?.status;
                const borderClass = reportStatus === 'envoye_au_client'
                  ? 'border-2 border-green-400'
                  : reportStatus
                    ? 'border-2 border-blue-400'
                    : 'border border-slate-200';
                return (
                  <div key={visit.id} onClick={() => setSelectedVisit(visit)}
                    className={`${borderClass} rounded-lg p-4 hover:bg-slate-50 cursor-pointer transition-colors`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-slate-900 font-medium">
                          <Calendar className="w-4 h-4 text-slate-500" />
                          {new Date(visit.visitDate).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-s text-slate-500">
                          <span className="flex items-center gap-1"><Camera className="w-3.5 h-3.5" />{visit.photoCount || visit.photos?.length || 0} photo(s)</span>
                          {visit.reportGenerated && <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-3.5 h-3.5" />Rapport généré</span>}
                        </div>
                      </div>
                      <span className="text-s text-blue-600 font-medium">Voir détails →</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Group detail modal */}
        {renderGroupDetailModal()}

        {/* Inline Report Modal */}
        {showInlineReportModal && (
          <MissionReportModal
            mission={mission}
            onClose={() => { setShowInlineReportModal(false); setInlineReportId(undefined); }}
            initialReportId={inlineReportId}
          />
        )}
      </div>
    </div>
  );
}
