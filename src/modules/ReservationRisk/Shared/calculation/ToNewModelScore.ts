import type {
  MlPredictionResponse,
  MlResearchPredictionResponse,
} from '../../../../infrastructure/http/ml/MlContractTypes.js';
import type { BookingFeatureSnapshot } from '../models/BookingFeatureSnapshot.js';
import { toExperimentalRisk } from '../models/ExperimentalRisk.js';
import type { NewModelScore } from '../models/ModelScore.js';
import type { RiskLevelPolicy } from '../policy/RiskLevelPolicy.js';

function isResearchResponse(
  response: MlPredictionResponse | MlResearchPredictionResponse,
): response is MlResearchPredictionResponse {
  return response.api_version === 'v2';
}

/**
 * Traduce una respuesta ML YA validada (v1 o research v2) a un registro persistible. La
 * probabilidad se guarda sin redondeo. Dos clasificaciones distintas y separadas:
 * - `riskLevel` operativo: solo con política APROBADA (hoy null, pending_validation);
 * - `experimentalRisk`: banda relativa de Python v2 copiada tal cual, nunca calculada en Node.
 */
export function toNewModelScore(
  response: MlPredictionResponse | MlResearchPredictionResponse,
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
  const research = isResearchResponse(response) ? response : null;

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
    scoringApiVersion: research ? 'v2' : 'v1',
    modelHashSha256: research?.model_hash_sha256 ?? null,
    experimentalRisk: research ? toExperimentalRisk(research.experimental_risk) : null,
  };
}
