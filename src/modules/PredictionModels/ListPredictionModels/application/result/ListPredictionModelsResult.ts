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
  readonly riskPolicyStatus: 'pending_validation' | 'approved';
}
