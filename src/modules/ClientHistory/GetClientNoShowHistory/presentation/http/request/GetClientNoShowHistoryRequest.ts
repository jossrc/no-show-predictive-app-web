import type { ReservationIdParams } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import type { HistoricalAsOf } from '../../../../Shared/models/HistoricalAsOf.js';

export interface GetClientNoShowHistoryRequest {
  Params: ReservationIdParams;
  Querystring: { historicalAsOf: HistoricalAsOf };
}
