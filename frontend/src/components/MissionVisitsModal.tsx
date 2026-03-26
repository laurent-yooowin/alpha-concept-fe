import { useState, useEffect } from 'react';
import { X, Calendar, Camera, FileText, AlertTriangle, CheckCircle, Clock, MapPin, Image as ImageIcon } from 'lucide-react';
import { visitService } from '../services/visitService';

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
}

interface MissionVisitsModalProps {
  mission: { id: string; title: string; client: string; address: string };
  onClose: () => void;
}

export default function MissionVisitsModal({ mission, onClose }: MissionVisitsModalProps) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

  useEffect(() => {
    fetchVisits();
  }, []);

  const fetchVisits = async () => {
    setLoading(true);
    try {
      const allVisits = await visitService.getVisit();
      const missionVisits = Array.isArray(allVisits)
        ? allVisits.filter((v: Visit) => v.missionId === mission.id)
        : [];
      setVisits(missionVisits);
    } catch (error) {
      console.error('Error fetching visits:', error);
    }
    setLoading(false);
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'eleve': return 'bg-red-100 text-red-700 border-red-200';
      case 'moyen': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'faible': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-6 h-6 text-emerald-600" />
              Visites du chantier
            </h2>
            <p className="text-slate-600 mt-1">{mission.title} — {mission.client}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

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
            /* Visit detail view */
            <div>
              <button
                onClick={() => setSelectedVisit(null)}
                className="text-sm text-prosps-blue hover:underline mb-4 flex items-center gap-1"
              >
                ← Retour à la liste
              </button>

              <div className="bg-slate-50 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                  <Calendar className="w-4 h-4" />
                  {new Date(selectedVisit.visitDate).toLocaleDateString('fr-FR', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                  })}
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <span className="flex items-center gap-1">
                    <Camera className="w-4 h-4" />
                    {selectedVisit.photoCount || selectedVisit.photos?.length || 0} photo(s)
                  </span>
                  {selectedVisit.reportGenerated && (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="w-4 h-4" />
                      Rapport généré
                    </span>
                  )}
                </div>
              </div>

              {/* Photos */}
              {selectedVisit.photos && selectedVisit.photos.length > 0 && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    Photos ({selectedVisit.photos.length})
                  </h3>
                  {selectedVisit.photos.map((photo: any, index: number) => (
                    <div key={photo.id || index} className="border border-slate-200 rounded-lg p-4">
                      <div className="flex items-start gap-4">
                        {photo.uri ? (
                          <img
                            src={photo.uri}
                            alt={`Photo ${index + 1}`}
                            className="w-24 h-24 object-cover rounded-lg flex-shrink-0"
                          />
                        ) : (
                          <div className="w-24 h-24 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <ImageIcon className="w-8 h-8 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-slate-900">
                              {photo.isDirectiveOnly ? 'Directives' : `Photo ${index + 1}`}
                            </span>
                            {photo.analysis?.riskLevel && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getRiskColor(photo.analysis.riskLevel)}`}>
                                {getRiskLabel(photo.analysis.riskLevel)}
                              </span>
                            )}
                          </div>
                          {photo.analysis?.observation && (
                            <p className="text-sm text-slate-600 mb-1">
                              <span className="font-medium">Observation:</span> {photo.analysis.observation}
                            </p>
                          )}
                          {photo.analysis?.recommendation && (
                            <p className="text-sm text-slate-600 mb-1">
                              <span className="font-medium">Recommandation:</span> {photo.analysis.recommendation}
                            </p>
                          )}
                          {photo.comment && (
                            <p className="text-sm text-slate-500 italic mt-1">{photo.comment}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {selectedVisit.notes && (
                <div className="mt-6">
                  <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Notes / Directives globales
                  </h3>
                  <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap">
                    {selectedVisit.notes}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Visits list */
            <div className="space-y-3">
              {visits.map((visit) => (
                <div
                  key={visit.id}
                  onClick={() => setSelectedVisit(visit)}
                  className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-slate-900 font-medium">
                        <Calendar className="w-4 h-4 text-slate-500" />
                        {new Date(visit.visitDate).toLocaleDateString('fr-FR', {
                          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                        })}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                        <span className="flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5" />
                          {visit.photoCount || visit.photos?.length || 0} photo(s)
                        </span>
                        {visit.reportGenerated && (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Rapport généré
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-prosps-blue font-medium">Voir détails →</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
