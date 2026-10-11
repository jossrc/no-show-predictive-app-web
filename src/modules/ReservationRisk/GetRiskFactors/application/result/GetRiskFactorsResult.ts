import type {
  MlModelKey,
  PredictorName,
} from '../../../../../infrastructure/http/ml/MlFeatureContract.js';

export interface RiskFactor {
  readonly featureName: PredictorName;
  readonly label: string;
  readonly direction: 'increases_model_output' | 'decreases_model_output' | 'neutral';
  readonly contribution: number;
  readonly absoluteContribution: number;
  readonly sensitiveAttribute: boolean;
}

export interface GetRiskFactorsResult {
  readonly reservationId: string;
  readonly snapshot: {
    readonly snapshotId: string;
    readonly snapshotHash: string;
    readonly predictionAt: Date;
    readonly featureVersion: string;
    readonly builderVersion: string;
  };
  readonly model: {
    readonly modelKey: MlModelKey;
    readonly algorithm: 'random_forest' | 'xgboost';
    readonly modelVersion: string;
    readonly modelHash: string;
    readonly validationStatus: string;
    readonly calibrationStatus: string;
    readonly operationalUseAllowed: false;
  };
  readonly probabilityNoShow: number;
  readonly persistedScore: {
    readonly available: boolean;
    /** Misma versión y hash de modelo que el score persistido de este snapshot. */
    readonly sameModelIdentity: boolean;
    readonly probabilityNoShow: number | null;
  };
  readonly explanation: {
    readonly method: 'tree_shap';
    readonly outputSpace: 'probability' | 'log_odds';
    readonly outputLink: 'identity' | 'sigmoid';
    readonly baseValue: number;
    readonly modelOutputInExplanationSpace: number;
    readonly reconstructedOutputInExplanationSpace: number;
    readonly additivityError: number;
    readonly otherFeaturesContribution: number;
    readonly topK: number;
    readonly totalFeatureCount: 19;
    readonly factors: readonly RiskFactor[];
  };
}
