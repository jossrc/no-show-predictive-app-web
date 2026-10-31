import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { RiskAssessment } from '../../../Shared/calculation/AssembleRiskAssessment.js';
import type { FeatureWarning } from '../../../Shared/calculation/RiskFeaturesBuilder.js';

export interface RequestReservationPredictionResult {
  readonly assessment: RiskAssessment;
  readonly run: {
    /** run_uid creado por esta petición; null si se reutilizaron resultados existentes. */
    readonly predictionRunId: string | null;
    /** true si no se llamó a Python porque los resultados ya existían (idempotencia). */
    readonly replayed: boolean;
    readonly requestedModelKeys: readonly MlModelKey[];
    readonly snapshotCreated: boolean;
  };
  readonly featureWarnings: readonly FeatureWarning[];
}
