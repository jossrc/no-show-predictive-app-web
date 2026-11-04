import type { AttendanceOutcome } from '../../../Shared/models/OperationalRecords.js';
import type { RecordListPage } from '../../../Shared/pagination/RecordListQuery.js';

export type ListAttendanceOutcomesResult = RecordListPage<AttendanceOutcome>;
