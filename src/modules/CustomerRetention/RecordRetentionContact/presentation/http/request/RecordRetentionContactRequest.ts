import type { MlModelKey } from '../../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { ReservationIdParams } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';

export interface RecordRetentionContactBody {
  clientId: string;
  modelKey: MlModelKey;
  predictionRunId: string;
}

export interface RecordRetentionContactRequest {
  Params: ReservationIdParams;
  Body: RecordRetentionContactBody;
}
