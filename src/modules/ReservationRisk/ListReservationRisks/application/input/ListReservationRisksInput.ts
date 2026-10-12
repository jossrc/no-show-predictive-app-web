import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';
import type { ExperimentalRiskLevel } from '../../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type { ListableReservationStatus } from '../../../../Reservations/Shared/models/ReservationStatus.js';
import type { RiskLevel } from '../../../Shared/policy/RiskLevelPolicy.js';

export type ListReservationRisksSort =
  'appointmentAt' | 'probabilityNoShow' | 'riskLevel' | 'experimentalRisk';

export interface ListReservationRisksInput {
  /** Fechas locales de Lima `YYYY-MM-DD`, intervalo inclusivo por día. */
  readonly from: string;
  readonly to: string;
  readonly status: ListableReservationStatus;
  readonly clinicId: number | null;
  readonly sort: ListReservationRisksSort;
  readonly direction: 'asc' | 'desc';
  readonly modelKey: MlModelKey;
  /** Nivel OPERATIVO aprobado (legado): sin política aprobada ⇒ 409 RISK_POLICY_UNAVAILABLE. */
  readonly riskLevel: RiskLevel | null;
  /** Banda EXPERIMENTAL research v2 del modelo `modelKey` (no es riesgo operativo). */
  readonly experimentalRiskLevel: ExperimentalRiskLevel | null;
  readonly limit: number;
  readonly cursor: string | null;
  readonly clinicScope: ClinicAccessScope;
}
