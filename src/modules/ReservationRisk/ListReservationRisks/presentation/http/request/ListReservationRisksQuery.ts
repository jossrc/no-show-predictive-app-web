import type { MlModelKey } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ExperimentalRiskLevel } from '../../../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type { ListableReservationStatus } from '../../../../../Reservations/Shared/models/ReservationStatus.js';
import type { RiskLevel } from '../../../../Shared/policy/RiskLevelPolicy.js';
import type { ListReservationRisksSort } from '../../../application/input/ListReservationRisksInput.js';

export interface ListReservationRisksQuery {
  from: string;
  to: string;
  status: ListableReservationStatus;
  clinicId?: string;
  sort: ListReservationRisksSort;
  direction: 'asc' | 'desc';
  modelKey: MlModelKey;
  riskLevel?: RiskLevel;
  experimentalRiskLevel?: ExperimentalRiskLevel;
  limit: number;
  cursor?: string;
}

export interface ListReservationRisksRequest {
  Querystring: ListReservationRisksQuery;
}
