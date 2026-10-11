import type {
  ReservationBody,
  ScoreSummaryBody,
} from '../../../../Shared/http/ReservationHttpMapper.js';

export interface GetReservationResponse {
  data: ReservationBody & {
    hasUsableSnapshot: boolean;
    scores: ScoreSummaryBody[];
    sourceStatus: string;
  };
  requestId: string;
}
