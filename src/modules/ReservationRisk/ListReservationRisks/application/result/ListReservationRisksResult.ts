import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DataSourceMode } from '../../../../../shared/data/DataSourceMode.js';
import type { Reservation } from '../../../../Reservations/Shared/models/Reservation.js';
import type { ReservationScoreSummary } from '../../../../Reservations/Shared/models/ReservationScoreSummary.js';
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
    readonly field: 'appointmentAt' | 'probabilityNoShow' | 'riskLevel';
    readonly direction: 'asc' | 'desc';
    readonly modelKey: MlModelKey;
    /** El orden por score es exploratorio: no es priorización clínica/operativa aprobada. */
    readonly semantics: 'CHRONOLOGICAL' | 'EXPLORATORY_SCORE_ORDER' | 'APPROVED_RISK_POLICY';
  };
  readonly riskPolicyStatus: RiskPolicyStatus;
  readonly classificationUnavailable: boolean;
  readonly sourceStatus: DataSourceMode;
  readonly predictiveStoreAvailable: boolean;
}
