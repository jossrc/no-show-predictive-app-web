import type { ReservationIdParams } from '../../../../../Reservations/Shared/http/ReservationIdParams.js';
import type { AttendanceStatus } from '../../../../Shared/models/OperationalRecords.js';

export interface RecordAttendanceOutcomeBody {
  attendanceStatus: AttendanceStatus;
  predictionRunId: string;
}

export interface RecordAttendanceOutcomeRequest {
  Params: ReservationIdParams;
  Body: RecordAttendanceOutcomeBody;
}
