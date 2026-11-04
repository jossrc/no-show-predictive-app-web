import type { ReservationIdParams } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';

export interface RecordSpaceRecoveryOutcomeBody {
  spaceRecovered: boolean;
}

export interface RecordSpaceRecoveryOutcomeRequest {
  Params: ReservationIdParams;
  Body: RecordSpaceRecoveryOutcomeBody;
}
