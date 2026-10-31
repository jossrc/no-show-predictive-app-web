import type { MlModelKey } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ReservationIdParams } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';

export interface GetRiskFactorsQuery {
  modelKey: MlModelKey;
  topK: number;
}

export interface GetRiskFactorsRequest {
  Params: ReservationIdParams;
  Querystring: GetRiskFactorsQuery;
}
