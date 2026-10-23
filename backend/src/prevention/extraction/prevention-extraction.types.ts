import {
  PreventionFindingType,
  PreventionRiskLevel,
  PreventionSourceKind,
} from '../entities/prevention.enums';
import {
  PreventionConstructionPhase,
  PreventionEffectivePhase,
  PreventionPhaseSource,
  PreventionPhaseStatus,
} from '../prevention-phase';
import { PreventionActionMetric, PreventionActionType } from '../prevention-action-types';

export interface CanonicalPreventionAnalysisGroup {
  sourceGroupId: string;
  sourceKind: PreventionPhaseSource;
  proposedPhase: PreventionConstructionPhase;
  effectivePhase: PreventionEffectivePhase;
  status: PreventionPhaseStatus;
  confidence: number;
  justification: string;
  source: PreventionPhaseSource;
  modelVersion: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
  sourceHash: string;
}

export interface CanonicalPreventionFinding {
  sourceGroupId: string;
  sourceKind: PreventionSourceKind;
  findingType: PreventionFindingType;
  content: string;
  danger: string | null;
  risk: string | null;
  riskLevel: PreventionRiskLevel;
  confidence: number | null;
  actionType: PreventionActionType | null;
  actionTypeConfidence: number | null;
  actionTypeVersion: string | null;
  actionMetric: PreventionActionMetric | null;
  regulatoryReferences: string[];
  normalizedKey: string;
  patternKey: string;
}

export interface CanonicalPreventionSource {
  reportId: string;
  visitId: string;
  missionId: string;
  sourceStatus: string | null;
  businessDate: string;
  missionType: string;
  findings: CanonicalPreventionFinding[];
  analysisGroups: CanonicalPreventionAnalysisGroup[];
}
