import type {
  AttendanceOutcomeBody,
  PeriodBody,
} from '../../../../Shared/http/OperationalHttpMapper.js';

export interface ListAttendanceOutcomesResponse {
  data: AttendanceOutcomeBody[];
  pagination: { limit: number; nextCursor: string | null };
  period: PeriodBody;
  requestId: string;
}
