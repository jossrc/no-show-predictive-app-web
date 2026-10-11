import type { MlPredictionResponse } from '../../../../infrastructure/http/ml/MlContractTypes.js';
import type { BookingFeatureSnapshot } from '../models/BookingFeatureSnapshot.js';
import type { NewModelScore } from '../models/ModelScore.js';
import type { RiskLevelPolicy } from '../policy/RiskLevelPolicy.js';

/**
 * Traduce una respuesta ML YA validada a un registro persistible. La probabilidad se guarda sin
 * redondeo; el nivel solo existe con política aprobada (en Sprint 01 queda null).
 */
export function toNewModelScore(
  response: MlPredictionResponse,
  snapshot: BookingFeatureSnapshot,
  scoredAt: Date,
  policy: RiskLevelPolicy,
): NewModelScore {
  const riskLevel = policy.isAvailableFor(response.model_key)
    ? policy.classify({
        modelKey: response.model_key,
        modelVersion: response.model_version,
        probabilityNoShow: response.probability_no_show,
      })
    : null;

  return {
    snapshotId: snapshot.snapshotId,
    modelKey: response.model_key,
    algorithm: response.algorithm,
    modelVersion: response.model_version,
    modelHash: response.model_hash,
    featureVersion: response.feature_version,
    predictionAt: snapshot.predictionAt,
    scoredAt,
    probabilityNoShow: response.probability_no_show,
    predictionTarget: response.prediction_target,
    validationStatus: response.validation_status,
    calibrationStatus: response.calibration_status,
    operationalUseAllowed: false,
    riskLevel,
    riskPolicyVersion: riskLevel === null ? null : policy.policyVersion,
    riskPolicyStatus: riskLevel === null ? response.risk_policy_status : policy.status,
  };
}
