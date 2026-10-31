import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { RiskLevel } from '../policy/RiskLevelPolicy.js';
import type { ExperimentalRisk } from './ExperimentalRisk.js';

export type ScoringApiVersion = 'v1' | 'v2';

/** Resultado persistido de UN algoritmo sobre UN snapshot (almacén local prediction_model_results). */
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
  /** v2 = score obtenido con la política research; v1 = inferencia sin banda experimental. */
  readonly scoringApiVersion: ScoringApiVersion;
  /** SHA-256 completo del artefacto (v2); null en scores v1 heredados. */
  readonly modelHashSha256: string | null;
  /** Banda relativa EXPERIMENTAL de Python v2; null si no hubo política research. */
  readonly experimentalRisk: ExperimentalRisk | null;
}

export type NewModelScore = Omit<ModelScore, 'resultId' | 'predictionRunId'>;
