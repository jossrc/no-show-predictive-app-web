import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';
import type { ListableReservationStatus } from '../../../../Reservations/Shared/models/ReservationStatus.js';
import type { RiskLevel } from '../../../Shared/policy/RiskLevelPolicy.js';

export type ListReservationRisksSort = 'appointmentAt' | 'probabilityNoShow' | 'riskLevel';

export interface ListReservationRisksInput {
  /** Fechas locales de Lima `YYYY-MM-DD`, intervalo inclusivo por día. */
  readonly from: string;
  readonly to: string;
  readonly status: ListableReservationStatus;
  readonly clinicId: number | null;
  readonly sort: ListReservationRisksSort;
  readonly direction: 'asc' | 'desc';
  readonly modelKey: MlModelKey;
  readonly riskLevel: RiskLevel | null;
  readonly limit: number;
  readonly cursor: string | null;
  readonly clinicScope: ClinicAccessScope;
}
