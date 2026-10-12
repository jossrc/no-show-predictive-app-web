import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';

export interface ResearchRiskPolicySummary {
  readonly modelKey: MlModelKey;
  readonly modelVersion: string;
  readonly modelHashSha256: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly lowUpperThreshold: number;
  readonly highLowerThreshold: number;
  readonly boundaryRule: string;
  readonly method: string;
  readonly meaning: string;
  readonly developmentStart: string;
  readonly developmentEndExclusive: string;
  readonly labelCutoffExclusive: string;
  readonly developmentRows: number;
  readonly calibrationEceUniform10: number;
  readonly warnings: readonly string[];
  readonly status: 'RESEARCH_PROVISIONAL';
  readonly approvedBy: null;
  readonly operationalUseAllowed: false;
}

export interface GetResearchRiskPolicyResult {
  readonly nodeResearchRiskEnabled: boolean;
  readonly available: boolean;
  readonly status: 'RESEARCH_PROVISIONAL' | 'UNAVAILABLE';
  readonly reason: string | null;
  readonly classificationBasis: 'RESEARCH_PROVISIONAL' | null;
  /** Estado de la política OPERATIVA aprobada (distinta de la experimental). */
  readonly approvedRiskPolicyStatus: 'pending_validation' | 'approved';
  readonly validationStatus: 'EXPLORATORY_NOT_VALIDATED';
  readonly operationalUseAllowed: false;
  readonly labels: { readonly LOW: string; readonly MEDIUM: string; readonly HIGH: string };
  readonly notice: string;
  readonly policies: readonly ResearchRiskPolicySummary[];
}
