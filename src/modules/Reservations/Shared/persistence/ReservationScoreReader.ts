import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type {
  ExperimentalRiskLevel,
  ReservationScoreSummary,
} from '../models/ReservationScoreSummary.js';
import type { ProbabilityRange } from './ReservationRepository.js';

export interface RankedScore {
  readonly reservationId: DecimalId;
  readonly probability: number;
}

export interface ScoreRankingCriteria {
  readonly modelKey: MlModelKey;
  readonly evidence: SnapshotEvidenceSource;
  /** Banda de probabilidad de una política APROBADA (legado); null si no aplica. */
  readonly probabilityRange: ProbabilityRange | null;
  /** Solo reservas cuyo último score del modelo fue clasificado con esta política research. */
  readonly experimentalPolicyHash: string | null;
  readonly experimentalRiskLevel: ExperimentalRiskLevel | null;
}

export interface ExperimentalPolicyIdentity {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyHash: string;
}

/**
 * Lectura del almacén predictivo LOCAL (snapshots y scores persistidos por POST explícitos).
 * Nunca llama a Python ni consulta PostgreSQL.
 */
export interface ReservationScoreReader {
  isAvailable(): Promise<boolean>;
  /** Último score por modelo de cada reserva (una consulta por lote, sin N+1). */
  latestScores(
    reservationIds: readonly DecimalId[],
    evidence: SnapshotEvidenceSource,
  ): Promise<ReadonlyMap<DecimalId, readonly ReservationScoreSummary[]>>;
  reservationsWithUsableSnapshot(
    reservationIds: readonly DecimalId[],
    evidence: SnapshotEvidenceSource,
  ): Promise<ReadonlySet<DecimalId>>;
  /** Reservas cuyo ÚLTIMO score del modelo cumple el criterio (universo global, no una página). */
  rankLatest(criteria: ScoreRankingCriteria): Promise<readonly RankedScore[]>;
  /** Política research del score v2 más reciente del modelo (la que define el filtro vigente). */
  currentExperimentalPolicy(
    modelKey: MlModelKey,
    evidence: SnapshotEvidenceSource,
  ): Promise<ExperimentalPolicyIdentity | null>;
}
