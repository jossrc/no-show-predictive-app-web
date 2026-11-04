import type { OperationalStatusBody } from '../../../../Shared/http/OperationalStatusHttp.js';
import type {
  ReservationBody,
  ScoreSummaryBody,
} from '../../../../Shared/http/ReservationHttpMapper.js';

export interface GetReservationResponse {
  data: ReservationBody &
    OperationalStatusBody & {
      hasUsableSnapshot: boolean;
      scores: ScoreSummaryBody[];
      sourceStatus: string;
    };
  requestId: string;
}
