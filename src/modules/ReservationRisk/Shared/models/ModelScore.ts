import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { RiskLevel } from '../policy/RiskLevelPolicy.js';

/** Resultado persistido de UN algoritmo sobre UN snapshot (ml.prediction_model_results). */
export interface ModelScore {
  readonly resultId: DecimalId;
  readonly predictionRunId: string;
  readonly snapshotId: DecimalId;
  readonly modelKey: MlModelKey;
  readonly algorithm: 'random_forest' | 'xgboost';
  readonly modelVersion: string;
  readonly modelHash: string;
  readonly featureVersion: string;
  /** Instante lógico del snapshot (creación de la reserva), NO el instante de scoring. */
  readonly predictionAt: Date;
  readonly scoredAt: Date;
  /** Probabilidad original sin redondear, en [0,1]. */
  readonly probabilityNoShow: number;
  readonly predictionTarget: 'NO_SHOW_CANDIDATE';
  readonly validationStatus: string;
  readonly calibrationStatus: string;
  readonly operationalUseAllowed: false;
  readonly riskLevel: RiskLevel | null;
  readonly riskPolicyVersion: string | null;
  readonly riskPolicyStatus: string;
}

export type NewModelScore = Omit<ModelScore, 'resultId' | 'predictionRunId'>;
