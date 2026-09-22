import {
  PreventionFindingType,
  PreventionRiskLevel,
  PreventionSourceKind,
} from '../entities/prevention.enums';

export interface CanonicalPreventionFinding {
  sourceGroupId: string;
  sourceKind: PreventionSourceKind;
  findingType: PreventionFindingType;
  content: string;
  danger: string | null;
  risk: string | null;
  riskLevel: PreventionRiskLevel;
  confidence: number | null;
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
}
