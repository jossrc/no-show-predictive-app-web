import type { MlModelKey } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ReservationIdParams } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';

export interface EnableOverbookingBody {
  modelKey: MlModelKey;
  predictionRunId: string;
}

export interface EnableOverbookingRequest {
  Params: ReservationIdParams;
  Body: EnableOverbookingBody;
}
