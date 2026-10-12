import type { ExperimentalRiskSummary } from '../../../../../Reservations/Shared/models/ReservationScoreSummary.js';

export interface RiskFactorBody {
  featureName: string;
  label: string;
  direction: 'increases_model_output' | 'decreases_model_output' | 'neutral';
  contribution: number;
  absoluteContribution: number;
  sensitiveAttribute: boolean;
}

export interface GetRiskFactorsResponse {
  data: {
    reservationId: string;
    snapshot: {
      predictionAt: string;
      featureVersion: string;
      builderVersion: string;
      snapshotHash: string;
    };
    model: {
      modelKey: string;
      algorithm: 'random_forest' | 'xgboost';
      modelVersion: string;
      modelHash: string;
      validationStatus: string;
      calibrationStatus: string;
      operationalUseAllowed: false;
    };
    probabilityNoShow: number;
    percentageNoShow: number;
    persistedScore: {
      available: boolean;
      sameModelIdentity: boolean;
      probabilityNoShow: number | null;
      experimentalRisk: ExperimentalRiskSummary | null;
    };
    explanation: {
      method: 'tree_shap';
      outputSpace: 'probability' | 'log_odds';
      outputLink: 'identity' | 'sigmoid';
      units: string;
      baseValue: number;
      modelOutputInExplanationSpace: number;
      reconstructedOutputInExplanationSpace: number;
      additivityError: number;
      otherFeaturesContribution: number;
      topK: number;
      totalFeatureCount: number;
      factors: RiskFactorBody[];
    };
    interpretation: {
      scope: 'local_association_not_causality';
      note: string;
      unitsNote: string;
      sensitiveAttributesNote: string;
    };
    riskLevel: null;
    riskPolicyStatus: 'pending_validation' | 'approved';
  };
  requestId: string;
}
