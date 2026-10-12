import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DataSourceMode } from '../../../../../shared/data/DataSourceMode.js';
import type { Reservation } from '../../../../Reservations/Shared/models/Reservation.js';
import type {
  ExperimentalRiskSummary,
  ReservationScoreSummary,
} from '../../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type { ExperimentalPolicyIdentity } from '../../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import type { NotScorableReason } from '../../../Shared/models/NotScorableReason.js';
import type { RiskLevel, RiskPolicyStatus } from '../../../Shared/policy/RiskLevelPolicy.js';
import type { PredictionAvailability } from '../../../Shared/validation/PreAssessScorability.js';

export type SourceFreshness = 'CURRENT' | 'STALE_CLASSIFICATION';

export interface ListedScore extends ReservationScoreSummary {
  readonly policyRiskLevel: RiskLevel | null;
}

export interface ListReservationRisksItem {
  readonly reservation: Reservation;
  readonly sourceFreshness: SourceFreshness;
  readonly predictionAvailability: PredictionAvailability;
  readonly notScorableReasons: readonly NotScorableReason[];
  readonly scores: readonly ListedScore[];
  /** Banda experimental del modelo elegido según su último score (null = sin banda). */
  readonly experimentalRisk: ExperimentalRiskSummary | null;
  /** true si esa banda pertenece a la política vigente del listado (filtros/orden). */
  readonly experimentalPolicyCurrent: boolean;
}

export interface ListExperimentalRiskPolicy extends ExperimentalPolicyIdentity {
  readonly modelKey: MlModelKey;
}

export interface ListReservationRisksResult {
  readonly items: readonly ListReservationRisksItem[];
  readonly nextCursor: string | null;
  readonly limit: number;
  readonly period: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: string;
    readonly startInclusive: Date;
    readonly endExclusive: Date;
  };
  readonly sort: {
    readonly field: 'appointmentAt' | 'probabilityNoShow' | 'riskLevel' | 'experimentalRisk';
    readonly direction: 'asc' | 'desc';
    readonly modelKey: MlModelKey;
    /** El orden por score es exploratorio: no es priorización clínica/operativa aprobada. */
    readonly semantics:
      | 'CHRONOLOGICAL'
      | 'EXPLORATORY_SCORE_ORDER'
      | 'APPROVED_RISK_POLICY'
      | 'EXPERIMENTAL_RESEARCH_BAND_ORDER';
  };
  readonly riskPolicyStatus: RiskPolicyStatus;
  /** Sin clasificación operativa NI experimental para el modelo elegido. */
  readonly classificationUnavailable: boolean;
  /** Riesgo operativo aprobado no disponible (política pending_validation). */
  readonly operationalClassificationUnavailable: boolean;
  /** No hay scores con banda experimental v2 para el modelo elegido en el almacén local. */
  readonly experimentalClassificationUnavailable: boolean;
  /** Política research que gobierna filtro/orden experimental (la del score v2 más reciente). */
  readonly experimentalRiskPolicy: ListExperimentalRiskPolicy | null;
  readonly sourceStatus: DataSourceMode;
  readonly predictiveStoreAvailable: boolean;
}
