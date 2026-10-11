import type { Reservation } from '../../../../Reservations/Shared/models/Reservation.js';
import type { RiskAssessment } from '../../../Shared/calculation/AssembleRiskAssessment.js';

export interface GetReservationRiskResult {
  readonly reservation: Reservation;
  readonly assessment: RiskAssessment;
  readonly sourceFreshness: 'CURRENT' | 'STALE_CLASSIFICATION';
}
