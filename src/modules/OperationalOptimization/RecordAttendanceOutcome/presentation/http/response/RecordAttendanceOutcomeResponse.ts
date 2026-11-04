import type { AttendanceOutcomeBody } from '../../../../Shared/http/OperationalHttpMapper.js';

export interface RecordAttendanceOutcomeResponse {
  data: AttendanceOutcomeBody & { replayed: boolean };
  requestId: string;
}
