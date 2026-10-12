import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';

export interface PredictionModelSummary {
  readonly modelKey: MlModelKey;
  readonly algorithm: 'random_forest' | 'xgboost';
  readonly modelVersion: string;
  readonly modelHash: string;
  readonly role: 'provisional_demo_default' | 'independent_comparator';
  readonly featureCount: number;
  readonly validationStatus: string;
  readonly calibrationStatus: string;
  readonly operationalUseAllowed: false;
}

export interface ListPredictionModelsResult {
  readonly featureVersion: string;
  readonly defaultModelKey: MlModelKey;
  readonly models: readonly PredictionModelSummary[];
  /** Política OPERATIVA aprobada (pending_validation). */
  readonly riskPolicyStatus: 'pending_validation' | 'approved';
  /** Política EXPERIMENTAL research v2 (aditivo): disponibilidad ≠ aprobación. */
  readonly experimentalRiskPolicy: {
    readonly status: 'RESEARCH_PROVISIONAL' | 'UNAVAILABLE';
    readonly available: boolean;
    readonly reason: string | null;
    readonly classificationBasis: 'RESEARCH_PROVISIONAL' | null;
    readonly operationalUseAllowed: false;
    readonly policies: ReadonlyArray<{
      readonly modelKey: MlModelKey;
      readonly policyId: string;
      readonly policyVersion: string;
      readonly policyHash: string;
    }>;
  };
}
