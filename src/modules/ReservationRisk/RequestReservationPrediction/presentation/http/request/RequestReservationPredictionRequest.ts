import type { MlModelKey } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ReservationIdParams } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';

export type RequestReservationPredictionBody =
  { mode: 'compare' } | { mode: 'single'; modelKey: MlModelKey };

export interface RequestReservationPredictionRequest {
  Params: ReservationIdParams;
  Body: RequestReservationPredictionBody;
}
