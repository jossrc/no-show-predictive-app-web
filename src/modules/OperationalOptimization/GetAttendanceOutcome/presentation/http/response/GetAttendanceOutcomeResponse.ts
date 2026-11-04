import type { AttendanceOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';

export interface GetAttendanceOutcomeResponse {
  data: {
    reservationId: string;
    recorded: boolean;
    attendanceStatus: 'ATTENDED' | 'NO_SHOW' | null;
    outcome: AttendanceOutcomeBody | null;
    registration: {
      ruleVersion: string;
      registrable: boolean;
      blocker: string | null;
      availablePredictionRunIds: string[];
    };
  };
  requestId: string;
}
