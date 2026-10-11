import { ML_MODEL_KEYS } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DataSourceMode } from '../../../../shared/data/DataSourceMode.js';
import type { BookingFeatureSnapshot } from '../models/BookingFeatureSnapshot.js';
import type { ModelScore } from '../models/ModelScore.js';
import type { NotScorableReason } from '../models/NotScorableReason.js';
import type { RiskLevel, RiskLevelPolicy, RiskPolicyStatus } from '../policy/RiskLevelPolicy.js';

export type RiskAssessmentStatus = 'AVAILABLE_EXPLORATORY' | 'NOT_SCORED' | 'NOT_SCORABLE';

export interface AssessedModelScore extends ModelScore {
  /** Nivel por política aprobada; null mientras la política esté pendiente. */
  readonly policyRiskLevel: RiskLevel | null;
}

export interface RiskAssessment {
  readonly reservationId: string;
  readonly status: RiskAssessmentStatus;
  readonly reasons: readonly NotScorableReason[];
  readonly sourceStatus: DataSourceMode;
  readonly snapshot: BookingFeatureSnapshot | null;
  readonly models: readonly AssessedModelScore[];
  /** Diferencia descriptiva |RF−XGB|; sin ensemble ni ganador. */
  readonly comparison: { readonly absoluteProbabilityDifference: number } | null;
  readonly riskPolicyStatus: RiskPolicyStatus;
  readonly riskPolicyVersion: string | null;
}

const MODEL_ORDER = new Map<string, number>(ML_MODEL_KEYS.map((key, index) => [key, index]));

export function assembleRiskAssessment(params: {
  reservationId: string;
  snapshot: BookingFeatureSnapshot | null;
  scores: readonly ModelScore[];
  reasons: readonly NotScorableReason[];
  policy: RiskLevelPolicy;
  mode: DataSourceMode;
}): RiskAssessment {
  const models = [...params.scores]
    .sort(
      (left, right) =>
        (MODEL_ORDER.get(left.modelKey) ?? 9) - (MODEL_ORDER.get(right.modelKey) ?? 9),
    )
    .map((score) => ({
      ...score,
      policyRiskLevel: params.policy.isAvailableFor(score.modelKey)
        ? params.policy.classify(score)
        : null,
    }));

  const randomForest = models.find((model) => model.modelKey === 'random_forest_full_v1');
  const xgboost = models.find((model) => model.modelKey === 'xgboost_full_v1');

  let status: RiskAssessmentStatus;
  if (models.length > 0) status = 'AVAILABLE_EXPLORATORY';
  else if (params.snapshot !== null || params.reasons.length === 0) status = 'NOT_SCORED';
  else status = 'NOT_SCORABLE';

  return {
    reservationId: params.reservationId,
    status,
    reasons: status === 'NOT_SCORABLE' ? params.reasons : [],
    sourceStatus: params.mode,
    snapshot: params.snapshot,
    models,
    comparison:
      randomForest && xgboost
        ? {
            absoluteProbabilityDifference: Math.abs(
              randomForest.probabilityNoShow - xgboost.probabilityNoShow,
            ),
          }
        : null,
    riskPolicyStatus: params.policy.status,
    riskPolicyVersion: params.policy.policyVersion,
  };
}
